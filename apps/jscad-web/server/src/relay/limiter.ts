// Per-key token bucket. Refill is lazy on check; idle buckets stay in the map
// (relay traffic is low-cardinality client IPs, so no eviction is needed).
export interface Limiter {
  check(key: string): { ok: true } | { ok: false; retryAfterSec: number }
}

export const createLimiter = (options: {
  ratePerMin: number
  burst: number
  now?: () => number
}): Limiter => {
  const now = options.now ?? Date.now
  const perMs = options.ratePerMin / 60_000
  const buckets = new Map<string, { tokens: number; at: number }>()
  return {
    check(key: string) {
      const t = now()
      const bucket = buckets.get(key) ?? { tokens: options.burst, at: t }
      const tokens = Math.min(options.burst, bucket.tokens + (t - bucket.at) * perMs)
      if (tokens >= 1) {
        buckets.set(key, { tokens: tokens - 1, at: t })
        return { ok: true }
      }
      buckets.set(key, { tokens, at: t })
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) }
    },
  }
}
