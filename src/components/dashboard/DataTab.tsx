"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PITCH_TYPE_KO, type PitchType } from "@/lib/constants";
import type { PitcherMeta } from "@/lib/types";
import { api, DataBadge, Field, NativeSelect, pct } from "./shared";

interface Quality { n_rows: number; n_pitchers: number; n_games: number; success_rate: number; all_passed: boolean; checks: { name: string; passed: boolean; detail: string }[]; disclaimer: string }
interface DataRows { source: string; total: number; rows: Record<string, string | number>[]; note?: string; note2?: string }
interface Headers { headers: string[]; suggested_mapping: Record<string, string>; canonical: string[] }
interface UploadResult {
  persisted: boolean; persist_note: string; data_source: string;
  report: { rows_in: number; rows_ok: number; rows_rejected: number; duplicates_removed: number; missing_required: string[]; warnings: string[]; reject_reasons: Record<string, number>; success_rate: number | null; retrain_ready: boolean; retrain_note: string; fatigue_derived: boolean };
  preview: Record<string, string | number | boolean | null>[]; rejected_sample: { line: number; reasons: string[] }[];
}
const REQUIRED = ["pitcher_id", "pitch_type", "velocity", "pitch_count", "target_x", "target_y", "actual_x", "actual_y", "balls", "strikes", "batter_hand"];

