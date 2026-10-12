"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PITCH_TYPE_KO, PITCH_TYPES, ZONE_NAMES } from "@/lib/constants";
import type { PitcherMeta } from "@/lib/types";
import { api, DataBadge, Field, NativeSelect, pct, SituationControls, useDebounced, type Situation } from "./shared";

interface Row { pitcher_id: string; name: string; hand: string; role?: string; available: boolean; probability: number | null; velocity?: number; fatigue?: number }

export function CompareTab({ pitchers }: { pitchers: PitcherMeta[] }) {
  const [s, setS] = useState<Situation>({ pitch_type: "FF", velocity: 0, pitch_count: 40, balls: 1, strikes: 1, batter_hand: "R" });
  const [zone, setZone] = useState(5);
  const [rows, setRows] = useState<Row[]>([]);
  const [dataSource, setDataSource] = useState("DEMO");
  const [err, setErr] = useState<string | null>(null);
  const [role, setRole] = useState<"전체" | "선발" | "구원">("전체");

  const req = useDebounced({ ...s, velocity: undefined, target_zone: zone, pitcher_ids: pitchers.map((p) => p.pitcher_id) }, 200);
  useEffect(() => {
    const ac = new AbortController();
    const { velocity: _v, ...body } = req;
    void _v;
    api<{ results: Row[]; model: { data_source: string } }>("/api/compare", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal,
    }).then((r) => { setRows(r.results); setDataSource(r.model.data_source); setErr(null); })
      .catch((e) => { if (e.name !== "AbortError") setErr(e.message); });
    return () => ac.abort();
  }, [req]);

  const shown = rows.filter((r) => role === "전체" || r.role === role);
  const avail = shown.filter((r) => r.available);
  const avg = avail.length ? avail.reduce((a, r) => a + (r.probability ?? 0), 0) / avail.length : 0;
  const chart = avail.map((r) => ({ name: r.name.replace("DEMO ", ""), p: Math.round((r.probability ?? 0) * 1000) / 10, id: r.pitcher_id }));

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Card>
        <CardHeader><CardTitle>비교 조건</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-neutral-500">모든 투수에게 같은 상황·구종·코스를 적용합니다. 구속은 각 투수의 평소 구속을 사용합니다.</p>
          <SituationControls s={s} set={(p) => setS((x) => ({ ...x, ...p }))} repertoire={[...PITCH_TYPES]} showVelocity={false} />
          <Field label="목표 코스">
            <NativeSelect value={zone} onChange={(e) => setZone(Number(e.target.value))} aria-label="목표 코스">
              {Object.entries(ZONE_NAMES).map(([z, n]) => <option key={z} value={z}>{z}번 · {n}</option>)}
            </NativeSelect>
          </Field>
          <Field label="역할 필터">
            <NativeSelect value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="역할">
              <option>전체</option><option>선발</option><option>구원</option>
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{PITCH_TYPE_KO[s.pitch_type]} · {zone}번({ZONE_NAMES[zone]}) 투수별 제구 성공 확률</CardTitle>
            <DataBadge source={dataSource} />
          </CardHeader>
          <CardContent>
            {err && <p role="alert" className="mb-2 text-sm text-red-700">{err}</p>}
            <p className="mb-2 text-sm text-neutral-600">평균 <b className="text-[#c30452]">{pct(avg)}</b> · 비교 가능 {avail.length}명 / 구종 미보유 {shown.length - avail.length}명</p>
            <div className="h-[460px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 44, top: 4, bottom: 4 }}>
                  <XAxis type="number" domain={[0, "dataMax + 8"]} tickFormatter={(v) => `${v}%`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={60} fontSize={11} interval={0} />
                  <Tooltip formatter={(v) => [`${v}%`, "제구 성공 확률"]} />
                  <Bar dataKey="p" radius={[0, 6, 6, 0]}>
                    {chart.map((d, i) => <Cell key={d.id} fill={i === 0 ? "#c30452" : d.p >= avg * 100 ? "#e8708f" : "#a9a9b3"} />)}
                    <LabelList dataKey="p" position="right" formatter={(v) => `${v}%`} fontSize={11} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-neutral-500">진한 빨강 = 1위, 연한 빨강 = 평균 이상, 회색 = 평균 미만. DEMO 투수 간 차이는 생성기에 심은 파라미터를 반영한 것입니다.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="overflow-x-auto pt-4">
            <Table>
              <TableHeader><TableRow><TableHead>순위</TableHead><TableHead>투수</TableHead><TableHead>투/역할</TableHead><TableHead className="text-right">구속</TableHead><TableHead className="text-right">피로도</TableHead><TableHead className="text-right">성공 확률</TableHead></TableRow></TableHeader>
              <TableBody>
                {shown.map((r, i) => (
                  <TableRow key={r.pitcher_id} className={!r.available ? "opacity-50" : ""}>
                    <TableCell>{r.available ? i + 1 : "–"}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.hand === "L" ? "좌" : "우"} · {r.role ?? ""}</TableCell>
                    <TableCell className="text-right">{r.velocity ? `${r.velocity}km/h` : "—"}</TableCell>
                    <TableCell className="text-right">{r.fatigue?.toFixed(2) ?? "—"}</TableCell>
                    <TableCell className="text-right font-bold">{r.available ? pct(r.probability) : "구종 미보유"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
