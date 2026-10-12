"""Graph 레이어 집계 + 앱 번들용 자산 생성.
 - src/model/aggregate.json : 투수×구종×구속대×상황×목표구역 집계 (관계 그래프용)
 - src/model/{metrics,training_history,quality_report,pitchers}.json : 앱에서 import
 - public/data/pitches_demo.csv : 다운로드용 DEMO CSV
"""
from __future__ import annotations
import json, shutil
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "src" / "model"

def main():
    df = pd.read_csv(ROOT / "data" / "synthetic" / "pitches_demo.csv")
    # 구속대: 투수·구종별 3분위 (저/중/고) — 같은 구종 안에서의 상대적 구속
    df["vband"] = df.groupby(["pitcher_id", "pitch_type"])["velocity"].transform(
        lambda s: pd.qcut(s.rank(method="first"), 3, labels=[0, 1, 2]).astype(int))
    df["sit"] = np.where(df["strikes"] > df["balls"], 0, np.where(df["strikes"] == df["balls"], 1, 2))
    g = df.groupby(["pitcher_id", "pitch_type", "vband", "sit", "target_zone"]).agg(n=("success", "size"), k=("success", "sum")).reset_index()
    rows = g[["pitcher_id", "pitch_type", "vband", "sit", "target_zone", "n", "k"]].values.tolist()
    (MODEL / "aggregate.json").write_text(json.dumps(dict(
        columns=["pitcher_id", "pitch_type", "vband", "situation", "zone", "n", "k"],
        vband_labels=["저속", "중속", "고속"], situation_labels=["투수 유리(S>B)", "균형(S=B)", "타자 유리(B>S)"],
        data_source="DEMO", rows=rows), separators=(",", ":")), encoding="utf-8")
    # 데이터 탭 미리보기용: 투수별 층화 샘플 100행씩 (서버리스 번들 포함)
    samp = df.groupby("pitcher_id", group_keys=False).sample(n=100, random_state=1).sort_values(["pitcher_id", "game_id", "pitch_count"])
    cols = ["pitch_id", "pitcher_id", "game_date", "pitch_type", "velocity", "pitch_count", "fatigue", "target_zone", "target_x", "target_y", "actual_x", "actual_y", "balls", "strikes", "batter_hand", "miss_distance", "success", "data_source"]
    (MODEL / "sample_rows.json").write_text(json.dumps(samp[cols].to_dict(orient="records"), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for name in ["metrics", "training_history", "quality_report"]:
        shutil.copy(ROOT / "data" / f"{name}.json", MODEL / f"{name}.json")
    shutil.copy(ROOT / "data" / "synthetic" / "pitchers_demo.json", MODEL / "pitchers.json")
    (ROOT / "public" / "data").mkdir(parents=True, exist_ok=True)
    shutil.copy(ROOT / "data" / "synthetic" / "pitches_demo.csv", ROOT / "public" / "data" / "pitches_demo.csv")
    # 학습 이력 첫 항목 주석 (초기 Isotonic 보정 실험 기록)
    hp = ROOT / "data" / "training_history.json"
    hist = json.loads(hp.read_text(encoding="utf-8"))
    if hist and not hist[0].get("notes"):
        hist[0]["notes"] = "초기 학습: Isotonic 보정 적용 → ECE 악화(과적합) 확인, 다음 회차에서 보정 방식 자동 선택 도입"
        hp.write_text(json.dumps(hist, ensure_ascii=False, indent=2), encoding="utf-8")
        shutil.copy(hp, MODEL / "training_history.json")
    print("assets ok", len(rows), "agg rows")
main()
