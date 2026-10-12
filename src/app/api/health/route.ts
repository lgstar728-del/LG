import { json } from "@/lib/http";
import { model, predictProbability } from "@/lib/model";
import { pitchers } from "@/lib/pitchers";
import { supabaseConfigured } from "@/lib/supabase";

export async function GET() {
  const p = pitchers[0];
  const probe = predictProbability({
    pitcher_id: p.pitcher_id, pitch_type: p.repertoire[0], velocity: p.ff_velocity, pitch_count: 20, fatigue: 0.2,
    target_x: 0, target_y: 0, balls: 0, strikes: 0, batter_hand: "R", pitcher_hand: p.hand,
  }).probability;
  return json({
    status: probe > 0 && probe < 1 ? "ok" : "degraded", model_version: model.version, data_source: model.data_source,
    supabase_configured: supabaseConfigured(), time: new Date().toISOString(),
  });
}
