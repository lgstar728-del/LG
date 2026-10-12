import { describe, expect, it } from "vitest";
import { autoMapping, ingestCsv } from "@/lib/ingest";

const head = "pitcher_id,pitch_type,velocity,pitch_count,target_x,target_y,actual_x,actual_y,balls,strikes,batter_hand,game_id,game_date,pitch_id";

describe("ingestCsv", () => {
  it("한글/영문 헤더 자동 매핑", () => {
    const m = autoMapping(["투수", "구종", "구속", "투구 수", "목표X", "목표Y", "실제X", "실제Y", "볼", "스트라이크", "타자"]);
    expect(m.pitcher_id).toBe("투수");
    expect(m.pitch_count).toBe("투구 수");
    expect(m.batter_hand).toBe("타자");
  });

  it("success 라벨 = 목표-실제 거리 ≤ 0.45, 중복 제거, 범위 밖 거부", () => {
    const csv = [
      head,
      "A1,FF,145,10,0,0,0.3,0.3,0,0,R,G1,2025-01-01,x1",
      "A1,FF,145,11,0,0,0.5,0.5,0,0,R,G1,2025-01-01,x2",
      "A1,FF,145,10,0,0,0.3,0.3,0,0,R,G1,2025-01-01,x1",
      "A1,FF,145,12,0,0,9,9,0,0,R,G1,2025-01-01,x3",
      "A1,XX,145,13,0,0,0,0,0,0,R,G1,2025-01-01,x4",
    ].join("\n");
    const r = ingestCsv(csv);
    expect(r.report.rows_ok).toBe(2);
    expect(r.rows.map((x) => x.success)).toEqual([true, false]);
    expect(r.report.duplicates_removed).toBe(1);
    expect(r.report.rows_rejected).toBe(2);
    expect(r.rows.every((x) => x.data_source === "REAL")).toBe(true);
  });

  it("필수 컬럼 누락이면 행을 처리하지 않고 missing_required 보고", () => {
    const r = ingestCsv("a,b\n1,2");
    expect(r.rows).toHaveLength(0);
    expect(r.report.missing_required.length).toBeGreaterThan(0);
  });

  it("mph → km/h 변환", () => {
    const r = ingestCsv(`${head}\nA1,FF,90,10,0,0,0,0,0,0,R,G1,2025-01-01,x1`, { velocityUnit: "mph" });
    expect(r.rows[0].velocity).toBeCloseTo(144.8, 0);
  });
});
