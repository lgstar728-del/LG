import pitchersJson from "@/model/pitchers.json";
import { PITCH_DV, type PitchType } from "./constants";
import type { PitcherMeta, PitchInput } from "./types";

export const pitchers = (pitchersJson as unknown as { pitchers: PitcherMeta[] }).pitchers;
export const pitcherMap = new Map(pitchers.map((p) => [p.pitcher_id, p]));

export function typicalVelocity(p: PitcherMeta, type: PitchType): number {
  return Math.round((p.ff_velocity + PITCH_DV[type]) * 10) / 10;
}

/** DEMO 생성 규칙의 결정론적 부분(잡음 제외): 투구 수/체력 기반 피로도 */
export function derivedFatigue(p: PitcherMeta, pitchCount: number): number {
  return Math.round(Math.min(Math.max((pitchCount / p.stamina) * 0.85, 0), 1.5) * 1000) / 1000;
}

export type SituationInput = Omit<PitchInput, "target_x" | "target_y" | "pitch_type" | "velocity" | "pitcher_hand" | "fatigue"> &
  { fatigue?: number };
