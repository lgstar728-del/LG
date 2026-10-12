import { ZONE_CENTERS } from "@/lib/constants";
import { apiError, guard, json, readJson } from "@/lib/http";
import { model, predictProbability } from "@/lib/model";
import { derivedFatigue, pitcherMap, typicalVelocity } from "@/lib/pitchers";
import { compareSchema } from "@/lib/validation";

/** 같은 상황·구종·목표 구역에서 여러 투수의 예측 제구 성공률을 비교 */
export async function POST(req: Request) {
  const limited = guard(req, 60);
  if (limited) return limited;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = compareSchema.safeParse(body.data);
  if (!parsed.success) return apiError("invalid_input", "입력값이 올바르지 않습니다.", 422, { issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  const q = parsed.data;
  const [tx, ty] = ZONE_CENTERS[q.target_zone];

  const results = [];
  for (const id of q.pitcher_ids) {
    const p = pitcherMap.get(id);
    if (!p) continue;
    // 레퍼토리에 없는 구종이면 해당 투수는 비교에서 제외(결과에 사유 표시)
    if (!p.repertoire.includes(q.pitch_type)) {
      results.push({ pitcher_id: id, name: p.name, hand: p.hand, available: false, probability: null });
      continue;
    }
    const fatigue = derivedFatigue(p, q.pitch_count);
    const velocity = q.velocity ?? typicalVelocity(p, q.pitch_type);
    const { probability } = predictProbability({
      pitcher_id: id, pitch_type: q.pitch_type, velocity, pitch_count: q.pitch_count, fatigue, target_x: tx, target_y: ty,
      balls: q.balls, strikes: q.strikes, batter_hand: q.batter_hand, pitcher_hand: p.hand,
    });
    results.push({ pitcher_id: id, name: p.name, hand: p.hand, role: p.role, available: true, probability, velocity, fatigue });
  }
  results.sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1));
  return json({ results, model: { version: model.version, data_source: model.data_source } });
}
