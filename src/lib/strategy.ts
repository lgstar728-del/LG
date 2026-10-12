/**
 * Prompt 레이어: 제구 성공 확률 예측 + 투수별 맞춤 전략 추천.
 * 확률은 학습 모델이 산출하고, '투구 가치 가중치'는 규칙 기반 휴리스틱(학습값 아님)이다.
 * 외부 LLM 없이 결정적(deterministic)으로 동작하며, 아래 buildPromptContext 는 LLM 확장 시 입력 템플릿이 된다.
 */
import { PITCH_TYPE_KO, ZONE_CENTERS, ZONE_NAMES, type PitchType } from "./constants";
import { predictProbability } from "./model";
import { derivedFatigue, typicalVelocity } from "./pitchers";
import type { PitcherMeta, PitchInput } from "./types";

export interface Situation {
  pitch_count: number; balls: number; strikes: number; batter_hand: "L" | "R"; fatigue: number;
}
export interface Recommendation {
  pitch_type: PitchType; pitch_type_ko: string; zone: number; zone_name: string;
  probability: number; value_weight: number; score: number; reason: string;
}

export function situationLabel(balls: number, strikes: number): string {
  if (balls === 3) return "볼넷 압박(3볼)";
  if (strikes === 2) return "투수 유리(2스트라이크)";
  if (balls > strikes) return "타자 유리 카운트";
  if (balls === strikes) return "균형 카운트";
  return "투수 유리 카운트";
}

/** 상황·구역별 투구 가치(휴리스틱): 결정구는 낮고 모서리, 볼카운트 열세에는 존 안 중앙에 가치 */
export function valueWeight(zone: number, balls: number, strikes: number): number {
  const corner = [1, 3, 7, 9].includes(zone);
  const low = [7, 8, 9].includes(zone);
  if (balls === 3 || (balls >= 2 && strikes < 2)) return zone === 5 ? 1.08 : corner ? 0.92 : 1.0;
  if (strikes === 2) return (low ? 1.12 : 1.0) * (corner ? 1.06 : 1.0);
  return corner ? 1.02 : 1.0;
}

export function heatmap(p: PitcherMeta, type: PitchType, velocity: number, s: Situation): number[] {
  return Array.from({ length: 9 }, (_, i) => {
    const z = i + 1;
    const [tx, ty] = ZONE_CENTERS[z];
    const inp: PitchInput = {
      pitcher_id: p.pitcher_id, pitch_type: type, velocity, pitch_count: s.pitch_count, fatigue: s.fatigue,
      target_x: tx, target_y: ty, balls: s.balls, strikes: s.strikes, batter_hand: s.batter_hand, pitcher_hand: p.hand,
    };
    return predictProbability(inp).probability;
  });
}

export function recommend(p: PitcherMeta, s: Situation, selected: { type: PitchType; velocity: number }, top = 5): Recommendation[] {
  const out: Recommendation[] = [];
  for (const type of p.repertoire) {
    const v = type === selected.type ? selected.velocity : typicalVelocity(p, type);
    const hm = heatmap(p, type, v, s);
    hm.forEach((prob, i) => {
      const zone = i + 1;
      const w = valueWeight(zone, s.balls, s.strikes);
      out.push({
        pitch_type: type, pitch_type_ko: PITCH_TYPE_KO[type], zone, zone_name: ZONE_NAMES[zone],
        probability: prob, value_weight: w, score: prob * w, reason: "",
      });
    });
  }
  out.sort((a, b) => b.score - a.score);
  const best = out.slice(0, top);
  for (const r of best) {
    r.reason = `${r.pitch_type_ko}을(를) ${r.zone_name}(${r.zone}번)에 던질 때 예측 제구 성공률 ${(r.probability * 100).toFixed(1)}%` +
      (r.value_weight > 1.02 ? `, ${situationLabel(s.balls, s.strikes)}에서 가치가 높은 코스` : r.value_weight < 0.98 ? `, 이 카운트에선 코스 위험(모서리) 감안` : "");
  }
  return best;
}

export function insights(p: PitcherMeta, selected: { type: PitchType; velocity: number }, s: Situation, selZoneProb: number): string[] {
  const lines: string[] = [];
  const [tx, ty] = ZONE_CENTERS[5];
  const mk = (pc: number, fat: number): PitchInput => ({
    pitcher_id: p.pitcher_id, pitch_type: selected.type, velocity: selected.velocity, pitch_count: pc, fatigue: fat,
    target_x: tx, target_y: ty, balls: s.balls, strikes: s.strikes, batter_hand: s.batter_hand, pitcher_hand: p.hand,
  });
  const fresh = predictProbability(mk(15, derivedFatigue(p, 15))).probability;
  const now = predictProbability(mk(s.pitch_count, s.fatigue)).probability;
  const drop = (fresh - now) * 100;
  if (drop > 3) lines.push(`피로 누적: 투구 수 ${s.pitch_count}개 시점의 정중앙 제구 성공률이 초반(15구) 대비 ${drop.toFixed(1)}%p 낮습니다. 교체·완급 조절을 검토하세요.`);
  else lines.push(`피로 영향이 작습니다(초반 대비 ${drop.toFixed(1)}%p).`);
  const typical = typicalVelocity(p, selected.type);
  const dv = selected.velocity - typical;
  if (dv > 2.5) lines.push(`평소 ${selected.type} 구속(${typical}km/h)보다 ${dv.toFixed(1)}km/h 빠르게 설정되어 있어 힘이 들어가면 제구가 흔들릴 수 있습니다.`);
  if (selZoneProb < 0.25) lines.push(`선택한 코스의 예측 성공률이 ${(selZoneProb * 100).toFixed(1)}%로 낮습니다. 추천 코스로 목표를 옮기는 것을 고려하세요.`);
  lines.push(`현재 상황: ${situationLabel(s.balls, s.strikes)} (${s.balls}B-${s.strikes}S), ${s.batter_hand === "L" ? "좌타" : "우타"} 상대.`);
  return lines;
}

/** LLM 확장용 프롬프트 컨텍스트 템플릿(현재 앱은 호출하지 않음 — 결정적 로직 사용) */
export function buildPromptContext(p: PitcherMeta, s: Situation, recs: Recommendation[]): string {
  return [
    "역할: 야구 데이터 분석가. 아래 모델 예측(합성/DEMO 데이터 학습 가능)을 근거로만 전략을 설명하라. 실제 성능을 단정하지 말 것.",
    `투수: ${p.name} (${p.hand}, ${p.role}), 레퍼토리: ${p.repertoire.join(",")}`,
    `상황: ${s.balls}B-${s.strikes}S, 투구수 ${s.pitch_count}, 피로 ${s.fatigue}, 타자 ${s.batter_hand}`,
    "후보:", ...recs.map((r, i) => `${i + 1}. ${r.pitch_type_ko} ${r.zone_name} p=${r.probability.toFixed(3)} score=${r.score.toFixed(3)}`),
  ].join("\n");
}
