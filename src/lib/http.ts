import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "./rateLimit";

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const apiError = (code: string, message: string, status = 400, extra: Record<string, unknown> = {}) =>
  json({ error: { code, message, ...extra } }, status);

/** 공통 가드: 레이트리밋. 위반 시 429 응답 반환, 통과 시 null */
export function guard(req: Request, limit = 60) {
  if (!rateLimit(`${new URL(req.url).pathname}:${clientKey(req)}`, limit)) return apiError("rate_limited", "요청이 너무 많습니다. 잠시 후 다시 시도하세요.", 429);
  return null;
}

/** JSON 본문을 안전하게 파싱 (깨진 JSON → 400) */
export async function readJson(req: Request): Promise<{ ok: true; data: unknown } | { ok: false; res: Response }> {
  try {
    return { ok: true, data: await req.json() };
  } catch {
    return { ok: false, res: apiError("bad_json", "요청 본문이 올바른 JSON이 아닙니다.") };
  }
}
