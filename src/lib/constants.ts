export const PITCH_TYPES = ["FF", "SL", "CB", "CH", "FK"] as const;
export type PitchType = (typeof PITCH_TYPES)[number];
export const PITCH_TYPE_KO: Record<PitchType, string> = {
  FF: "직구",
  SL: "슬라이더",
  CB: "커브",
  CH: "체인지업",
  FK: "포크볼",
};
/** 직구 대비 평균 구속 차이(km/h) — DEMO 생성기(ml/generate_data.py)와 동일. UI 기본 구속 계산용 */
export const PITCH_DV: Record<PitchType, number> = { FF: 0, SL: -9, CB: -22, CH: -12, FK: -10 };

/** 스트라이크존 9분할 (포수 시점, 1=좌상 … 9=우하), 정규화 좌표 [-1,1] */
export const ZONE_CENTERS: Record<number, [number, number]> = {
  1: [-0.667, 0.667], 2: [0, 0.667], 3: [0.667, 0.667],
  4: [-0.667, 0], 5: [0, 0], 6: [0.667, 0],
  7: [-0.667, -0.667], 8: [0, -0.667], 9: [0.667, -0.667],
};
export const ZONE_NAMES: Record<number, string> = {
  1: "좌상", 2: "상단 중앙", 3: "우상", 4: "좌중", 5: "정중앙", 6: "우중", 7: "좌하", 8: "하단 중앙", 9: "우하",
};
export const SUCCESS_RADIUS = 0.45;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel 서버리스 요청 본문 한도(4.5MB) 이내
export type Hand = "L" | "R";
