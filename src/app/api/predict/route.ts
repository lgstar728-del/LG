import { ZONE_CENTERS } from "@/lib/constants";
import { apiError, guard, json, readJson } from "@/lib/http";
import { model, predictProbability } from "@/lib/model";
import { derivedFatigue, pitcherMap, typicalVelocity } from "@/lib/pitchers";
import { buildPromptContext, heatmap, insights, recommend } from "@/lib/strategy";
import { getSupabase } from "@/lib/supabase";
import { predictSchema } from "@/lib/validation";
import type { PitchInput } from "@/lib/types";

export async function POST(req: Request) {
  const limited = guard(req, 120);
  if (limited) return limited;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = predictSchema.safeParse(body.data);
  if (!parsed.success) return apiError("invalid_input", "입력값이 올바르지 않습니다.", 422, { issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  const q = parsed.data;

  const pitcher = pitcherMap.get(q.pitcher_id);
  if (!pitcher) return apiError("unknown_pitcher", `알 수 없는 투수 ID: ${q.pitcher_id}`, 404);
  if (!pitcher.repertoire.includes(q.pitch_type))
    return apiError("pitch_not_in_repertoire", `${pitcher.name}은(는) ${q.pitch_type} 구종을 던지지 않습니다.`, 422, { repertoire: pitcher.repertoire });

  const velocity = q.velocity ?? typicalVelocity(pitcher, q.pitch_type);
  const fatigue = derivedFatigue(pitcher, q.pitch_count);
  const s = { pitch_count: q.pitch_count, balls: q.balls, strikes: q.strikes, batter_hand: q.batter_hand, fatigue };
  const [tx, ty] = ZONE_CENTERS[q.target_zone];
  const input: PitchInput = {
    pitcher_id: pitcher.pitcher_id, pitch_type: q.pitch_type, velocity, pitch_count: q.pitch_count, fatigue,
    target_x: tx, target_y: ty, balls: q.balls, strikes: q.strikes, batter_hand: q.batter_hand, pitcher_hand: pitcher.hand,
  };
  const { probability, raw } = predictProbability(input);
  const hm = heatmap(pitcher, q.pitch_type, velocity, s);
  const sel = { type: q.pitch_type, velocity };
  const recs = recommend(pitcher, s, sel, 5);

  // 예측 로그(선택): 서비스 키가 있고 LOG_PREDICTIONS=true 일 때만. 실패해도 응답에 영향 없음.
  const sb = getSupabase();
  if (sb && process.env.LOG_PREDICTIONS === "true") {
    void sb.from("prediction_logs").insert({
      pitcher_id: pitcher.pitcher_id, pitch_type: q.pitch_type, inputs: input, probability,
      model_version: model.version, data_source: model.data_source,
    }).then(() => undefined, () => undefined);
  }

  return json({
    probability, raw_probability: raw, target_zone: q.target_zone, velocity, fatigue, heatmap: hm,
    recommendations: recs, insights: insights(pitcher, sel, s, probability),
    prompt_context: buildPromptContext(pitcher, s, recs),
    model: { version: model.version, data_source: model.data_source, trained_at: model.trained_at, disclaimer: model.disclaimer },
  });
}
