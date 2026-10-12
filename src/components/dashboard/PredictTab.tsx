"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Lightbulb, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PITCH_TYPE_KO, ZONE_NAMES, type PitchType } from "@/lib/constants";
import type { PitcherMeta } from "@/lib/types";
import { api, DataBadge, Field, NativeSelect, pct, SituationControls, typicalV, useDebounced, type Situation } from "./shared";
import { ZoneHeatmap } from "./ZoneHeatmap";

interface Rec { pitch_type: PitchType; pitch_type_ko: string; zone: number; zone_name: string; probability: number; score: number; reason: string }
interface PredictResult {
  probability: number; heatmap: number[]; recommendations: Rec[]; insights: string[]; fatigue: number;
  model: { data_source: string; version: string; disclaimer: string };
}

function Gauge({ value }: { value: number }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36" role="img" aria-label={`예측 제구 성공 확률 ${(value * 100).toFixed(1)}%`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#e5e5ea" strokeWidth="14" />
      <circle cx="70" cy="70" r={r} fill="none" stroke="#c30452" strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 70 70)" style={{ transition: "stroke-dasharray .4s ease" }} />
      <text x="70" y="68" textAnchor="middle" className="fill-neutral-900 text-[26px] font-extrabold">{(value * 100).toFixed(1)}%</text>
      <text x="70" y="88" textAnchor="middle" className="fill-neutral-500 text-[9px] font-medium">예측 제구 성공</text>
    </svg>
  );
}

export function PredictTab({ pitchers }: { pitchers: PitcherMeta[] }) {
  const [pitcherId, setPitcherId] = useState(pitchers[0].pitcher_id);
  const pitcher = useMemo(() => pitchers.find((p) => p.pitcher_id === pitcherId)!, [pitchers, pitcherId]);
  const [s, setS] = useState<Situation>({
    pitch_type: "FF", velocity: typicalV(pitchers[0], "FF"), pitch_count: 40, balls: 1, strikes: 1, batter_hand: "R",
  });
  const [zone, setZone] = useState(5);
  const [res, setRes] = useState<PredictResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [resKey, setResKey] = useState<string>("");

  const patch = (p: Partial<Situation>) => {
    // 구종이 바뀌면 그 구종의 평소 구속으로 리셋
    if (p.pitch_type && p.pitch_type !== s.pitch_type) p = { velocity: typicalV(pitcher, p.pitch_type), ...p };
    setS((prev) => ({ ...prev, ...p }));
  };
  const changePitcher = (id: string) => {
    const p = pitchers.find((x) => x.pitcher_id === id)!;
    const type = p.repertoire.includes(s.pitch_type) ? s.pitch_type : p.repertoire[0];
    setPitcherId(id);
    setS((prev) => ({ ...prev, pitch_type: type, velocity: typicalV(p, type) }));
  };

  const req = useDebounced({ pitcher_id: pitcherId, ...s, target_zone: zone }, 150);
  useEffect(() => {
    const ac = new AbortController();
    const key = JSON.stringify(req);
    api<PredictResult>("/api/predict", { method: "POST", headers: { "content-type": "application/json" }, body: key, signal: ac.signal })
      .then((r) => { setRes(r); setResKey(key); setErr(null); })
      .catch((e) => { if (e.name !== "AbortError") setErr(e.message); });
    return () => ac.abort();
  }, [req]);
  const loading = resKey !== JSON.stringify(req);

  const top = res?.recommendations[0];
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr_340px]">
      <Card>
        <CardHeader><CardTitle>투구 상황 입력</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="투수" hint={`${pitcher.hand === "L" ? "좌투" : "우투"} · ${pitcher.role}`}>
            <NativeSelect value={pitcherId} onChange={(e) => changePitcher(e.target.value)} aria-label="투수 선택">
              {pitchers.map((p) => <option key={p.pitcher_id} value={p.pitcher_id}>{p.name} ({p.hand === "L" ? "좌" : "우"}·{p.role})</option>)}
            </NativeSelect>
          </Field>
          <SituationControls s={s} set={patch} repertoire={pitcher.repertoire} typical={typicalV(pitcher, s.pitch_type)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>제구 성공 확률 히트맵</CardTitle>
          <DataBadge source={res?.model.data_source ?? "DEMO"} />
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-10">
            {res ? <Gauge value={res.probability} /> : <div className="h-36 w-36 animate-pulse rounded-full bg-neutral-100" />}
            <div className="space-y-1 text-center sm:text-left">
              <p className="text-sm text-neutral-500">선택 코스</p>
              <p className="text-xl font-bold">{zone}번 · {ZONE_NAMES[zone]}</p>
              <p className="text-sm text-neutral-600">{pitcher.name} · {PITCH_TYPE_KO[s.pitch_type]} {s.velocity.toFixed(1)}km/h</p>
              <p className="text-xs text-neutral-500">{s.balls}B-{s.strikes}S · 투구 {s.pitch_count}구 · 피로도 {res ? res.fatigue.toFixed(2) : "—"}</p>
            </div>
          </div>
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <ZoneHeatmap values={res?.heatmap ?? null} selected={zone} onSelect={setZone} best={top?.pitch_type === s.pitch_type ? top.zone : undefined} />
          </div>
          {err && <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="size-4" />{err}</p>}
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>이 확률은 <b>가상(DEMO) 데이터</b>로 학습된 모델의 출력입니다. 실제 투수의 제구 능력이나 실제 경기 결과를 나타내지 않습니다.</span>
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Target className="size-4 text-[#c30452]" />AI 전략 추천 TOP 5</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {res?.recommendations.map((r, i) => (
                <li key={`${r.pitch_type}-${r.zone}`}>
                  <button type="button" onClick={() => { patch({ pitch_type: r.pitch_type }); setZone(r.zone); }}
                    className="w-full rounded-lg border border-neutral-200 bg-white p-2.5 text-left transition hover:border-[#c30452] hover:bg-[#c30452]/5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold"><span className="mr-1.5 text-[#c30452]">{i + 1}</span>{r.pitch_type_ko} · {r.zone}번 {r.zone_name}</span>
                      <span className="text-sm font-extrabold text-[#c30452]">{pct(r.probability)}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-neutral-500">{r.reason}</p>
                  </button>
                </li>
              )) ?? <div className="h-40 animate-pulse rounded-lg bg-neutral-100" />}
            </ol>
            <p className="mt-2 text-[11px] text-neutral-400">점수 = 예측 확률(모델) × 상황 가중치(규칙 기반 휴리스틱). 카드를 누르면 입력에 반영됩니다.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="size-4 text-[#c30452]" />맞춤 인사이트</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm leading-relaxed text-neutral-700">
              {res?.insights.map((t, i) => <li key={i} className="flex gap-2"><span className="text-[#c30452]">•</span>{t}</li>)}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
