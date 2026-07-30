/**
 * Minimal in-memory rate limiter for the public debate endpoints.
 *
 * Single-replica only (same constraint as the SSE hub) and deliberately simple:
 * it exists to stop a projected join code from being used to spam the roster or
 * loop paid Whisper calls on the shared OpenRouter key — not to resist a
 * determined attacker. Cached on globalThis so dev HMR keeps one instance.
 */

const globalForRl = globalThis as unknown as {
  __vtaRateLimit?: Map<string, number[]>;
};

function buckets(): Map<string, number[]> {
  globalForRl.__vtaRateLimit ??= new Map();
  return globalForRl.__vtaRateLimit;
}

/**
 * Returns true when the call is ALLOWED. Sliding window of `windowMs`
 * containing at most `limit` hits for `key`.
 */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const map = buckets();
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (map.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    map.set(key, hits);
    return false;
  }
  hits.push(now);
  map.set(key, hits);

  // Opportunistic sweep so the map cannot grow without bound.
  if (map.size > 1000) {
    for (const [k, v] of map) {
      const live = v.filter((t) => t > cutoff);
      if (live.length === 0) map.delete(k);
      else map.set(k, live);
    }
  }
  return true;
}

/** Best-effort client IP from the proxy headers Container Apps sets. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd !== null && fwd !== '') return fwd.split(',')[0]?.trim() ?? 'unknown';
  return headers.get('x-real-ip') ?? 'unknown';
}
