// 배포된(또는 로컬) 서버를 대상으로 하는 스모크 테스트.
// 사용: node scripts/smoke.mjs [BASE_URL]   (기본 http://localhost:3000)
const base = (process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
};
const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const home = await fetch(base + "/");
const html = await home.text();
check("GET / 200 + DEMO 표시", home.status === 200 && html.includes("DEMO"), `status ${home.status}`);

const health = await (await fetch(base + "/api/health")).json();
check("GET /api/health ok", health.status === "ok", `model ${health.model_version}, supabase=${health.supabase_configured}`);

const meta = await (await fetch(base + "/api/meta")).json();
check("GET /api/meta 투수 20명", meta.pitchers?.length === 20);

const p = await post("/api/predict", { pitcher_id: "P01", pitch_type: "FF", pitch_count: 45, balls: 1, strikes: 2, batter_hand: "R", target_zone: 8 });
const pj = await p.json();
check("POST /api/predict 확률/히트맵/추천", p.status === 200 && pj.probability > 0 && pj.probability < 1 && pj.heatmap?.length === 9 && pj.recommendations?.length > 0, `p=${pj.probability?.toFixed(3)}`);
check("예측 응답에 DEMO 표시", pj.model?.data_source === "DEMO");

check("잘못된 입력은 422", (await post("/api/predict", { pitcher_id: "P01", pitch_type: "FF", pitch_count: 45, balls: 7, strikes: 2, batter_hand: "R" })).status === 422);

const cmp = await (await post("/api/compare", { pitcher_ids: ["P01", "P02", "P03"], pitch_type: "FF", pitch_count: 30, balls: 0, strikes: 0, batter_hand: "L", target_zone: 5 })).json();
check("POST /api/compare", cmp.results?.length === 3);

const g = await (await fetch(base + "/api/graph?pitcher=P03")).json();
check("GET /api/graph", g.nodes?.length > 10 && g.edges?.length > 10);

const m = await (await fetch(base + "/api/metrics")).json();
check("GET /api/metrics (AUC>0.5, DEMO)", m.metrics?.test?.calibrated?.roc_auc > 0.5 && m.metrics?.data_source === "DEMO");

const d = await (await fetch(base + "/api/data?source=demo&limit=3")).json();
check("GET /api/data DEMO", d.rows?.length === 3 && d.rows.every((r) => r.data_source === "DEMO"));

check("실데이터 조회는 토큰 없으면 401", (await fetch(base + "/api/data?source=real")).status === 401);

const csv = await fetch(base + "/data/pitches_demo.csv", { method: "HEAD" });
check("DEMO CSV 다운로드 가능", csv.status === 200, `${Math.round(Number(csv.headers.get("content-length") ?? 0) / 1024)}KB`);

console.log(failed ? `\n${failed}개 실패` : "\n모든 스모크 테스트 통과");
process.exit(failed ? 1 : 0);
