import { describe, it, expect } from 'vitest'
import { calculateGridPositions, buildAllScript } from './gridLayout.js'

// ── calculateGridPositions ─────────────────────────────────────────────────

describe('calculateGridPositions', () => {
  it('returns [] for count=0', () => {
    expect(calculateGridPositions(0)).toEqual([])
  })

  it('returns [[0,0]] for count=1', () => {
    expect(calculateGridPositions(1)).toEqual([[0, 0]])
  })

  it('returns 4 positions for count=4 in a 2×2 grid', () => {
    const pos = calculateGridPositions(4, 60)
    expect(pos).toHaveLength(4)
    // cols=2, rows=2, xOff=30, yOff=30
    expect(pos[0]).toEqual([-30, -30])
    expect(pos[1]).toEqual([ 30, -30])
    expect(pos[2]).toEqual([-30,  30])
    expect(pos[3]).toEqual([ 30,  30])
  })

  it('returns 6 positions for count=6 in a 3×2 grid', () => {
    const pos = calculateGridPositions(6, 60)
    expect(pos).toHaveLength(6)
    // cols=3, rows=2, xOff=(3-1)*60/2=60, yOff=30
    // row 0: x = col*60-60 → -60, 0, 60
    // row 1: y = 30
    expect(pos[0]).toEqual([-60, -30])
    expect(pos[1]).toEqual([  0, -30])
    expect(pos[2]).toEqual([ 60, -30])
    expect(pos[3]).toEqual([-60,  30])
    expect(pos[5]).toEqual([ 60,  30])
  })

  it('uses spacing=60 as default', () => {
    const pos = calculateGridPositions(4)
    expect(pos[1][0]).toBe(30)   // second item x = +30 with default 60 spacing
  })

  it('respects custom spacing', () => {
    const pos = calculateGridPositions(4, 100)
    // xOff = (2-1)*100/2 = 50
    expect(pos[0][0]).toBe(-50)
    expect(pos[1][0]).toBe( 50)
  })

  it('all positions are [x, y] 2-tuples of numbers', () => {
    for (const p of calculateGridPositions(9)) {
      expect(p).toHaveLength(2)
      expect(typeof p[0]).toBe('number')
      expect(typeof p[1]).toBe('number')
    }
  })

  it('centre of mass is [0, 0] for a square grid', () => {
    const pos = calculateGridPositions(4, 60)
    const cx = pos.reduce((s, p) => s + p[0], 0) / pos.length
    const cy = pos.reduce((s, p) => s + p[1], 0) / pos.length
    expect(cx).toBe(0)
    expect(cy).toBe(0)
  })

  it('centre of mass is [0, 0] for a non-square grid', () => {
    const pos = calculateGridPositions(6, 60)
    const cx = pos.reduce((s, p) => s + p[0], 0) / pos.length
    const cy = pos.reduce((s, p) => s + p[1], 0) / pos.length
    expect(cx).toBe(0)
    expect(cy).toBe(0)
  })

  it('number of positions matches count', () => {
    for (const n of [1, 2, 3, 5, 7, 10, 25]) {
      expect(calculateGridPositions(n)).toHaveLength(n)
    }
  })
})

// ── buildAllScript ─────────────────────────────────────────────────────────

describe('buildAllScript', () => {
  it('returns a string', () => {
    expect(typeof buildAllScript([])).toBe('string')
  })

  it('contains const main arrow function', () => {
    expect(buildAllScript(['/a.js'])).toContain('const main = (params) =>')
  })

  it("contains require for grid-utils with absolute path", () => {
    expect(buildAllScript(['/a.js'])).toContain("'/examples/lib/grid-utils.js'")
    expect(buildAllScript(['/a.js'])).toContain('gridPosition')
    expect(buildAllScript(['/a.js'])).toContain('normalizeAndPlace')
  })

  it('embeds each URL in the output', () => {
    const script = buildAllScript(['/examples/a.js', '/examples/b.scad'])
    expect(script).toContain('/examples/a.js')
    expect(script).toContain('/examples/b.scad')
  })

  it('uses dynamic gridPosition calculation', () => {
    const script = buildAllScript(['/a.js'], 60)
    expect(script).toContain('gridPosition(i, items.length, spacing)')
  })

  it('passes spacing parameter to grid calculation', () => {
    const script = buildAllScript(['/a.js', '/b.js'], 100)
    expect(script).toContain('const spacing = 100')
  })

  it('handles empty file list without errors', () => {
    const script = buildAllScript([])
    expect(script).toContain('const main = (params) =>')
    // Script should be valid JavaScript (no syntax errors from undefined variables)
    expect(() => new Function(script)).not.toThrow()
  })

  it('wraps each model in try/catch and logs warnings on error', () => {
    expect(buildAllScript(['/a.js'])).toContain('try {')
    expect(buildAllScript(['/a.js'])).toContain('console.warn')
    expect(buildAllScript(['/a.js'])).toContain('} catch (err)')
  })

  it('calls models with child proxy params', () => {
    const script = buildAllScript(['/a.js'])
    expect(script).toContain('fn(params[name])')
  })

  it('exports main via module.exports', () => {
    expect(buildAllScript(['/a.js'])).toContain('module.exports = { main }')
  })
})
