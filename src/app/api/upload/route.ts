import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import { apiError, guard, json } from "@/lib/http";
import { autoMapping, CANONICAL, ingestCsv, type Canonical } from "@/lib/ingest";
import { getSupabase, uploadTokenOk } from "@/lib/supabase";
import Papa from "papaparse";

export const maxDuration = 30;

/**
 * 실데이터(REAL) CSV 업로드: 변수 매핑 → 자동 정제 → (권한 있을 때만) pitches_real 영속 저장.
 * - 토큰/Supabase 가 없으면 '검증 미리보기'만 수행하고 저장하지 않는다(persisted:false).
 * - 업로드 데이터는 DEMO 로 표시할 수 없고 항상 REAL 로 별도 테이블에 저장된다.
 */
export async function POST(req: Request) {
  const limited = guard(req, 20);
  if (limited) return limited;
  let form: FormData;
  try { form = await req.formData(); } catch { return apiError("bad_form", "multipart/form-data 형식이 필요합니다."); }
  const file = form.get("file");
  if (!(file instanceof File)) return apiError("no_file", "CSV 파일(file)이 필요합니다.", 422);
  if (file.size > MAX_UPLOAD_BYTES) return apiError("too_large", `파일이 너무 큽니다(최대 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB). 대용량은 ml/ 스크립트로 직접 적재하세요.`, 413);
  if (!/\.csv$/i.test(file.name) && file.type && !file.type.includes("csv") && !file.type.includes("text")) return apiError("bad_type", "CSV 파일만 업로드할 수 있습니다.", 415);

  const mapping: Partial<Record<Canonical, string>> = {};
  const rawMap = form.get("mapping");
  if (typeof rawMap === "string" && rawMap.trim()) {
    try {
      const m = JSON.parse(rawMap) as Record<string, unknown>;
      for (const [k, v] of Object.entries(m)) if ((CANONICAL as readonly string[]).includes(k) && typeof v === "string") mapping[k as Canonical] = v;
    } catch { return apiError("bad_mapping", "mapping 은 JSON 객체여야 합니다.", 422); }
  }
  const velocityUnit = form.get("velocityUnit") === "mph" ? "mph" : "kmh";
  const coordUnit = form.get("coordUnit") === "feet" ? "feet" : "normalized";
  const text = await file.text();

  if (form.get("mode") === "headers") {
    const head = Papa.parse<string[]>(text, { preview: 1 }).data[0] ?? [];
    return json({ headers: head, suggested_mapping: autoMapping(head), canonical: CANONICAL });
  }

  const { rows, rejected, report } = ingestCsv(text, { mapping, velocityUnit, coordUnit });
  const sb = getSupabase();
  const canPersist = !!sb && uploadTokenOk(req);
  let persisted = false;
  let persist_note = !sb ? "Supabase 미설정 — 검증 미리보기만 수행했습니다." : !process.env.UPLOAD_TOKEN ? "UPLOAD_TOKEN 미설정 — 저장 비활성화." : "";
  if (sb && !canPersist && process.env.UPLOAD_TOKEN) persist_note = "x-upload-token 이 없거나 올바르지 않아 저장하지 않았습니다(미리보기만).";

  if (canPersist && sb && rows.length) {
    const { data: batch, error: bErr } = await sb.from("upload_batches").insert({
      filename: file.name.slice(0, 200), data_source: "REAL", rows_in: report.rows_in, rows_ok: report.rows_ok,
      rows_rejected: report.rows_rejected, mapping: report.mapping,
    }).select("id").single();
    if (bErr) return apiError("db_error", "업로드 이력 저장에 실패했습니다.", 502);
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000).map((r) => ({ ...r, batch_id: batch.id }));
      const { error } = await sb.from("pitches_real").upsert(chunk, { onConflict: "pitch_id" });
      if (error) return apiError("db_error", `DB 적재 실패(청크 ${i / 1000 + 1}). 일부 데이터만 저장되었을 수 있습니다.`, 502);
    }
    persisted = true;
    persist_note = `pitches_real 에 ${rows.length.toLocaleString()}행 저장(REAL).`;
  }

  return json({ data_source: "REAL", persisted, persist_note, report, preview: rows.slice(0, 20), rejected_sample: rejected.slice(0, 20) });
}
