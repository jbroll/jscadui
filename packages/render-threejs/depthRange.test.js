import { describe, it, expect } from 'vitest'
import { depthRange } from './depthRange.js'

describe('depth range', () => {
  it('reaches past a 35 m model fitted 70 m away', () => {
    const { far } = depthRange([0, -70400, 0], [0, 0, 0])
    expect(far).toBeGreaterThan(70400 + 24000)
  })

  it('keeps the near plane in front of a small model viewed close up', () => {
    const { near, far } = depthRange([30, -30, 30], [0, 0, 0])
    expect(near).toBeLessThan(5)
    expect(far).toBeGreaterThan(52 + 100)
  })

  it('scales both planes with distance so depth precision is the same at any zoom', () => {
    const a = depthRange([0, -100, 0], [0, 0, 0])
    const b = depthRange([0, -100000, 0], [0, 0, 0])
    expect(b.near / a.near).toBeCloseTo(1000)
    expect(b.far / a.far).toBeCloseTo(1000)
  })

  it('returns null when the camera sits on its target or the input is not finite', () => {
    expect(depthRange([1, 2, 3], [1, 2, 3])).toBeNull()
    expect(depthRange([NaN, 0, 0], [0, 0, 0])).toBeNull()
  })
})
