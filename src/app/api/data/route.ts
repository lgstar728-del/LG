import { apiError, guard, json } from "@/lib/http";
import { getSupabase, uploadTokenOk } from "@/lib/supabase";
import sample from "@/model/sample_rows.json";

const demoRows = sample as unknown as Record<string, unknown>[];

/**
 * 데이터 조회. DEMO: 번들된 층화 샘플(투수당 100행, 전체 100,000행은 CSV 다운로드).
 * REAL: Supabase pitches_real (UPLOAD_TOKEN 필요). DEMO/REAL 은 별도 테이블 + data_source 로 항상 구분된다.
 */
export async function GET(req: Request) {
  const limited = guard(req, 60);
  if (limited) return limited;
  const u = new URL(req.url);
  const source = u.searchParams.get("source") === "real" ? "real" : "demo";
  const pitcher = u.searchParams.get("pitcher") ?? "";
  const page = Math.max(1, Number(u.searchParams.get("page") ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit") ?? 25) || 25));
  if (pitcher && !/^[A-Za-z0-9_-]{1,32}$/.test(pitcher)) return apiError("invalid_input", "투수 ID 형식이 올바르지 않습니다.", 422);

  if (source === "demo") {
    const all = pitcher ? demoRows.filter((r) => r.pitcher_id === pitcher) : demoRows;
    return json({
      source: "DEMO", total: all.length, total_in_full_dataset: 100000, page, limit,
      note: "미리보기는 투수별 층화 샘플입니다. 전체 100,000행은 CSV로 다운로드하세요.",
      rows: all.slice((page - 1) * limit, page * limit),
    });
  }

  if (!uploadTokenOk(req)) return apiError("unauthorized", "실데이터 조회에는 x-upload-token 이 필요합니다.", 401);
  const sb = getSupabase();
  if (!sb) return json({ source: "REAL", total: 0, rows: [], configured: false, note: "Supabase 미설정: 실데이터 저장소가 연결되지 않았습니다." });
  let q = sb.from("pitches_real").select("*", { count: "exact" }).order("game_date", { ascending: false }).range((page - 1) * limit, page * limit - 1);
  if (pitcher) q = q.eq("pitcher_id", pitcher);
  const { data, error, count } = await q;
  if (error) return apiError("db_error", "데이터베이스 조회에 실패했습니다.", 502);
  return json({ source: "REAL", total: count ?? 0, page, limit, rows: data ?? [] });
}
