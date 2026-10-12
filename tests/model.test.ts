import { describe, expect, it } from "vitest";
import fixtures from "@/model/parity_fixtures.json";
import { model, predictProbability, rawProbability } from "@/lib/model";
import type { PitchInput } from "@/lib/types";

type Fixture = { input: PitchInput; raw: number; calibrated: number };
const fx = fixtures as unknown as Fixture[];

describe("TS 추론 엔진 ↔ Python(XGBoost) 패리티", () => {
  it("40개 고정 샘플의 raw/보정 확률이 Python 과 1e-5 이내로 일치", () => {
    expect(fx.length).toBeGreaterThanOrEqual(40);
    for (const f of fx) {
      expect(Math.abs(rawProbability(f.input) - f.raw)).toBeLessThan(1e-5);
      expect(Math.abs(predictProbability(f.input).probability - f.calibrated)).toBeLessThan(1e-5);
    }
  });
  it("모델 메타: DEMO 데이터 표시와 면책 문구가 존재", () => {
    expect(model.data_source).toBe("DEMO");
    expect(model.disclaimer).toContain("DEMO");
  });
  it("확률은 항상 (0,1) 범위", () => {
    for (const f of fx) {
      const p = predictProbability(f.input).probability;
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });
  it("피로도가 높을수록 평균 성공확률이 낮아진다 (학습된 패턴 방향성)", () => {
    const avg = (fatigue: number) =>
      fx.reduce((s, f) => s + predictProbability({ ...f.input, fatigue }).probability, 0) / fx.length;
    expect(avg(1.2)).toBeLessThan(avg(0.1));
  });
});
