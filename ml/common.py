"""공통 상수 / 특징 공학. 예측 시점(투구 전)에 알 수 있는 정보만 특징으로 사용한다.

데이터 누출 방지 원칙
- actual_x / actual_y / miss_distance / success 는 '투구 후' 결과이므로 특징에서 제외
- 학습/보정/평가는 경기 날짜 기준 시간순 분할 (같은 경기가 두 분할에 걸치지 않음)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

PITCH_TYPES = ["FF", "SL", "CB", "CH", "FK"]
PITCH_TYPE_KO = {"FF": "직구", "SL": "슬라이더", "CB": "커브", "CH": "체인지업", "FK": "포크볼"}

# 스트라이크존 9분할: 1..9 (좌상→우하, 투수 시점 아님 / 포수 시점), 정규화 좌표 [-1,1]
ZONE_CENTERS = {
    1: (-0.667, 0.667), 2: (0.0, 0.667), 3: (0.667, 0.667),
    4: (-0.667, 0.0), 5: (0.0, 0.0), 6: (0.667, 0.0),
    7: (-0.667, -0.667), 8: (0.0, -0.667), 9: (0.667, -0.667),
}
SUCCESS_RADIUS = 0.45  # 실제 좌표가 목표 좌표에서 이 거리 이내면 제구 성공

# 사전(투구 전) 입력 컬럼 — 모델 입력의 원천
RAW_FEATURES = [
    "pitcher_id", "pitch_type", "velocity", "pitch_count", "fatigue",
    "target_x", "target_y", "balls", "strikes", "batter_hand", "pitcher_hand",
]
LEAKY_COLUMNS = ["actual_x", "actual_y", "miss_distance", "success", "in_zone"]


def build_features(df: pd.DataFrame, pitcher_vocab: list[str], pitch_vocab: list[str]) -> pd.DataFrame:
    """원천 컬럼 → 모델 특징행렬. TS 추론 코드(src/lib/model.ts)와 순서·정의가 동일해야 한다."""
    out = pd.DataFrame(index=df.index)
    out["velocity"] = df["velocity"].astype(float)
    out["pitch_count"] = df["pitch_count"].astype(float)
    out["fatigue"] = df["fatigue"].astype(float)
    out["target_x"] = df["target_x"].astype(float)
    out["target_y"] = df["target_y"].astype(float)
    out["balls"] = df["balls"].astype(float)
    out["strikes"] = df["strikes"].astype(float)
    out["batter_left"] = (df["batter_hand"] == "L").astype(float)
    out["same_hand"] = (df["batter_hand"] == df["pitcher_hand"]).astype(float)
    out["target_edge"] = ((df["target_x"].abs() > 0.3) | (df["target_y"].abs() > 0.3)).astype(float)
    for pt in pitch_vocab:
        out[f"pt_{pt}"] = (df["pitch_type"] == pt).astype(float)
    for pid in pitcher_vocab:
        out[f"p_{pid}"] = (df["pitcher_id"] == pid).astype(float)
    return out.astype(np.float32)


def time_split(df: pd.DataFrame, train_frac=0.70, calib_frac=0.15):
    """경기 날짜 기준 시간순 분할. 같은 game_id는 한 분할에만 존재."""
    games = df.groupby("game_id")["game_date"].min().sort_values(kind="stable")
    n = len(games)
    train_games = set(games.index[: int(n * train_frac)])
    calib_games = set(games.index[int(n * train_frac): int(n * (train_frac + calib_frac))])
    test_games = set(games.index[int(n * (train_frac + calib_frac)):])
    return (
        df[df["game_id"].isin(train_games)],
        df[df["game_id"].isin(calib_games)],
        df[df["game_id"].isin(test_games)],
    )
