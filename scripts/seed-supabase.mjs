// DEMO 데이터와 학습 이력을 Supabase 에 적재한다.
// 사용: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-supabase.mjs
// (먼저 supabase/schema.sql 을 SQL Editor 에서 실행해야 한다.) pitches_demo 에만 쓰며 REAL 테이블은 건드리지 않는다.
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { readFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const csv = readFileSync(new URL("../public/data/pitches_demo.csv", import.meta.url), "utf8");
const { data } = Papa.parse(csv, { header: true, dynamicTyping: true, skipEmptyLines: true });
const rows = data.map((r) => ({
  pitch_id: r.pitch_id, pitcher_id: r.pitcher_id, game_id: r.game_id, game_date: r.game_date, pitch_type: r.pitch_type,
  velocity: r.velocity, pitch_count: r.pitch_count, fatigue: r.fatigue, target_zone: r.target_zone,
  target_x: r.target_x, target_y: r.target_y, actual_x: r.actual_x, actual_y: r.actual_y, balls: r.balls, strikes: r.strikes,
  batter_hand: r.batter_hand, pitcher_hand: r.pitcher_hand, miss_distance: r.miss_distance,
  success: r.success === 1 || r.success === true, in_zone: r.in_zone === 1 || r.in_zone === true, data_source: "DEMO", is_demo: true,
}));
console.log(`DEMO ${rows.length.toLocaleString()}행 적재 시작...`);
for (let i = 0; i < rows.length; i += 2000) {
  const { error } = await sb.from("pitches_demo").upsert(rows.slice(i, i + 2000), { onConflict: "pitch_id" });
  if (error) { console.error(`청크 ${i / 2000} 실패:`, error.message); process.exit(1); }
  if ((i / 2000) % 10 === 0) console.log(`  ${i + 2000}/${rows.length}`);
}
const hist = JSON.parse(readFileSync(new URL("../data/training_history.json", import.meta.url), "utf8"));
const { error: hErr } = await sb.from("training_runs").upsert(
  hist.map((h) => ({ version: h.version, trained_at: h.trained_at, data_source: h.data_source, n_train: h.n_train, n_test: h.n_test, roc_auc: h.roc_auc, brier: h.brier, ece: h.ece, notes: h.notes })),
  { onConflict: "version" },
);
if (hErr) { console.error("training_runs 실패:", hErr.message); process.exit(1); }
console.log("완료.");
