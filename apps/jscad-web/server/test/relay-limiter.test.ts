import { describe, expect, it } from 'vitest'
import { createLimiter } from '../src/relay/policy.js'

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

  it('evicts fully-refilled buckets once the map passes the cap', () => {
    let t = 0
    const limiter = createLimiter({ ratePerMin: 60, burst: 1, now: () => t, maxBuckets: 3 })
    limiter.check('a'); limiter.check('b'); limiter.check('c')
    // a, b, c idle back to a full token well before the next arrivals
    t += 120_000
    limiter.check('d'); limiter.check('e'); limiter.check('f')
    // the idle buckets were dropped, so the cap held
    expect(limiter.size()).toBeLessThanOrEqual(3)
    // and the live keys are still tracked: a second check is still refused
    expect(limiter.check('f')).toMatchObject({ ok: false })
    expect(limiter.check('e')).toMatchObject({ ok: false })
  })

  it('never evicts a bucket that is still draining', () => {
    const t = 0
    const limiter = createLimiter({ ratePerMin: 60, burst: 1, now: () => t, maxBuckets: 1 })
    expect(limiter.check('a').ok).toBe(true)
    // b arrives while a is drained (not yet refilled): a must stay, b still gets a bucket
    expect(limiter.check('b').ok).toBe(true)
    // a remains rate-limited, proving it was not evicted mid-drain
    expect(limiter.check('a')).toMatchObject({ ok: false })
  })
})
