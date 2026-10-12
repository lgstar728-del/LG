/**
 * 2단계: 실데이터 연동 준비 — CSV 변수 매핑 + 자동 정제.
 * 업로드 데이터는 항상 data_source="REAL" 로 취급하며 DEMO 와 별도 테이블(pitches_real)에 저장한다.
 */
import Papa from "papaparse";
import { SUCCESS_RADIUS, type PitchType } from "./constants";

export const CANONICAL = [
  "pitcher_id", "pitch_type", "velocity", "pitch_count", "target_x", "target_y", "actual_x", "actual_y",
  "balls", "strikes", "batter_hand", "pitcher_hand", "fatigue", "game_id", "game_date", "pitch_id",
] as const;
export type Canonical = (typeof CANONICAL)[number];
export const REQUIRED: Canonical[] = [
  "pitcher_id", "pitch_type", "velocity", "pitch_count", "target_x", "target_y", "actual_x", "actual_y", "balls", "strikes", "batter_hand",
];

const SYNONYMS: Record<Canonical, string[]> = {
  pitcher_id: ["pitcher_id", "pitcher", "투수", "투수id", "투수코드", "선수id", "player_id"],
  pitch_type: ["pitch_type", "구종", "pitchtype", "type"],
  velocity: ["velocity", "speed", "구속", "release_speed", "start_speed"],
  pitch_count: ["pitch_count", "투구수", "투구 수", "pitch_number", "누적투구수"],
  target_x: ["target_x", "목표x", "목표좌표x", "목표_x"],
  target_y: ["target_y", "목표y", "목표좌표y", "목표_y"],
  actual_x: ["actual_x", "실제x", "실제좌표x", "plate_x", "px"],
  actual_y: ["actual_y", "실제y", "실제좌표y", "plate_z", "pz"],
  balls: ["balls", "볼", "볼카운트볼", "ball_count"],
  strikes: ["strikes", "스트라이크", "볼카운트스트라이크", "strike_count"],
  batter_hand: ["batter_hand", "stand", "타자", "타석", "타자좌우", "타자손"],
  pitcher_hand: ["pitcher_hand", "p_throws", "투수좌우", "투구손", "투수손"],
  fatigue: ["fatigue", "피로도", "피로"],
  game_id: ["game_id", "경기id", "경기", "gameid"],
  game_date: ["game_date", "경기일", "날짜", "date"],
  pitch_id: ["pitch_id", "투구id", "투구번호"],
};
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-./]/g, "");

export function autoMapping(headers: string[]): Partial<Record<Canonical, string>> {
  const map: Partial<Record<Canonical, string>> = {};
  for (const c of CANONICAL) {
    const syn = SYNONYMS[c].map(norm);
    const hit = headers.find((h) => syn.includes(norm(h)));
    if (hit) map[c] = hit;
  }
  return map;
}

const PITCH_ALIASES: Record<string, PitchType> = {
  ff: "FF", fa: "FF", fourseam: "FF", 직구: "FF", 패스트볼: "FF", 포심: "FF",
  sl: "SL", 슬라이더: "SL", 슬라: "SL",
  cb: "CB", cu: "CB", kc: "CB", 커브: "CB",
  ch: "CH", 체인지업: "CH", 체인지: "CH",
  fk: "FK", fs: "FK", fo: "FK", sf: "FK", 포크: "FK", 포크볼: "FK",
};
const HAND_ALIASES: Record<string, "L" | "R"> = {
  l: "L", 좌: "L", 좌타: "L", 좌투: "L", left: "L", r: "R", 우: "R", 우타: "R", 우투: "R", right: "R",
};

export interface IngestOptions {
  mapping?: Partial<Record<Canonical, string>>;
  velocityUnit?: "kmh" | "mph";
  coordUnit?: "normalized" | "feet";
}
export interface CleanRow {
  pitch_id: string; pitcher_id: string; game_id: string; game_date: string; pitch_type: PitchType; velocity: number;
  pitch_count: number; fatigue: number; target_x: number; target_y: number; actual_x: number; actual_y: number;
  balls: number; strikes: number; batter_hand: "L" | "R"; pitcher_hand: "L" | "R" | null;
  miss_distance: number; success: boolean; data_source: "REAL";
}
export interface IngestReport {
  rows_in: number; rows_ok: number; rows_rejected: number; duplicates_removed: number;
  mapping: Partial<Record<Canonical, string>>; missing_required: Canonical[];
  reject_reasons: Record<string, number>; fatigue_derived: boolean; warnings: string[];
  success_rate: number | null; retrain_ready: boolean; retrain_note: string;
}

const num = (v: unknown) => {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(/,/g, "");
  return s === "" ? NaN : Number(s);
};

