import { describe, expect, it } from 'vitest'
import { createLimiter } from '../src/relay/limiter.js'

describe('limiter', () => {
  it('allows burst then refuses with retry-after', () => {
    const t = 0
    const limiter = createLimiter({ ratePerMin: 60, burst: 2, now: () => t })
    expect(limiter.check('1.2.3.4')).toEqual({ ok: true })
    expect(limiter.check('1.2.3.4')).toEqual({ ok: true })
    const refused = limiter.check('1.2.3.4')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.retryAfterSec).toBeGreaterThan(0)
  })

  it('refills over time and isolates keys', () => {
    let t = 0
    const limiter = createLimiter({ ratePerMin: 60, burst: 1, now: () => t })
    expect(limiter.check('a').ok).toBe(true)
    expect(limiter.check('a').ok).toBe(false)
    expect(limiter.check('b').ok).toBe(true)
    t += 61_000
    expect(limiter.check('a')).toEqual({ ok: true })
  })
})
