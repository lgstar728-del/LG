import { describe, expect, it } from "vitest";
import { POST as predict } from "@/app/api/predict/route";
import { POST as compare } from "@/app/api/compare/route";
import { GET as graph } from "@/app/api/graph/route";
import { GET as metrics } from "@/app/api/metrics/route";
import { GET as meta } from "@/app/api/meta/route";
import { GET as health } from "@/app/api/health/route";
import { GET as data } from "@/app/api/data/route";
import { GET as download } from "@/app/api/download/route";
import { POST as upload } from "@/app/api/upload/route";

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const valid = { pitcher_id: "P01", pitch_type: "FF", pitch_count: 40, balls: 1, strikes: 2, batter_hand: "L", target_zone: 7 };

describe("API", () => {
  it("/api/predict: 확률·히트맵(9)·추천·DEMO 표시 반환", async () => {
    const res = await predict(post("/api/predict", valid));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.probability).toBeGreaterThan(0);
    expect(j.heatmap).toHaveLength(9);
    expect(j.recommendations.length).toBeGreaterThan(1);
    expect(j.model.data_source).toBe("DEMO");
    expect(j.recommendations[0].score).toBeGreaterThanOrEqual(j.recommendations[1].score);
  });

  it("/api/predict: 잘못된 입력 422, 깨진 JSON 400, 미지 투수 404, 인젝션 형태 ID 422", async () => {
    expect((await predict(post("/api/predict", { ...valid, balls: 9 }))).status).toBe(422);
    expect((await predict(post("/api/predict", "{oops"))).status).toBe(400);
    expect((await predict(post("/api/predict", { ...valid, pitcher_id: "ZZZ" }))).status).toBe(404);
    expect((await predict(post("/api/predict", { ...valid, pitcher_id: "P01; DROP TABLE" }))).status).toBe(422);
    const m = await (await meta()).json();
    const p = m.pitchers[0];
    const missing = ["FF", "SL", "CB", "CH", "FK"].find((t) => !p.repertoire.includes(t));
    if (missing) {
      expect((await predict(post("/api/predict", { ...valid, pitcher_id: p.pitcher_id, pitch_type: missing }))).status).toBe(422);
    }
  });

  it("/api/compare: 투수별 확률 내림차순", async () => {
    const res = await compare(
      post("/api/compare", { pitcher_ids: ["P01", "P02", "P03", "P04"], pitch_type: "FF", pitch_count: 30, balls: 0, strikes: 0, batter_hand: "R", target_zone: 5 }),
    );
    expect(res.status).toBe(200);
    const { results } = await res.json();
    const probs = results.filter((r: { available: boolean }) => r.available).map((r: { probability: number }) => r.probability);
    expect(probs.length).toBeGreaterThan(1);
    expect(probs).toEqual([...probs].sort((a: number, b: number) => b - a));
  });

  it("/api/graph: 5계층 노드/엣지", async () => {
    const j = await (await graph(new Request("http://localhost/api/graph?pitcher=P05"))).json();
    expect(new Set(j.nodes.map((n: { layer: number }) => n.layer))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(j.edges.length).toBeGreaterThan(5);
    expect((await graph(new Request("http://localhost/api/graph?pitcher=NOPE"))).status).toBe(404);
  });

  it("/api/metrics, /api/health, /api/data(DEMO)", async () => {
    const m = await (await metrics()).json();
    expect(m.metrics.data_source).toBe("DEMO");
    expect(m.metrics.test.calibrated.roc_auc).toBeGreaterThan(0.5);
    expect((await (await health()).json()).status).toBe("ok");
    const d = await (await data(new Request("http://localhost/api/data?source=demo&pitcher=P02&limit=5"))).json();
    expect(d.rows).toHaveLength(5);
    expect(d.rows.every((r: { data_source: string; pitcher_id: string }) => r.data_source === "DEMO" && r.pitcher_id === "P02")).toBe(true);
  });

  it("실데이터 조회/다운로드는 토큰 없으면 401, DEMO 다운로드는 리다이렉트", async () => {
    expect((await data(new Request("http://localhost/api/data?source=real"))).status).toBe(401);
    expect((await download(new Request("http://localhost/api/download?source=real"))).status).toBe(401);
    expect((await download(new Request("http://localhost/api/download"))).status).toBe(307);
  });

  it("/api/upload: 검증 미리보기(저장 안 함), 파일 누락 거부", async () => {
    const csv = [
      "투수,구종,구속,투구수,목표x,목표y,실제x,실제y,볼,스트라이크,타자,경기일",
      "R01,직구,148,12,0,0,0.1,0.1,1,1,좌,2025-04-01",
      "R01,슬라이더,139,13,0.667,-0.667,0.2,-0.5,1,2,우,2025-04-01",
      "R01,직구,300,14,0,0,0,0,0,0,좌,2025-04-01",
    ].join("\n");
    const fd = new FormData();
    fd.set("file", new File([csv], "real.csv", { type: "text/csv" }));
    const j = await (await upload(new Request("http://localhost/api/upload", { method: "POST", body: fd }))).json();
    expect(j.persisted).toBe(false);
    expect(j.data_source).toBe("REAL");
    expect(j.report.rows_ok).toBe(2);
    expect(j.report.rows_rejected).toBe(1);
    expect(j.report.retrain_ready).toBe(false);
    const empty = await upload(new Request("http://localhost/api/upload", { method: "POST", body: new FormData() }));
    expect(empty.status).toBe(422);
  });
});
