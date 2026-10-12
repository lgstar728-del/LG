import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * 서버 전용. SUPABASE_SERVICE_ROLE_KEY 는 절대 NEXT_PUBLIC_ 로 노출하지 않는다.
 * 미설정 시 null → 앱은 번들(로컬) 모드로 동작한다.
 */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}
export const supabaseConfigured = () => getSupabase() !== null;

/** 쓰기/실데이터 다운로드 보호용 토큰. UPLOAD_TOKEN 이 설정되지 않으면 영속 저장은 항상 거부된다. */
export function uploadTokenOk(req: Request): boolean {
  const expected = process.env.UPLOAD_TOKEN;
  if (!expected) return false;
  return req.headers.get("x-upload-token") === expected;
}
