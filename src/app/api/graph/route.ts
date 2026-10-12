import { apiError, json } from "@/lib/http";
import { pitcherMap } from "@/lib/pitchers";
import aggregate from "@/model/aggregate.json";

type Row = [string, string, number, number, number, number, number];
const rows = aggregate.rows as unknown as Row[];

/**
 * Graph 레이어: 투수 → 구종 → 구속대 → 상황 → 목표구역 5계층 관계 그래프.
 * 노드 값 n(투구 수)·rate(제구 성공률), 인접 계층 간 엣지의 가중치는 해당 경로를 통과한 투구 수.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("pitcher") ?? "";
  const p = pitcherMap.get(id);
  if (!p) return apiError("unknown_pitcher", `알 수 없는 투수 ID: ${id}`, 404);
  const mine = rows.filter((r) => r[0] === id);

  const layers = ["pitcher", "pitch_type", "velocity_band", "situation", "zone"] as const;
  const nodes = new Map<string, { id: string; layer: number; label: string; n: number; k: number }>();
  const edges = new Map<string, { source: string; target: string; n: number; k: number }>();
  const touch = (nid: string, layer: number, label: string, n: number, k: number) => {
    const e = nodes.get(nid) ?? { id: nid, layer, label, n: 0, k: 0 };
    e.n += n; e.k += k; nodes.set(nid, e);
  };
  const link = (a: string, b: string, n: number, k: number) => {
    const key = `${a}>${b}`;
    const e = edges.get(key) ?? { source: a, target: b, n: 0, k: 0 };
    e.n += n; e.k += k; edges.set(key, e);
  };
  for (const [, pt, vb, sit, zone, n, k] of mine) {
    const ids = [`P:${id}`, `T:${pt}`, `V:${pt}:${vb}`, `S:${sit}`, `Z:${zone}`];
    const labels = [p.name, pt, aggregate.vband_labels[vb], aggregate.situation_labels[sit], `${zone}번 구역`];
    ids.forEach((nid, i) => touch(nid, i, labels[i], n, k));
    for (let i = 0; i < ids.length - 1; i++) link(ids[i], ids[i + 1], n, k);
  }
  const fmt = <T extends { n: number; k: number }>(x: T) => ({ ...x, rate: x.n ? x.k / x.n : 0 });
  return json({
    pitcher_id: id, layers, data_source: aggregate.data_source,
    nodes: [...nodes.values()].map(fmt), edges: [...edges.values()].map(fmt),
  });
}
