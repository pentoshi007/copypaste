/**
 * Simple in-memory rate limiter (dev-tier).
 * Per-IP + per-username bucket: max `maxAttempts` per `windowMs`.
 * Production upgrade path: Upstash Redis / Vercel KV.
 */

type Bucket = { count: number; firstAt: number };

const buckets = new Map<string, Bucket>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15_000;

function key(scope: string, id: string) {
  return `${scope}:${id.toLowerCase()}`;
}

export function rateLimit(scope: string, id: string): boolean {
  const k = key(scope, id);
  const now = Date.now();
  const b = buckets.get(k);

  if (!b || now - b.firstAt > WINDOW_MS) {
    buckets.set(k, { count: 1, firstAt: now });
    return true;
  }

  if (b.count >= MAX_ATTEMPTS) {
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
      if (now - b.firstAt > WINDOW_MS * 4) buckets.delete(k);
    }
  }, WINDOW_MS * 4).unref?.();
}
