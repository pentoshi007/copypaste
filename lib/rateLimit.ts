/**
 * Simple in-memory rate limiter (dev-tier).
 * Per-IP + per-username bucket: max `maxAttempts` per `windowMs`.
 * Production upgrade path: Upstash Redis / Vercel KV.
 */

type Bucket = { count: number; firstAt: number; windowMs: number };

const buckets = new Map<string, Bucket>();

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 15_000;

export type RateLimitOptions = {
  maxAttempts?: number;
  windowMs?: number;
};

function key(scope: string, id: string) {
  return `${scope}:${id.toLowerCase()}`;
}

/** Returns false when the caller has exhausted its allowance. */
export function rateLimit(
  scope: string,
  id: string,
  options: RateLimitOptions = {}
): boolean {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

  const k = key(scope, id);
  const now = Date.now();
  const b = buckets.get(k);

  if (!b || now - b.firstAt > windowMs) {
    buckets.set(k, { count: 1, firstAt: now, windowMs });
    return true;
  }

  if (b.count >= maxAttempts) {
    return false; // blocked
  }

  b.count += 1;
  return true;
}

// Periodic cleanup (avoid unbounded growth in long-running server)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now - b.firstAt > b.windowMs * 4) buckets.delete(k);
    }
  }, DEFAULT_WINDOW_MS * 4).unref?.();
}
