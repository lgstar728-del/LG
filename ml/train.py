"""Loop 레이어: 학습 → 보정 → 평가 → 이력 기록 → Vercel 호환 JSON 추론 모델 내보내기.

사용법
  python train.py                                   # DEMO 100k 로 학습 (기본)
  python train.py --real-csv ../data/real/x.csv     # 실데이터(REAL) 혼합/단독 학습 → 재검증 필수
  python train.py --source real --real-csv ...      # REAL 단독

원칙
- 시간순 경기 단위 분할(train 70 / calib 15 / test 15) → 누출 방지
- 확률 보정(Isotonic)은 calib 분할로만 적합, 최종 지표는 test 분할로만 보고
- DEMO 지표는 '합성 데이터 자기일관성 점검'일 뿐 실제 성능이 아님 → metrics.json에 명시
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.preprocessing import StandardScaler

from common import PITCH_TYPES, build_features, time_split

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "src" / "model"
PARAMS = dict(
    n_estimators=600, max_depth=4, learning_rate=0.05, subsample=0.85, colsample_bytree=0.85,
    min_child_weight=5, reg_lambda=2.0, tree_method="hist", eval_metric="logloss",
    early_stopping_rounds=40, random_state=7,
)
MIN_REAL_ROWS = 5000


def ece(y, p, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    total, err, curve = len(y), 0.0, []
    for b in range(bins):
        m = idx == b
        if m.sum() == 0:
            continue
        conf, acc = float(p[m].mean()), float(y[m].mean())
        err += m.sum() / total * abs(conf - acc)
        curve.append(dict(bin=b, n=int(m.sum()), predicted=round(conf, 4), observed=round(acc, 4)))
    return float(err), curve


def metrics(y, p):
    e, curve = ece(y, p)
    return dict(
        roc_auc=round(float(roc_auc_score(y, p)), 4),
        brier=round(float(brier_score_loss(y, p)), 4),
        log_loss=round(float(log_loss(y, np.clip(p, 1e-6, 1 - 1e-6))), 4),
        ece=round(e, 4),
    ), curve


def flatten_tree(node: dict, feat_names: list[str]):
    """xgboost JSON dump → 배열 표현(f, t, l, r, v). 결측치는 없다고 가정(입력 검증으로 보장)."""
    nodes = {}

    def walk(n):
        nodes[n["nodeid"]] = n
        for c in n.get("children", []):
            walk(c)

    walk(node)
    ids = sorted(nodes)
    remap = {nid: i for i, nid in enumerate(ids)}
    f, t, l, r, v = [], [], [], [], []
    for nid in ids:
        n = nodes[nid]
        if "leaf" in n:
            f.append(-1); t.append(0); l.append(-1); r.append(-1); v.append(float(n["leaf"]))
        else:
            f.append(feat_names.index(n["split"])); t.append(float(n["split_condition"]))
            l.append(remap[n["yes"]]); r.append(remap[n["no"]]); v.append(0.0)
    return dict(f=f, t=t, l=l, r=r, v=v)


def base_margin(booster) -> float:
    cfg = json.loads(booster.save_config())
    raw = cfg["learner"]["learner_model_param"]["base_score"]
    bs = float(str(raw).strip("[]"))
    return math.log(bs / (1 - bs))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo-csv", default=str(ROOT / "data" / "synthetic" / "pitches_demo.csv"))
    ap.add_argument("--real-csv", default=None)
    ap.add_argument("--source", choices=["demo", "real", "mixed"], default=None)
    ap.add_argument("--notes", default="")
    args = ap.parse_args()

    source = args.source or ("mixed" if args.real_csv else "demo")
    frames = []
    if source in ("demo", "mixed"):
        d = pd.read_csv(args.demo_csv)
        d["data_source"] = "DEMO"
        frames.append(d)
    if source in ("real", "mixed"):
        if not args.real_csv:
            raise SystemExit("--real-csv 가 필요합니다")
        r = pd.read_csv(args.real_csv)
        r["data_source"] = "REAL"
        if len(r) < MIN_REAL_ROWS:
            raise SystemExit(f"실데이터 {len(r)}행 < 최소 {MIN_REAL_ROWS}행: 재학습·재검증 기준 미달")
        frames.append(r)
    df = pd.concat(frames, ignore_index=True)
    label = {"demo": "DEMO", "real": "REAL", "mixed": "MIXED"}[source]

    pitcher_vocab = sorted(df["pitcher_id"].unique().tolist())
    pitch_vocab = [p for p in PITCH_TYPES if p in set(df["pitch_type"])]
    train, calib, test = time_split(df)
    # 분할 간 game_id 겹침 없음 확인 (누출 방지 자체 검증)
    assert not (set(train.game_id) & set(calib.game_id) or set(train.game_id) & set(test.game_id) or set(calib.game_id) & set(test.game_id))

    X = {k: build_features(v, pitcher_vocab, pitch_vocab) for k, v in dict(train=train, calib=calib, test=test).items()}
    feat_names = list(X["train"].columns)
    y = {k: v["success"].to_numpy() for k, v in dict(train=train, calib=calib, test=test).items()}

    # 조기종료용 검증 = train의 가장 최근 15% 경기 (calib/test 미사용)
    t_games = train.groupby("game_id")["game_date"].min().sort_values(kind="stable").index.tolist()
    val_games = set(t_games[int(len(t_games) * 0.85):])
    is_val = train["game_id"].isin(val_games).to_numpy()

    model = xgb.XGBClassifier(**PARAMS)
    model.fit(X["train"][~is_val], y["train"][~is_val], eval_set=[(X["train"][is_val], y["train"][is_val])], verbose=False)
    booster = model.get_booster()
    best_n = booster.best_iteration + 1

    raw = {k: model.predict_proba(X[k])[:, 1] for k in X}
    # 보정 방식 선택: calib 분할의 앞/뒤 절반으로 후보(none/platt/isotonic)를 교차 비교 → 전체 calib으로 재적합
    def logit(p):
        p = np.clip(p, 1e-6, 1 - 1e-6)
        return np.log(p / (1 - p)).reshape(-1, 1)

    def fit_cal(kind, p, yy):
        if kind == "none":
            return lambda q: q
        if kind == "platt":
            lrm = LogisticRegression(C=1e6, max_iter=500).fit(logit(p), yy)
            return lambda q: lrm.predict_proba(logit(q))[:, 1]
        iso_m = IsotonicRegression(out_of_bounds="clip", y_min=0.001, y_max=0.999).fit(p, yy)
        return iso_m.predict

    half = len(y["calib"]) // 2
    cal_scores = {}
    for kind in ("none", "platt", "isotonic"):
        s_ab = brier_score_loss(y["calib"][half:], fit_cal(kind, raw["calib"][:half], y["calib"][:half])(raw["calib"][half:]))
        s_ba = brier_score_loss(y["calib"][:half], fit_cal(kind, raw["calib"][half:], y["calib"][half:])(raw["calib"][:half]))
        cal_scores[kind] = round(float((s_ab + s_ba) / 2), 5)
    cal_kind = min(cal_scores, key=cal_scores.get)
    cal_fn = fit_cal(cal_kind, raw["calib"], y["calib"])
    cal = {k: cal_fn(raw[k]) for k in X}
    calibration = dict(type=cal_kind, cv_brier=cal_scores)
    if cal_kind == "platt":
        lrm = LogisticRegression(C=1e6, max_iter=500).fit(logit(raw["calib"]), y["calib"])
        calibration.update(a=float(lrm.coef_[0][0]), b=float(lrm.intercept_[0]))
    elif cal_kind == "isotonic":
        iso_m = IsotonicRegression(out_of_bounds="clip", y_min=0.001, y_max=0.999).fit(raw["calib"], y["calib"])
        calibration.update(x=[round(float(v), 6) for v in iso_m.X_thresholds_], y=[round(float(v), 6) for v in iso_m.y_thresholds_])

    m_raw, _ = metrics(y["test"], raw["test"])
    m_cal, curve = metrics(y["test"], cal["test"])
    m_cal_trainfit, _ = metrics(y["train"], cal["train"])

    # 기준선: 상수 예측 / 로지스틱 회귀
    base_rate = float(y["train"].mean())
    base_brier = float(brier_score_loss(y["test"], np.full(len(y["test"]), base_rate)))
    sc = StandardScaler().fit(X["train"])
    lr = LogisticRegression(max_iter=500).fit(sc.transform(X["train"]), y["train"])
    lr_p = lr.predict_proba(sc.transform(X["test"]))[:, 1]
    m_lr, _ = metrics(y["test"], lr_p)

    gain = booster.get_score(importance_type="gain")
    imp = sorted(
        [dict(feature=k, gain=round(float(v), 3)) for k, v in gain.items()],
        key=lambda d: -d["gain"],
    )

    trees = [flatten_tree(json.loads(s), feat_names) for s in booster.get_dump(dump_format="json")[:best_n]]
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    version = f"{label.lower()}-{dt.datetime.now(dt.timezone.utc):%Y%m%d%H%M%S}"
    model_json = dict(
        version=version, trained_at=now, data_source=label, n_trees=len(trees),
        base_margin=base_margin(booster), feature_names=feat_names,
        pitcher_vocab=pitcher_vocab, pitch_vocab=pitch_vocab,
        calibration=calibration,
        trees=trees,
        disclaimer=("DEMO 가상 데이터로 학습된 모델입니다. 실제 투수 제구 예측으로 사용할 수 없습니다." if label == "DEMO"
                    else "실데이터 포함 모델: 반드시 독립 홀드아웃으로 재검증 후 사용하세요."),
    )
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    (MODEL_DIR / "model.json").write_text(json.dumps(model_json, separators=(",", ":")), encoding="utf-8")

    # 패리티 테스트용 고정 샘플 (TS 추론과 Python 확률을 대조)
    rng = np.random.default_rng(1)
    pick = rng.choice(len(test), size=40, replace=False)
    fx = test.iloc[pick]
    parity = [dict(
        input=dict(
            pitcher_id=r.pitcher_id, pitch_type=r.pitch_type, velocity=float(r.velocity), pitch_count=int(r.pitch_count),
            fatigue=float(r.fatigue), target_x=float(r.target_x), target_y=float(r.target_y),
            balls=int(r.balls), strikes=int(r.strikes), batter_hand=r.batter_hand, pitcher_hand=r.pitcher_hand,
        ),
        raw=float(rr), calibrated=float(cc),
    ) for r, rr, cc in zip(fx.itertuples(), raw["test"][pick], cal["test"][pick])]
    (MODEL_DIR / "parity_fixtures.json").write_text(json.dumps(parity, indent=1), encoding="utf-8")

    result = dict(
        version=version, trained_at=now, data_source=label,
        claim="DEMO 합성 데이터 기준 자기일관성 지표이며 실제 성능이 아님" if label == "DEMO" else "실데이터 포함 — 독립 검증 필요",
        n_rows=dict(train=len(train), calib=len(calib), test=len(test)),
        n_games=dict(train=int(train.game_id.nunique()), calib=int(calib.game_id.nunique()), test=int(test.game_id.nunique())),
        split="game_date 시간순 70/15/15 (경기 단위, game_id 중복 없음)",
        base_rate=round(base_rate, 4),
        calibration_method=calibration,
        test=dict(raw=m_raw, calibrated=m_cal),
        train_calibrated=m_cal_trainfit,
        baselines=dict(constant_brier=round(base_brier, 4), logistic_regression=m_lr),
        calibration_curve=curve, feature_importance=imp[:15],
        params={k: v for k, v in PARAMS.items()}, best_iteration=int(best_n),
        notes=args.notes,
    )
    out_dir = ROOT / "data"
    (out_dir / "metrics.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    hist_path = out_dir / "training_history.json"
    hist = json.loads(hist_path.read_text(encoding="utf-8")) if hist_path.exists() else []
    hist.append(dict(version=version, trained_at=now, data_source=label, n_train=len(train), n_test=len(test),
                     roc_auc=m_cal["roc_auc"], brier=m_cal["brier"], ece=m_cal["ece"],
                     brier_raw=m_raw["brier"], ece_raw=m_raw["ece"], notes=args.notes))
    hist_path.write_text(json.dumps(hist, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(dict(test_raw=m_raw, test_calibrated=m_cal, logreg=m_lr, constant_brier=base_brier, trees=len(trees)), indent=1))


if __name__ == "__main__":
    main()
