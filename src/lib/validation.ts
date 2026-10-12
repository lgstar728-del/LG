import { z } from "zod";
import { PITCH_TYPES } from "./constants";

export const predictSchema = z.object({
  pitcher_id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  pitch_type: z.enum(PITCH_TYPES),
  velocity: z.number().min(60).max(170).optional(),
  pitch_count: z.number().int().min(1).max(200),
  balls: z.number().int().min(0).max(3),
  strikes: z.number().int().min(0).max(2),
  batter_hand: z.enum(["L", "R"]),
  target_zone: z.number().int().min(1).max(9).default(5),
});
export type PredictRequest = z.infer<typeof predictSchema>;

export const compareSchema = predictSchema.omit({ pitcher_id: true }).extend({
  pitcher_ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)).min(1).max(20),
});
