"use client";

import { BarChart3, Database, GitCompare, Network, Target } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PitcherMeta } from "@/lib/types";
import { CompareTab } from "./CompareTab";
import { DataTab } from "./DataTab";
import { GraphTab } from "./GraphTab";
import { ModelTab, type HistoryRow, type Metrics } from "./ModelTab";
import { PredictTab } from "./PredictTab";
import { DataBadge } from "./shared";

interface Props {
  pitchers: PitcherMeta[];
  modelInfo: { version: string; data_source: string; trained_at: string; n_trees: number; disclaimer: string };
  metrics: Metrics;
  history: HistoryRow[];
  quality: Parameters<typeof DataTab>[0]["quality"];
}

const TABS = [
  { v: "predict", label: "제구 예측", icon: Target },
  { v: "compare", label: "투수 비교", icon: GitCompare },
  { v: "graph", label: "관계 그래프", icon: Network },
  { v: "data", label: "데이터", icon: Database },
  { v: "model", label: "모델·학습 현황", icon: BarChart3 },
];

export function Dashboard({ pitchers, modelInfo, metrics, history, quality }: Props) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-[#111] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex size-10 items-center justify-center rounded-full bg-[#c30452] text-lg font-black" aria-hidden>LG</div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-extrabold leading-tight sm:text-xl">LG 트윈스 AI 제구 예측 플랫폼</h1>
            <p className="text-[11px] text-neutral-300 sm:text-xs">투수·구종·구속·상황별 제구 성공 확률 · 비공식 팬 학습 프로젝트</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="hidden text-neutral-400 sm:inline">모델 {modelInfo.version}</span>
            <DataBadge source={modelInfo.data_source} />
          </div>
        </div>
        <div className="bg-[#c30452] px-4 py-1.5 text-center text-[11px] font-semibold sm:text-xs" role="note">
          ⚠ 모든 학습·표시 데이터는 <b>가상(DEMO) 합성 데이터</b>입니다. 실제 선수·경기와 무관하며, 모델 성능을 실제 성능으로 해석할 수 없습니다.
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6">
        <Tabs defaultValue="predict" className="gap-4">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <TabsList className="h-auto w-max gap-1 bg-white p-1 shadow-sm ring-1 ring-black/5">
              {TABS.map(({ v, label, icon: Icon }) => (
                <TabsTrigger key={v} value={v} className="h-9 gap-1.5 px-3 text-sm data-active:bg-[#c30452] data-active:text-white">
                  <Icon className="size-4" />{label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="predict"><PredictTab pitchers={pitchers} /></TabsContent>
          <TabsContent value="compare"><CompareTab pitchers={pitchers} /></TabsContent>
          <TabsContent value="graph"><GraphTab pitchers={pitchers} /></TabsContent>
          <TabsContent value="data"><DataTab pitchers={pitchers} quality={quality} /></TabsContent>
          <TabsContent value="model"><ModelTab metrics={metrics} history={history} /></TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-neutral-200 bg-white px-4 py-4 text-center text-[11px] leading-relaxed text-neutral-500">
        본 프로젝트는 LG 트윈스·KBO와 제휴되지 않은 비공식 학습용 데모입니다. {modelInfo.disclaimer}
      </footer>
    </div>
  );
}
