/**
 * Vercel 호환 추론 엔진: XGBoost 트리를 JSON으로 내보낸 모델을 순수 TS로 평가한다.
 * (Python 런타임·네이티브 바이너리 불필요). 특징 정의는 ml/common.py build_features 와 동일해야 한다.
 */
import modelJson from "@/model/model.json";
import type { PitchInput } from "./types";

interface Tree { f: number[]; t: number[]; l: number[]; r: number[]; v: number[] }
interface Calibration { type: "none" | "platt" | "isotonic"; a?: number; b?: number; x?: number[]; y?: number[] }
export interface ModelFile {
  version: string; trained_at: string; data_source: "DEMO" | "REAL" | "MIXED"; n_trees: number;
  base_margin: number; feature_names: string[]; pitcher_vocab: string[]; pitch_vocab: string[];
  calibration: Calibration; trees: Tree[]; disclaimer: string;
}

export const model = modelJson as unknown as ModelFile;
const FEATURE_INDEX = new Map(model.feature_names.map((n, i) => [n, i]));

export function buildFeatureVector(inp: PitchInput): Float32Array {
  const x = new Float32Array(model.feature_names.length);
  const set = (name: string, v: number) => {
    const i = FEATURE_INDEX.get(name);
    if (i !== undefined) x[i] = v;
  };
  set("velocity", inp.velocity);
  set("pitch_count", inp.pitch_count);
  set("fatigue", inp.fatigue);
  set("target_x", inp.target_x);
  set("target_y", inp.target_y);
  set("balls", inp.balls);
  set("strikes", inp.strikes);
  set("batter_left", inp.batter_hand === "L" ? 1 : 0);
  set("same_hand", inp.batter_hand === inp.pitcher_hand ? 1 : 0);
  set("target_edge", Math.abs(inp.target_x) > 0.3 || Math.abs(inp.target_y) > 0.3 ? 1 : 0);
  set(`pt_${inp.pitch_type}`, 1);
  set(`p_${inp.pitcher_id}`, 1);
  return x;
}

function evalTree(tree: Tree, x: Float32Array): number {
  let i = 0;
  while (tree.f[i] !== -1) {
    // xgboost: x < split_condition → yes 분기 (float32 비교)
    i = x[tree.f[i]] < Math.fround(tree.t[i]) ? tree.l[i] : tree.r[i];
  }
  return tree.v[i];
}

export function rawProbability(inp: PitchInput): number {
  const x = buildFeatureVector(inp);
  let m = model.base_margin;
  for (const t of model.trees) m += evalTree(t, x);
  return 1 / (1 + Math.exp(-m));
}

function calibrate(p: number): number {
  const c = model.calibration;
  if (c.type === "platt") {
    const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
    return 1 / (1 + Math.exp(-((c.a ?? 1) * Math.log(q / (1 - q)) + (c.b ?? 0))));
  }
  if (c.type === "isotonic" && c.x && c.y) {
    const { x, y } = c;
    if (p <= x[0]) return y[0];
    if (p >= x[x.length - 1]) return y[y.length - 1];
    let lo = 0, hi = x.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid] <= p) lo = mid; else hi = mid;
    }
    const w = (p - x[lo]) / (x[hi] - x[lo] || 1);
    return y[lo] + w * (y[hi] - y[lo]);
  }
  return p;
}

export function predictProbability(inp: PitchInput): { raw: number; probability: number } {
  const raw = rawProbability(inp);
  return { raw, probability: calibrate(raw) };
}
