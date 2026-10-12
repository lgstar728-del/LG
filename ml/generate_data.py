"""가상(DEMO) 투구 데이터 생성기.

⚠ 모든 데이터는 가상이며 실제 선수·경기와 무관하다. 모든 행에 data_source="DEMO", is_demo=True 가 붙는다.

생성 모델(제구 오차)
  actual = target + bias(투수·구종) + N(0, sd^2 I)
  sd = base_sd(투수) × 구종배수 × 피로배수 × 구속배수 × 볼카운트배수 × 목표위치배수 × 좌우타자 상성배수
  success = (|actual - target| <= SUCCESS_RADIUS)    # 제구 성공 자동 라벨링
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from common import PITCH_TYPES, PITCH_TYPE_KO, SUCCESS_RADIUS, ZONE_CENTERS

ROOT = Path(__file__).resolve().parents[1]

# 구종 특성: (직구 대비 구속 차이 km/h, 구속 표준편차, 제구 sd 배수, 수직 낙차 bias)
PITCH_SPEC = {
    "FF": dict(dv=0, vsd=2.0, sd=0.90, bias_y=0.00),
    "SL": dict(dv=-9, vsd=2.2, sd=1.10, bias_y=-0.04),
    "CB": dict(dv=-22, vsd=2.5, sd=1.28, bias_y=-0.10),
    "CH": dict(dv=-12, vsd=2.2, sd=1.12, bias_y=-0.06),
    "FK": dict(dv=-10, vsd=2.4, sd=1.32, bias_y=-0.12),
}

# (balls, strikes) 출현 가중치 — 일반적인 투구 카운트 분포를 흉내 낸 값
COUNT_WEIGHTS = {
    (0, 0): 26, (1, 0): 10, (0, 1): 12, (1, 1): 9, (2, 0): 4, (0, 2): 9,
    (2, 1): 5, (1, 2): 10, (3, 0): 1.2, (2, 2): 6, (3, 1): 2.2, (3, 2): 4.5,
}


def make_pitchers(rng: np.random.Generator, n: int = 20) -> list[dict]:
    pitchers = []
    for i in range(n):
        is_starter = i < 12
        repertoire_size = int(rng.integers(3, 6))
        types = ["FF"] + list(rng.choice(PITCH_TYPES[1:], size=repertoire_size - 1, replace=False))
        usage_raw = rng.dirichlet(np.ones(len(types)) * 2.0)
        usage_raw[0] += 0.25  # 직구 비중 가산
        usage = (usage_raw / usage_raw.sum()).round(3)
        pitchers.append(dict(
            pitcher_id=f"P{i + 1:02d}",
            name=f"DEMO 투수 {i + 1:02d}",
            hand="L" if rng.random() < 0.3 else "R",
            role="선발" if is_starter else "구원",
            base_sd=round(float(rng.uniform(0.27, 0.46)), 3),         # 작을수록 제구 좋음
            stamina=int(rng.integers(78, 112)) if is_starter else int(rng.integers(28, 46)),
            ff_velocity=round(float(rng.uniform(138, 152)), 1),
            bias_x=round(float(rng.normal(0, 0.05)), 3),
            bias_y=round(float(rng.normal(0, 0.04)), 3),
            repertoire=[str(t) for t in types],
            usage=[float(u) for u in usage],
            n_games=48 if is_starter else 100,
            is_demo=True,
            data_source="DEMO",
        ))
    return pitchers


def choose_target(rng, pitch_type: str, balls: int, strikes: int) -> int:
    """카운트·구종에 따른 목표 구역 선택(1..9)."""
    w = np.ones(9)
    if balls == 3:                          # 풀카운트 계열: 가운데 위주
        w = np.array([1, 2, 1, 2, 5, 2, 1, 2, 1], float)
    elif strikes == 2:                      # 결정구: 모서리·낮게
        w = np.array([1.5, 1, 1.5, 2, 1, 2, 3, 3.5, 3], float)
    elif balls == 0 and strikes == 0:
        w = np.array([1.2, 1.5, 1.2, 1.5, 2.5, 1.5, 1.2, 1.5, 1.2], float)
    if pitch_type in ("CB", "FK", "CH"):    # 낙차구: 아래쪽 선호
        w = w * np.array([0.5, 0.6, 0.5, 1, 1, 1, 2, 2.2, 2], float)
    elif pitch_type == "FF" and strikes < 2:
        w = w * np.array([1.4, 1.4, 1.4, 1, 1, 1, 0.7, 0.7, 0.7], float)
    return int(rng.choice(np.arange(1, 10), p=w / w.sum()))


def sd_multiplier(p, pitch_type, velocity, fatigue, balls, strikes, tz, batter_hand) -> float:
    spec = PITCH_SPEC[pitch_type]
    mean_v = p["ff_velocity"] + spec["dv"]
    z = np.clip((velocity - mean_v) / spec["vsd"], -3, 3)
    m = spec["sd"]
    m *= 1.0 + 0.07 * max(z, 0) + 0.015 * abs(min(z, 0))   # 평소보다 세게 던질수록 제구 악화
    m *= 1.0 + 0.55 * fatigue ** 1.5                        # 피로 누적 효과
    if balls == 3:
        m *= 1.12                                           # 볼넷 압박
    elif strikes == 2:
        m *= 0.95
    if tz in (1, 3, 7, 9):
        m *= 1.12                                           # 모서리
    elif tz == 5:
        m *= 0.93
    elif tz in (2, 4, 6, 8):
        m *= 1.03
    if pitch_type == "SL" and batter_hand == p["hand"]:
        m *= 0.93                                           # 같은 손 타자 상대 슬라이더 유리
    if pitch_type == "CH" and batter_hand != p["hand"]:
        m *= 0.92                                           # 반대 손 타자 상대 체인지업 유리
    return m


def generate(n_total: int = 100_000, seed: int = 20260412) -> tuple[pd.DataFrame, list[dict]]:
    rng = np.random.default_rng(seed)
    pitchers = make_pitchers(rng)
    per_pitcher = n_total // len(pitchers)

    count_keys = list(COUNT_WEIGHTS)
    count_p = np.array(list(COUNT_WEIGHTS.values()), float)
    count_p /= count_p.sum()

    rows = []
    season_start = pd.Timestamp("2099-03-01")  # 명백한 가상 날짜(실제 경기 일정과 구분)
    for pi, p in enumerate(pitchers):
        game_ids = []
        remaining = per_pitcher
        g = 0
        while remaining > 0:
            g += 1
            mean_len = 100 if p["role"] == "선발" else 46
            length = int(np.clip(rng.normal(mean_len, 12 if p["role"] == "선발" else 6), 15, 125))
            length = min(length, remaining)
            remaining -= length
            game_ids.append((g, length))
        n_g = len(game_ids)
        for gi, (g, length) in enumerate(game_ids):
            # 경기 날짜: 시즌 전체에 걸쳐 투수별로 균등 배치 + 투수별 오프셋
            day = int(gi * (170 / n_g)) + pi % 5
            game_date = season_start + pd.Timedelta(days=day)
            game_id = f"DEMO-{p['pitcher_id']}-G{g:03d}"
            day_form = rng.normal(0, 0.06)  # 그날 컨디션(사전 정보 아님 → 관측되지 않은 잡음)
            usage = np.array(p["usage"]) / np.sum(p["usage"])
            for k in range(length):
                pitch_count = k + 1
                ptype = str(rng.choice(p["repertoire"], p=usage))
                bidx = rng.choice(len(count_keys), p=count_p)
                balls, strikes = count_keys[bidx]
                batter_hand = "L" if rng.random() < 0.38 else "R"
                spec = PITCH_SPEC[ptype]
                velocity = rng.normal(p["ff_velocity"] + spec["dv"] - 0.012 * max(pitch_count - 60, 0), spec["vsd"])
                fatigue = float(np.clip(pitch_count / p["stamina"] * 0.85 + rng.normal(0, 0.05), 0, 1.5))
                tz = choose_target(rng, ptype, balls, strikes)
                tx, ty = ZONE_CENTERS[tz]
                mult = sd_multiplier(p, ptype, velocity, fatigue, balls, strikes, tz, batter_hand)
                sd = max(p["base_sd"] * mult * (1 + day_form), 0.08)
                ax = tx + p["bias_x"] + rng.normal(0, sd)
                ay = ty + p["bias_y"] + spec["bias_y"] + rng.normal(0, sd)
                miss = round(float(np.hypot(ax - tx, ay - ty)), 3)  # 라벨은 저장된 miss_distance 기준
                rows.append((
                    f"{game_id}-{pitch_count:03d}", p["pitcher_id"], game_id, game_date.date().isoformat(),
                    ptype, round(float(velocity), 1), pitch_count, round(fatigue, 3),
                    tz, round(tx, 3), round(ty, 3), round(float(ax), 3), round(float(ay), 3),
                    balls, strikes, batter_hand, p["hand"],
                    miss, int(miss <= SUCCESS_RADIUS), int(abs(ax) <= 1 and abs(ay) <= 1),
                ))
    cols = ["pitch_id", "pitcher_id", "game_id", "game_date", "pitch_type", "velocity", "pitch_count",
            "fatigue", "target_zone", "target_x", "target_y", "actual_x", "actual_y", "balls", "strikes",
            "batter_hand", "pitcher_hand", "miss_distance", "success", "in_zone"]
    df = pd.DataFrame(rows, columns=cols)
    df["data_source"] = "DEMO"
    df["is_demo"] = True
    return df, pitchers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100_000)
    ap.add_argument("--seed", type=int, default=20260412)
    args = ap.parse_args()
    df, pitchers = generate(args.n, args.seed)
    out_dir = ROOT / "data" / "synthetic"
    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_dir / "pitches_demo.csv", index=False, encoding="utf-8")
    meta = dict(
        data_source="DEMO", is_demo=True, seed=args.seed, n_rows=len(df), n_pitchers=len(pitchers),
        success_radius=SUCCESS_RADIUS, pitch_types={k: PITCH_TYPE_KO[k] for k in PITCH_TYPES},
        notice="모든 데이터는 확률 모델로 생성한 가상 데이터(DEMO)이며 실제 선수·경기와 무관합니다.",
        pitchers=pitchers,
    )
    (out_dir / "pitchers_demo.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"generated {len(df):,} rows, success rate {df['success'].mean():.3f}")


if __name__ == "__main__":
    main()
