import { apiError, guard } from "@/lib/http";
import { getSupabase, uploadTokenOk } from "@/lib/supabase";
import Papa from "papaparse";

/** DEMO: 정적 CSV(100,000행)로 리다이렉트. REAL: UPLOAD_TOKEN + Supabase 필요, 최대 50,000행. */
export async function GET(req: Request) {
  const limited = guard(req, 20);
  if (limited) return limited;
  const source = new URL(req.url).searchParams.get("source");
  if (source !== "real") return Response.redirect(new URL("/data/pitches_demo.csv", req.url), 307);

  if (!uploadTokenOk(req)) return apiError("unauthorized", "실데이터 다운로드에는 x-upload-token 이 필요합니다.", 401);
  const sb = getSupabase();
  if (!sb) return apiError("not_configured", "Supabase 미설정: 실데이터 저장소가 없습니다.", 404);
  const all: Record<string, unknown>[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await sb.from("pitches_real").select("*").order("game_date").range(from, from + 999);
    if (error) return apiError("db_error", "데이터베이스 조회에 실패했습니다.", 502);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return new Response("﻿" + Papa.unparse(all), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="pitches_real.csv"', "Cache-Control": "no-store" },
  });
}
