"use client";

import { ZONE_NAMES } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** 스트라이크존 9분할 히트맵. 색 농도는 현재 9개 확률의 min~max 로 정규화(상대 비교). */
export function ZoneHeatmap({
  values, selected, onSelect, best,
}: { values: number[] | null; selected: number; onSelect: (z: number) => void; best?: number }) {
  const min = values ? Math.min(...values) : 0;
  const max = values ? Math.max(...values) : 1;
  return (
    <div className="mx-auto w-full max-w-[360px]">
      <div className="rounded-2xl border-[3px] border-neutral-900 bg-white p-1.5 shadow-sm" role="grid" aria-label="스트라이크존 9분할 히트맵 (포수 시점)">
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 9 }, (_, i) => {
            const z = i + 1;
            const v = values?.[i];
            const t = v == null || max === min ? 0 : (v - min) / (max - min);
            const alpha = Math.round(12 + t * 80);
            const dark = alpha > 55;
            return (
              <button
                key={z}
                type="button"
                role="gridcell"
                aria-selected={selected === z}
                aria-label={`${z}번 ${ZONE_NAMES[z]} ${v != null ? (v * 100).toFixed(1) + "%" : ""}`}
                onClick={() => onSelect(z)}
                style={{ backgroundColor: `color-mix(in srgb, #c30452 ${alpha}%, white)` }}
                className={cn(
                  "relative aspect-square rounded-lg text-center transition-transform hover:scale-[1.03] focus-visible:outline-none",
                  selected === z ? "ring-4 ring-neutral-900" : "ring-1 ring-black/10",
                  dark ? "text-white" : "text-neutral-900",
                )}
              >
                <span className="absolute left-1.5 top-1 text-[10px] font-semibold opacity-70">{z}</span>
                {best === z && <span className="absolute right-1.5 top-0.5 text-xs" title="모델 추천 1순위">★</span>}
                <span className="flex h-full flex-col items-center justify-center">
                  <span className="text-lg font-extrabold leading-none sm:text-xl">{v != null ? (v * 100).toFixed(0) : "–"}<span className="text-xs font-semibold">%</span></span>
                  <span className="mt-0.5 hidden text-[10px] opacity-80 sm:block">{ZONE_NAMES[z]}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-neutral-500">포수 시점 · 칸을 눌러 목표 코스 선택 · ★ 추천 1순위</p>
    </div>
  );
}