export function ingestCsv(
  text: string,
  opts: IngestOptions = {},
): { rows: CleanRow[]; rejected: { line: number; reasons: string[] }[]; report: IngestReport } {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  const mapping = { ...autoMapping(headers), ...(opts.mapping ?? {}) };
  const missing_required = REQUIRED.filter((c) => !mapping[c]);
  const reasonsCount: Record<string, number> = {};
  const rejected: { line: number; reasons: string[] }[] = [];
  const rows: CleanRow[] = [];
  const seen = new Set<string>();
  let dup = 0;
  const fatigueDerived = !mapping.fatigue;
  const warnings: string[] = [];
  if (parsed.errors.length) warnings.push(`CSV 구문 경고 ${parsed.errors.length}건 (예: ${parsed.errors[0].message})`);

  if (missing_required.length === 0) {
    parsed.data.forEach((raw, idx) => {
      const g = (c: Canonical) => (mapping[c] ? raw[mapping[c]!] : undefined);
      const reasons: string[] = [];
      const ptKey = String(g("pitch_type") ?? "").trim().toLowerCase().replace(/\s/g, "");
      const pitch_type = PITCH_ALIASES[ptKey];
      if (!pitch_type) reasons.push(`지원하지 않는 구종`);
      let velocity = num(g("velocity"));
      if (opts.velocityUnit === "mph") velocity *= 1.609344;
      if (!(velocity >= 60 && velocity <= 170)) reasons.push("구속 범위 오류(60~170km/h)");
      const pitch_count = num(g("pitch_count"));
      if (!(Number.isInteger(pitch_count) && pitch_count >= 1 && pitch_count <= 200)) reasons.push("투구 수 오류(1~200)");
      const balls = num(g("balls")), strikes = num(g("strikes"));
      if (!(Number.isInteger(balls) && balls >= 0 && balls <= 3)) reasons.push("볼 수 오류(0~3)");
      if (!(Number.isInteger(strikes) && strikes >= 0 && strikes <= 2)) reasons.push("스트라이크 수 오류(0~2)");
      let [tx, ty, ax, ay] = [num(g("target_x")), num(g("target_y")), num(g("actual_x")), num(g("actual_y"))];
      if (opts.coordUnit === "feet") {
        // 피트 → 정규화 근사: 가로 반폭 0.83ft, 세로 중심 2.5ft·반높이 0.75ft
        tx /= 0.83; ax /= 0.83; ty = (ty - 2.5) / 0.75; ay = (ay - 2.5) / 0.75;
      }
      if (![tx, ty, ax, ay].every((v) => Number.isFinite(v) && Math.abs(v) <= 3)) reasons.push("좌표 누락/범위 오류(|좌표|≤3)");
      const bh = HAND_ALIASES[String(g("batter_hand") ?? "").trim().toLowerCase()];
      if (!bh) reasons.push("타자 좌우 인식 불가");
      const ph = HAND_ALIASES[String(g("pitcher_hand") ?? "").trim().toLowerCase()] ?? null;
      const pitcher_id = String(g("pitcher_id") ?? "").trim();
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(pitcher_id)) reasons.push("투수 ID 형식 오류(영문·숫자·_- 32자 이내)");

      if (reasons.length) {
        rejected.push({ line: idx + 2, reasons });
        reasons.forEach((r) => { reasonsCount[r] = (reasonsCount[r] ?? 0) + 1; });
        return;
      }
      const game_id = String(g("game_id") ?? "").trim() || `REAL-${pitcher_id}-NA`;
      const pid = String(g("pitch_id") ?? "").trim() || `${game_id}-${String(pitch_count).padStart(3, "0")}-${idx}`;
      const key = g("pitch_id") && g("game_id")
        ? `${game_id}|${pid}`
        : `${pitcher_id}|${game_id}|${pitch_count}|${velocity}|${tx}|${ty}|${ax}|${ay}`;
      if (seen.has(key)) { dup++; return; }
      seen.add(key);
      const f = num(g("fatigue"));
      const fatigue = Number.isFinite(f) ? Math.min(Math.max(f, 0), 1.5) : Math.min((pitch_count / 100) * 0.85, 1.5);
      const miss = Math.round(Math.hypot(ax - tx, ay - ty) * 1000) / 1000;
      rows.push({
        pitch_id: pid, pitcher_id, game_id, game_date: String(g("game_date") ?? "").trim() || "1970-01-01",
        pitch_type: pitch_type!, velocity: Math.round(velocity * 10) / 10, pitch_count,
        fatigue: Math.round(fatigue * 1000) / 1000,
        target_x: tx, target_y: ty, actual_x: ax, actual_y: ay, balls, strikes, batter_hand: bh!, pitcher_hand: ph,
        miss_distance: miss, success: miss <= SUCCESS_RADIUS, data_source: "REAL",
      });
    });
  }
  if (fatigueDerived && rows.length) warnings.push("피로도 컬럼이 없어 투구 수 기반 근사값(pitch_count/100×0.85)으로 대체했습니다.");
  const noDate = rows.some((r) => r.game_date === "1970-01-01");
  if (noDate) warnings.push("game_date 누락 행 존재: 시간순 분할(누출 방지)이 불가능하므로 재학습 전 날짜를 채워야 합니다.");
  const ready = rows.length >= 5000 && !noDate;
  const report: IngestReport = {
    rows_in: parsed.data.length, rows_ok: rows.length, rows_rejected: rejected.length, duplicates_removed: dup,
    mapping, missing_required, reject_reasons: reasonsCount, fatigue_derived: fatigueDerived, warnings,
    success_rate: rows.length ? rows.filter((r) => r.success).length / rows.length : null,
    retrain_ready: ready,
    retrain_note: ready
      ? "재학습 가능: python ml/train.py --real-csv <내보낸 CSV> 후 독립 홀드아웃으로 재검증하세요."
      : "재학습 기준 미달(정제 후 5,000행 이상 + game_date 필요). 합성 데이터 성능을 실제 성능으로 주장할 수 없습니다.",
  };
  return { rows, rejected: rejected.slice(0, 200), report };
}
