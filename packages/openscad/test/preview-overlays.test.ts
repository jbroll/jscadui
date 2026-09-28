import { describe, it, expect, beforeAll } from 'vitest'
import j$ from '@jscadui/openscad-runtime'
import { initScadRuntime } from '../bin/run-jscad.js'

type Ghost = { polygons?: { vertices: number[][] }[], sides?: number[][][], color: number[], previewOnly: boolean }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const J = j$ as unknown as Record<string, any>

const bounds = (points: number[][]) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const p of points) for (let i = 0; i < p.length; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]) }
  return [lo.slice(0, points[0].length), hi.slice(0, points[0].length)]
}
const ghostBounds = (g: Ghost) => g.polygons
  ? bounds(g.polygons.flatMap(p => p.vertices))
  : bounds(g.sides!.flat())

describe('overlay core', () => {
  beforeAll(async () => { await initScadRuntime() })

  it('withOverlays returns a result without overlays unchanged', () => {
    const c = J.cube({ size: 10 })
    expect(J.withOverlays(c)).toBe(c)
    expect(J.withOverlays(undefined)).toBe(undefined)
  })

  it('highlight returns its child and adds a pink ghost', () => {
    const c = J.cube({ size: 10 })
    expect(J.highlight(c)).toBe(c)
    const out = J.withOverlays(c)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(c)
    expect(out[1].previewOnly).toBe(true)
    expect(out[1].color).toEqual([1, 0.32, 0.32, 0.5])
    expect(ghostBounds(out[1])).toEqual([[0, 0, 0], [10, 10, 10]])
  })

  it('background returns a placeholder that is only a grey ghost', () => {
    const out = J.withOverlays(J.background(J.cube({ size: 4 })))
    expect(out).toHaveLength(1)
    expect(out[0].color).toEqual([0.5, 0.5, 0.5, 0.3])
    expect(ghostBounds(out[0])).toEqual([[0, 0, 0], [4, 4, 4]])
  })

  it('records nothing for an absent child', () => {
    expect(J.highlight(J.NO_CHILD)).toBe(J.NO_CHILD)
    expect(J.highlight(undefined)).toBe(undefined)
    expect(J.background(J.NO_CHILD)).toBe(J.NO_CHILD)
    expect(J.background(undefined)).toBe(J.NO_CHILD)
  })

  it('snapshots a 2D child as sides', () => {
    const out = J.withOverlays(J.background(J.square({ size: 3 })))
    expect(out[0].sides.length).toBeGreaterThan(0)
    expect(ghostBounds(out[0])).toEqual([[0, 0], [3, 3]])
  })

  it('keeps the ghost after the highlighted child is disposed', () => {
    const c = J.cube({ size: 10 })
    J.highlight(c)
    const out = J.withOverlays(c)
    c.dispose()
    expect(ghostBounds(out[1])).toEqual([[0, 0, 0], [10, 10, 10]])
  })

  it('waits for a promised child', async () => {
    const out = await J.withOverlays(J.highlight(Promise.resolve(J.cube({ size: 2 }))))
    expect(out).toHaveLength(2)
  })
})
