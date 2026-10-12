"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PitcherMeta } from "@/lib/types";
import { api, DataBadge, Field, NativeSelect, pct } from "./shared";

interface GNode { id: string; layer: number; label: string; n: number; k: number; rate: number }
interface GEdge { source: string; target: string; n: number; k: number; rate: number }
interface Graph { pitcher_id: string; nodes: GNode[]; edges: GEdge[]; data_source: string }

const LAYER_TITLES = ["투수", "구종", "구속대", "상황(카운트)", "목표 구역"];
const W = 980, H = 560, PADX = 70, NODE_W = 120;

function rateColor(rate: number, lo: number, hi: number) {
  const t = hi === lo ? 0.5 : Math.min(1, Math.max(0, (rate - lo) / (hi - lo)));
  return `color-mix(in srgb, #c30452 ${Math.round(15 + t * 85)}%, #9aa0aa)`;
}

export function GraphTab({ pitchers }: { pitchers: PitcherMeta[] }) {
  const [pid, setPid] = useState(pitchers[0].pitcher_id);
  const [g, setG] = useState<Graph | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [minShare, setMinShare] = useState(2);

  useEffect(() => {
    const ac = new AbortController();
    api<Graph>(`/api/graph?pitcher=${encodeURIComponent(pid)}`, { signal: ac.signal }).then((r) => { setG(r); setErr(null); })
      .catch((e) => { if (e.name !== "AbortError") setErr(e.message); });
    return () => ac.abort();
  }, [pid]);

  const layout = useMemo(() => {
    if (!g) return null;
    const total = g.nodes.filter((n) => n.layer === 0).reduce((a, n) => a + n.n, 0) || 1;
    const pos = new Map<string, { x: number; y: number; h: number }>();
    for (let L = 0; L < 5; L++) {
      const ns = g.nodes.filter((n) => n.layer === L);
      if (L === 4) ns.sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
      else if (L === 3) ns.sort((a, b) => a.id.localeCompare(b.id));
      else if (L === 2) ns.sort((a, b) => a.id.localeCompare(b.id));
      else ns.sort((a, b) => b.n - a.n);
      const gap = 6, usable = H - 70;
      const heights = ns.map((n) => Math.max(14, (n.n / total) * (usable - gap * ns.length) * (L === 0 ? 0.9 : 1)));
      const sum = heights.reduce((a, b) => a + b, 0) + gap * (ns.length - 1);
      let y = 50 + (usable - sum) / 2;
      const x = PADX + L * ((W - 2 * PADX - NODE_W) / 4);
      ns.forEach((n, i) => { pos.set(n.id, { x, y, h: heights[i] }); y += heights[i] + gap; });
    }
    const rates = g.edges.map((e) => e.rate);
    return { pos, total, lo: Math.min(...rates), hi: Math.max(...rates) };
  }, [g]);

  const nodeMap = useMemo(() => new Map(g?.nodes.map((n) => [n.id, n]) ?? []), [g]);
  const edges = useMemo(() => (g && layout ? g.edges.filter((e) => (e.n / layout.total) * 100 >= minShare / 10) : []), [g, layout, minShare]);
  const best = useMemo(() => [...(g?.edges ?? [])].filter((e) => e.n >= 60 && e.source.startsWith("S:")).sort((a, b) => b.rate - a.rate), [g]);

  const active = (e: GEdge) => !hover || e.source === hover || e.target === hover;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>투수–구종–구속–상황–목표위치 관계 그래프</CardTitle>
          <DataBadge source={g?.data_source ?? "DEMO"} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="투수">
              <NativeSelect value={pid} onChange={(e) => setPid(e.target.value)} aria-label="그래프 투수 선택">
                {pitchers.map((p) => <option key={p.pitcher_id} value={p.pitcher_id}>{p.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label={`엣지 최소 비중 ${(minShare / 10).toFixed(1)}%`} hint="작은 경로 숨김">
              <input type="range" min={0} max={30} value={minShare} onChange={(e) => setMinShare(Number(e.target.value))} className="w-full accent-[#c30452]" aria-label="엣지 최소 비중" />
            </Field>
          </div>
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            {g && layout ? (
              <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[760px] w-full" role="img" aria-label="관계 그래프">
                {LAYER_TITLES.map((t, L) => (
                  <text key={t} x={PADX + L * ((W - 2 * PADX - NODE_W) / 4) + NODE_W / 2} y={26} textAnchor="middle" className="fill-neutral-500 text-[12px] font-semibold">{t}</text>
                ))}
                {edges.map((e) => {
                  const a = layout.pos.get(e.source)!, b = layout.pos.get(e.target)!;
                  const x1 = a.x + NODE_W, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
                  return (
                    <path key={`${e.source}>${e.target}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none"
                      stroke={rateColor(e.rate, layout.lo, layout.hi)} strokeWidth={Math.max(1, Math.sqrt(e.n / layout.total) * 22)}
                      opacity={active(e) ? 0.55 : 0.06}>
                      <title>{`${nodeMap.get(e.source)?.label} → ${nodeMap.get(e.target)?.label}\n투구 ${e.n.toLocaleString()}개 · 성공률 ${pct(e.rate)}`}</title>
                    </path>
                  );
                })}
                {g.nodes.map((n) => {
                  const p = layout.pos.get(n.id)!;
                  return (
                    <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(n.id)} onBlur={() => setHover(null)} className="cursor-pointer outline-none">
                      <rect x={p.x} y={p.y} width={NODE_W} height={p.h} rx={6} fill={n.layer === 0 ? "#111" : rateColor(n.rate, layout.lo, layout.hi)} stroke={hover === n.id ? "#111" : "none"} strokeWidth={2} />
                      {p.h >= 14 && (
                        <text x={p.x + NODE_W / 2} y={p.y + p.h / 2 + 4} textAnchor="middle" className="fill-white text-[11px] font-semibold" style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.25)", strokeWidth: 2 }}>
                          {n.label.length > 11 ? n.label.slice(0, 11) + "…" : n.label} · {pct(n.rate, 0)}
                        </text>
                      )}
                      <title>{`${n.label}\n투구 ${n.n.toLocaleString()}개 · 제구 성공률 ${pct(n.rate)}`}</title>
                    </g>
                  );
                })}
              </svg>
            ) : <div className="h-[420px] animate-pulse bg-neutral-50" />}
          </div>
          <p className="text-xs text-neutral-500">노드 높이·선 두께 = 투구 수, 색 = 제구 성공률(회색→빨강). 노드에 마우스/포커스를 두면 연결 경로만 강조됩니다. 구속대는 같은 투수·구종 안의 3분위입니다.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>이 투수의 상황→코스 성공률 상위 경로 (60구 이상)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {best.slice(0, 6).map((e) => (
              <div key={`${e.source}${e.target}`} className="rounded-lg border border-neutral-200 p-3 text-sm">
                <p className="font-semibold">{nodeMap.get(e.source)?.label} → {nodeMap.get(e.target)?.label}</p>
                <p className="text-neutral-500">{e.n.toLocaleString()}구 · 성공률 <b className="text-[#c30452]">{pct(e.rate)}</b></p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
