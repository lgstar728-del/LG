"""Context 레이어: 데이터 품질 검증 + 합성 패턴 존재 확인 → data/quality_report.json"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]


def validate(df: pd.DataFrame, source: str) -> dict:
    checks = []

    def check(name, ok, detail=""):
        checks.append(dict(name=name, passed=bool(ok), detail=str(detail)))

    check("행 수 > 0", len(df) > 0, len(df))
    check("결측치 없음", int(df.isna().sum().sum()) == 0, int(df.isna().sum().sum()))
    check("pitch_id 중복 없음", df["pitch_id"].is_unique)
    check("구속 범위 60~170km/h", df["velocity"].between(60, 170).all())
    check("볼카운트 범위 (0-3볼, 0-2스트라이크)", df["balls"].between(0, 3).all() and df["strikes"].between(0, 2).all())
    check("피로도 0~1.5", df["fatigue"].between(0, 1.5).all())
    check("success 라벨 = (miss_distance <= 0.45)", ((df["miss_distance"] <= 0.45).astype(int) == df["success"]).all())
    if source == "DEMO":
        check("모든 행 DEMO 표시", (df["data_source"] == "DEMO").all() and df["is_demo"].all())

    # 합성 패턴 검증: 의도한 확률적 패턴이 데이터에 실제로 존재하는지
    fat_bins = pd.cut(df["fatigue"], [-0.01, 0.3, 0.6, 0.9, 1.6])
    fat_rate = df.groupby(fat_bins, observed=True)["success"].mean()
    check("피로도↑ → 성공률↓ (단조 감소)", fat_rate.is_monotonic_decreasing, fat_rate.round(3).tolist())
    type_rate = df.groupby("pitch_type")["success"].mean()
    check("직구 성공률 > 커브·포크 성공률", type_rate["FF"] > type_rate["CB"] and type_rate["FF"] > type_rate["FK"],
          type_rate.round(3).to_dict())
    zone_rate = df.groupby("target_zone")["success"].mean()
    check("중앙(5) 성공률 > 모서리 평균", zone_rate[5] > zone_rate[[1, 3, 7, 9]].mean(),
          zone_rate.round(3).to_dict())
    pit_rate = df.groupby("pitcher_id")["success"].mean()
    check("투수 간 성공률 편차 존재 (max-min > 0.10)", pit_rate.max() - pit_rate.min() > 0.10,
          f"{pit_rate.min():.3f}~{pit_rate.max():.3f}")

    report = dict(
        data_source=source,
        n_rows=int(len(df)), n_pitchers=int(df["pitcher_id"].nunique()), n_games=int(df["game_id"].nunique()),
        success_rate=round(float(df["success"].mean()), 4),
        class_balance=dict(success=int(df["success"].sum()), fail=int((1 - df["success"]).sum())),
        by_pitch_type={k: round(float(v), 4) for k, v in type_rate.items()},
        by_fatigue_bin={str(k): round(float(v), 4) for k, v in fat_rate.items()},
        by_zone={int(k): round(float(v), 4) for k, v in zone_rate.items()},
        by_pitcher={k: round(float(v), 4) for k, v in pit_rate.items()},
        checks=checks,
        all_passed=all(c["passed"] for c in checks),
        disclaimer="DEMO 데이터의 패턴은 생성기 규칙의 결과이며 실제 투수 특성을 나타내지 않습니다." if source == "DEMO" else "",
    )
    return report


if __name__ == "__main__":
    csv = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "synthetic" / "pitches_demo.csv"
    src = sys.argv[2] if len(sys.argv) > 2 else "DEMO"
    rep = validate(pd.read_csv(csv), src)
    out = ROOT / "data" / ("quality_report.json" if src == "DEMO" else f"quality_report_{src.lower()}.json")
    out.write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
    for c in rep["checks"]:
        print(("PASS" if c["passed"] else "FAIL"), c["name"], c["detail"])
    sys.exit(0 if rep["all_passed"] else 1)
