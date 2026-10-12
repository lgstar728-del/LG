import type { Hand, PitchType } from "./constants";

export interface PitchInput {
  pitcher_id: string;
  pitch_type: PitchType;
  velocity: number;
  pitch_count: number;
  fatigue: number;
  target_x: number;
  target_y: number;
  balls: number;
  strikes: number;
  batter_hand: Hand;
  pitcher_hand: Hand;
}

export interface PitcherMeta {
  pitcher_id: string;
  name: string;
  hand: Hand;
  role: string;
  base_sd: number;
  stamina: number;
  ff_velocity: number;
  repertoire: PitchType[];
  usage: number[];
  is_demo: boolean;
  data_source: string;
}

export type DataSource = "DEMO" | "REAL" | "MIXED";