export function DataTab({ pitchers, quality }: { pitchers: PitcherMeta[]; quality: Quality }) {
  const [source, setSource] = useState<"demo" | "real">("demo");
  const [pitcher, setPitcher] = useState("");
  const [page, setPage] = useState(1);
  const [token, setToken] = useState("");
  const [data, setData] = useState<DataRows | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const limit = 12;
  useEffect(() => {
    const ac = new AbortController();
    const q = new URLSearchParams({ source, page: String(page), limit: String(limit) });
    if (pitcher) q.set("pitcher", pitcher);
    api<DataRows>(`/api/data?${q}`, { headers: token ? { "x-upload-token": token } : undefined, signal: ac.signal })
      .then((r) => { setData(r); setErr(null); })
      .catch((e) => { if (e.name !== "AbortError") { setErr(e.message); setData(null); } });
    return () => ac.abort();
  }, [source, pitcher, page, token]);

  // 업로드 상태
  const [file, setFile] = useState<File | null>(null);
  const [hdr, setHdr] = useState<Headers | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [vUnit, setVUnit] = useState("kmh");
  const [cUnit, setCUnit] = useState("normalized");
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState<UploadResult | null>(null);
  const [upErr, setUpErr] = useState<string | null>(null);

  const post = async (mode?: "headers") => {
    if (!file) return null;
    const fd = new FormData();
    fd.set("file", file);
    if (mode) fd.set("mode", mode);
    fd.set("mapping", JSON.stringify(mapping));
    fd.set("velocityUnit", vUnit);
    fd.set("coordUnit", cUnit);
    const res = await fetch("/api/upload", { method: "POST", body: fd, headers: token ? { "x-upload-token": token } : undefined });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? "업로드 실패");
    return body;
  };
  const analyze = async () => {
    setBusy(true); setUpErr(null); setUp(null);
    try { const h = (await post("headers")) as Headers; setHdr(h); setMapping(h.suggested_mapping); } catch (e) { setUpErr((e as Error).message); }
    setBusy(false);
  };
  const submit = async () => {
    setBusy(true); setUpErr(null);
    try { setUp((await post()) as UploadResult); } catch (e) { setUpErr((e as Error).message); }
    setBusy(false);
  };

  const cols = ["pitch_id", "pitcher_id", "pitch_type", "velocity", "pitch_count", "balls", "strikes", "target_zone", "miss_distance", "success", "data_source"];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>데이터 조회</CardTitle>
            <div className="flex items-center gap-2"><DataBadge source={source === "demo" ? "DEMO" : "REAL"} /></div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="데이터 구분">
                <NativeSelect value={source} onChange={(e) => { setSource(e.target.value as "demo" | "real"); setPage(1); }} aria-label="데이터 구분">
                  <option value="demo">DEMO (가상 합성)</option><option value="real">REAL (업로드한 실데이터)</option>
                </NativeSelect>
              </Field>
              <Field label="투수 필터">
                <NativeSelect value={pitcher} onChange={(e) => { setPitcher(e.target.value); setPage(1); }} aria-label="투수 필터">
                  <option value="">전체</option>{pitchers.map((p) => <option key={p.pitcher_id} value={p.pitcher_id}>{p.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="접근 토큰" hint="REAL 전용">
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="x-upload-token" autoComplete="off"
                  className="h-9 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus:border-[#c30452]" aria-label="접근 토큰" />
              </Field>
            </div>
            {err && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{err}</p>}
            {data && <p className="text-xs text-neutral-500">{data.note ?? ""} 총 {data.total.toLocaleString()}행{data.source === "DEMO" ? " (미리보기 표본)" : ""}</p>}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>{cols.map((c) => <TableHead key={c} className="whitespace-nowrap text-xs">{c}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {data?.rows.map((r, i) => (
                    <TableRow key={i}>{cols.map((c) => (
                      <TableCell key={c} className="whitespace-nowrap text-xs">
                        {c === "pitch_type" ? `${r[c]} (${PITCH_TYPE_KO[r[c] as PitchType] ?? ""})` : c === "success" ? (r[c] ? "성공" : "실패") : String(r[c] ?? "")}
                      </TableCell>))}</TableRow>
                  ))}
                  {data && data.rows.length === 0 && <TableRow><TableCell colSpan={cols.length} className="text-center text-neutral-500">표시할 데이터가 없습니다.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</Button>
                <Button variant="outline" size="sm" disabled={!data || page * limit >= data.total} onClick={() => setPage((p) => p + 1)}>다음</Button>
                <span className="self-center text-xs text-neutral-500">{page} 페이지</span>
              </div>
              <div className="flex gap-2">
                <a href="/api/download?source=demo" download className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#111] px-2.5 text-[0.8rem] font-medium text-white hover:bg-[#c30452]"><Download className="size-3.5" />DEMO CSV (10만행)</a>
                <Button variant="outline" size="sm" disabled={!token} onClick={async () => {
                  const r = await fetch("/api/download?source=real", { headers: { "x-upload-token": token } });
                  if (!r.ok) { setErr((await r.json()).error?.message ?? "다운로드 실패"); return; }
                  const url = URL.createObjectURL(await r.blob());
                  const a = document.createElement("a"); a.href = url; a.download = "pitches_real.csv"; a.click(); URL.revokeObjectURL(url);
                }}><Download className="size-3.5" />REAL CSV</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>데이터 품질 검증 (Context)</CardTitle>
            <span className={quality.all_passed ? "text-xs font-bold text-emerald-600" : "text-xs font-bold text-red-600"}>{quality.all_passed ? "전체 통과" : "실패 있음"}</span></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-neutral-500">{quality.n_rows.toLocaleString()}행 · 투수 {quality.n_pitchers}명 · 경기 {quality.n_games}개 · 성공률 {pct(quality.success_rate)}</p>
            <ul className="space-y-1.5">
              {quality.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2 text-xs">
                  {c.passed ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" />}
                  <span>{c.name}</span>
                </li>
              ))}
            </ul>
            <p className="rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-900">{quality.disclaimer}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><Upload className="size-4 text-[#c30452]" />실데이터(REAL) CSV 업로드 · 자동 정제</CardTitle><DataBadge source="REAL" /></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs leading-relaxed text-neutral-600">
            KBO·공개 야구 데이터 CSV를 올리면 변수 매핑 → 정제(범위·중복·구종/좌우 표준화) → 제구 성공 라벨링을 수행합니다. 업로드 데이터는 항상 <b>REAL</b>로 DEMO와 별도 테이블에 저장되며,
            저장은 서버에 <code>UPLOAD_TOKEN</code>·Supabase가 설정되고 올바른 토큰을 입력했을 때만 이뤄집니다(그 외에는 검증 미리보기). 최대 4MB.
            필수 컬럼: <code className="break-all">{REQUIRED.join(", ")}</code>
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="CSV 파일"><input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setHdr(null); setUp(null); }} className="block text-sm" aria-label="CSV 파일 선택" /></Field>
            <Field label="구속 단위"><NativeSelect value={vUnit} onChange={(e) => setVUnit(e.target.value)} className="w-28"><option value="kmh">km/h</option><option value="mph">mph</option></NativeSelect></Field>
            <Field label="좌표 단위"><NativeSelect value={cUnit} onChange={(e) => setCUnit(e.target.value)} className="w-36"><option value="normalized">정규화(-1~1)</option><option value="feet">피트(plate_x/z)</option></NativeSelect></Field>
            <Button disabled={!file || busy} onClick={analyze}>1. 헤더 분석</Button>
            <Button disabled={!hdr || busy} onClick={submit} variant="outline">2. 정제·검증 실행</Button>
          </div>
          {upErr && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{upErr}</p>}
          {hdr && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {hdr.canonical.map((c) => (
                <Field key={c} label={`${c}${REQUIRED.includes(c) ? " *" : ""}`}>
                  <NativeSelect value={mapping[c] ?? ""} onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value) n[c] = e.target.value; else delete n[c]; return n; })} aria-label={`${c} 매핑`}>
                    <option value="">(매핑 안 함)</option>{hdr.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </NativeSelect>
                </Field>
              ))}
            </div>
          )}
          {up && (
            <div className="space-y-3 rounded-xl border border-neutral-200 p-3 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["입력 행", up.report.rows_in], ["정제 통과", up.report.rows_ok], ["제외", up.report.rows_rejected], ["중복 제거", up.report.duplicates_removed]].map(([k, v]) => (
                  <div key={String(k)} className="rounded-lg bg-neutral-50 p-2 text-center"><p className="text-xs text-neutral-500">{k}</p><p className="text-lg font-bold">{Number(v).toLocaleString()}</p></div>
                ))}
              </div>
              <p>저장: <b>{up.persisted ? "완료" : "저장 안 함"}</b> — {up.persist_note}</p>
              {up.report.missing_required.length > 0 && <p className="text-red-700">필수 컬럼 미매핑: {up.report.missing_required.join(", ")}</p>}
              {up.report.success_rate != null && <p>실데이터 제구 성공률(라벨 기준): <b>{pct(up.report.success_rate)}</b></p>}
              {up.report.warnings.map((w, i) => <p key={i} className="text-amber-800">⚠ {w}</p>)}
              {Object.entries(up.report.reject_reasons).length > 0 && <p className="text-neutral-600">제외 사유: {Object.entries(up.report.reject_reasons).map(([k, v]) => `${k} ${v}건`).join(" · ")}</p>}
              <p className="rounded-lg bg-sky-50 p-2 text-xs text-sky-900">{up.report.retrain_note} 합성 데이터에서 얻은 성능은 실제 성능이 아니므로 실데이터 전환 시 재학습·재검증이 필수입니다.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
