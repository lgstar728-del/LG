"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PITCH_TYPE_KO, PITCH_DV, type PitchType } from "@/lib/constants";
import type { PitcherMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DataSourceLabel = "DEMO" | "REAL" | "MIXED";

export function DataBadge({ source, className }: { source: DataSourceLabel | string; className?: string }) {
  const real = source === "REAL";
  const mixed = source === "MIXED";
  return (
    <Badge
      className={cn(
        "font-bold tracking-wide",
        real ? "bg-emerald-600 text-white" : mixed ? "bg-sky-600 text-white" : "bg-amber-400 text-black",
        className,
      )}
      title={real ? "실제 데이터" : mixed ? "합성+실제 혼합" : "가상(합성) 데이터 — 실제 선수·경기와 무관"}
    >
      {source}
    </Badge>
  );
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `요청 실패 (${res.status})`);
  return body as T;
}

/** 값이 바뀐 뒤 delay ms 동안 추가 변경이 없을 때만 갱신. 객체 동일성이 아니라 직렬화된 값 기준으로 비교한다. */
export function useDebounced<T>(value: T, delay = 180): T {
  const key = JSON.stringify(value);
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV((prev) => (JSON.stringify(prev) === key ? prev : (JSON.parse(key) as T))), delay);
    return () => clearTimeout(t);
  }, [key, delay]);
  return v;
}

export const pct = (p: number | null | undefined, d = 1) => (p == null ? "—" : `${(p * 100).toFixed(d)}%`);

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-xs font-semibold text-neutral-600">
        {label}
        {hint && <span className="font-normal text-neutral-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-9 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus:border-[#c30452] focus:ring-2 focus:ring-[#c30452]/30",
        props.className,
      )}
    />
  );
}

export function Segmented<T extends string | number>({
  value, options, onChange, ariaLabel,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex w-full overflow-hidden rounded-lg border border-neutral-300 bg-white">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-9 flex-1 px-2 text-sm font-medium transition-colors",
            o.value === value ? "bg-[#c30452] text-white" : "text-neutral-700 hover:bg-neutral-100",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface Situation {
  pitch_type: PitchType;
  velocity: number;
  pitch_count: number;
  balls: number;
  strikes: number;
  batter_hand: "L" | "R";
}

export function typicalV(p: PitcherMeta, t: PitchType) {
  return Math.round((p.ff_velocity + PITCH_DV[t]) * 10) / 10;
}

/** 구종·구속·투구 수·볼카운트·타자 선택 컨트롤 (예측/비교 탭 공용) */
export function SituationControls({
  s, set, repertoire, typical, showVelocity = true,
}: {
  s: Situation; set: (patch: Partial<Situation>) => void; repertoire: PitchType[]; typical?: number; showVelocity?: boolean;
}) {
  return (
    <div className="space-y-4">
      <Field label="구종">
        <Segmented
          ariaLabel="구종"
          value={s.pitch_type}
          options={repertoire.map((t) => ({ value: t, label: PITCH_TYPE_KO[t] }))}
          onChange={(t) => set({ pitch_type: t })}
        />
      </Field>
      {showVelocity && (
        <Field label={`구속 ${s.velocity.toFixed(1)} km/h`} hint={typical ? `평소 ${typical}` : undefined}>
          <input type="range" className="w-full accent-[#c30452]" min={90} max={165} step={0.5} value={s.velocity}
            onChange={(e) => set({ velocity: Number(e.target.value) })} aria-label="구속" />
        </Field>
      )}
      <Field label={`투구 수 ${s.pitch_count}구`} hint="피로도 자동 반영">
        <input type="range" className="w-full accent-[#c30452]" min={1} max={130} step={1} value={s.pitch_count}
          onChange={(e) => set({ pitch_count: Number(e.target.value) })} aria-label="투구 수" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="볼">
          <Segmented ariaLabel="볼" value={s.balls} options={[0, 1, 2, 3].map((v) => ({ value: v, label: String(v) }))} onChange={(v) => set({ balls: v })} />
        </Field>
        <Field label="스트라이크">
          <Segmented ariaLabel="스트라이크" value={s.strikes} options={[0, 1, 2].map((v) => ({ value: v, label: String(v) }))} onChange={(v) => set({ strikes: v })} />
        </Field>
      </div>
      <Field label="타자">
        <Segmented ariaLabel="타자 좌우" value={s.batter_hand} options={[{ value: "L", label: "좌타" }, { value: "R", label: "우타" }]} onChange={(v) => set({ batter_hand: v })} />
      </Field>
    </div>
  );
}
