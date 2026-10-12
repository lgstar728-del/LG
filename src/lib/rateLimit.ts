/** 인스턴스 단위(best-effort) 슬라이딩 윈도우 제한. 서버리스에서는 인스턴스별로 동작하므로 완전한 방어가 아님. */
const hits = new Map<string, number[]>();
export function rateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return true;
}
export function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
}
