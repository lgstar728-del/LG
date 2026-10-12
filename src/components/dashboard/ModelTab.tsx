"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, ReferenceLine, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataBadge } from "./shared";

interface M { roc_auc: number; brier: number; log_loss: number; ece: number }
export interface Metrics {
  version: string; trained_at: string; data_source: string; claim: string; split: string; base_rate: number;
  n_rows: Record<string, number>; test: { raw: M; calibrated: M };
  calibration_method: { type: string; cv_brier: Record<string, number> };
  baselines: { constant_brier: number; logistic_regression: M };
  calibration_curve: { bin: number; n: number; predicted: number; observed: number }[];
  feature_importance: { feature: string; gain: number }[]; best_iteration: number;
}
export interface HistoryRow { version: string; trained_at: string; data_source: string; n_train: number; n_test: number; roc_auc: number; brier: number; ece: number; notes: string }

const LOOP = [
  ["학습", "XGBoost 이진분류 · 시간순 경기 단위 분할(누출 방지)"],
  ["예측", "TS 추론 엔진(JSON 트리)으로 /api/predict 서빙"],
  ["성능평가", "ROC-AUC · Brier · ECE · 신뢰도 곡선(테스트 분할)"],
  ["개선", "보정 방식 자동 선택 · 재학습 이력 기록 · 실데이터 시 재검증"],
];

export function ModelTab({ metrics, history }: { metrics: Metrics; history: HistoryRow[] }) {
  const t = metrics.test.calibrated;
  const kpis = [
    { k: "ROC-AUC", v: t.roc_auc.toFixed(3), sub: `로지스틱 기준선 ${metrics.baselines.logistic_regression.roc_auc.toFixed(3)}` },
    { k: "Brier Score", v: t.brier.toFixed(4), sub: `상수 예측 ${metrics.baselines.constant_brier.toFixed(4)} (낮을수록 좋음)` },
    { k: "ECE (보정 오차)", v: t.ece.toFixed(4), sub: `보정 전 ${metrics.test.raw.ece.toFixed(4)} · 방식 ${metrics.calibration_method.type}` },
    { k: "Log Loss", v: t.log_loss.toFixed(4), sub: `테스트 ${metrics.n_rows.test.toLocaleString()}구` },
  ];
  return (
    <div className="space-y-4">
      <div role="note" className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
        <DataBadge source={metrics.data_source} />
        <span><b>{metrics.claim}.</b> 아래 수치는 가상 데이터를 생성한 규칙을 얼마나 재현하는지 보는 자기일관성 점검입니다. 실제 KBO 투수의 제구 예측 성능을 의미하지 않으며, 실데이터 전환 시 재학습·재검증이 필수입니다.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((x) => (
          <Card key={x.k}><CardContent className="pt-4">
            <p className="text-xs font-semibold text-neutral-500">{x.k}</p>
            <p className="text-3xl font-extrabold text-[#c30452]">{x.v}</p>
            <p className="text-[11px] text-neutral-500">{x.sub}</p>
          </CardContent></Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>확률 보정(신뢰도) 곡선 — 테스트 분할</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics.calibration_curve} margin={{ left: 0, right: 12, top: 8, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e5ea" />
                  <XAxis dataKey="predicted" type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} fontSize={11} label={{ value: "예측 확률", position: "insideBottom", offset: -8, fontSize: 11 }} />
                  <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} fontSize={11} label={{ value: "실제 비율", angle: -90, position: "insideLeft", fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
                  <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#9aa0aa" strokeDasharray="4 4" />
                  <Line dataKey="observed" name="실제 성공 비율" stroke="#c30452" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-neutral-500">점선(y=x)에 가까울수록 보정이 잘 된 것. 구간별 표본 수는 {metrics.calibration_curve.map((c) => c.n).join(", ")}.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>특징 중요도 (gain 상위 12)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.feature_importance.slice(0, 12)} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" fontSize={11} />
                  <YAxis type="category" dataKey="feature" width={72} fontSize={11} interval={0} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="gain" name="gain" fill="#c30452" radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-neutral-500">pt_*=구종, p_*=투수 더미 변수, same_hand=투타 좌우 동일 여부.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Loop: 학습 → 예측 → 성능평가 → 개선</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ol className="grid gap-2 sm:grid-cols-4">
            {LOOP.map(([a, b], i) => (
              <li key={a} className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-sm font-bold"><span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-full bg-[#c30452] text-[11px] text-white">{i + 1}</span>{a}</p>
                <p className="mt-1 text-xs text-neutral-600">{b}</p>
              </li>
            ))}
          </ol>
          <p className="text-xs text-neutral-600">데이터 분할: {metrics.split} · train {metrics.n_rows.train.toLocaleString()} / calib {metrics.n_rows.calib.toLocaleString()} / test {metrics.n_rows.test.toLocaleString()} · 트리 {metrics.best_iteration}개(조기 종료) · 보정 후보 CV Brier: {Object.entries(metrics.calibration_method.cv_brier).map(([k, v]) => `${k} ${v}`).join(" / ")}</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>버전</TableHead><TableHead>시각(UTC)</TableHead><TableHead>데이터</TableHead><TableHead className="text-right">train/test</TableHead><TableHead className="text-right">ROC-AUC</TableHead><TableHead className="text-right">Brier</TableHead><TableHead className="text-right">ECE</TableHead><TableHead>메모</TableHead></TableRow></TableHeader>
              <TableBody>
                {[...history].reverse().map((h, i) => (
                  <TableRow key={h.version}>
                    <TableCell>{history.length - i}</TableCell><TableCell className="font-mono text-xs">{h.version}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{h.trained_at.replace("T", " ").slice(0, 19)}</TableCell>
                    <TableCell><DataBadge source={h.data_source} /></TableCell>
                    <TableCell className="text-right text-xs">{h.n_train.toLocaleString()}/{h.n_test.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{h.roc_auc.toFixed(3)}</TableCell><TableCell className="text-right">{h.brier.toFixed(4)}</TableCell><TableCell className="text-right">{h.ece.toFixed(4)}</TableCell>
                    <TableCell className="min-w-48 text-xs text-neutral-600">{h.notes || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-neutral-500">재학습: <code>python ml/train.py --source mixed --real-csv data/real/pitches_real.csv</code> → <code>python ml/build_assets.py</code> → 커밋·배포. 실데이터 5,000행 미만이면 학습이 거부됩니다.</p>
        </CardContent>
      </Card>
    </div>
  );
}
