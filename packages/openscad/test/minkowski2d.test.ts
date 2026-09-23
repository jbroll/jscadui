import { describe, it, expect, beforeAll } from 'vitest'
import jscad from '@jscad/modeling'
import j$ from '@jscadui/openscad-runtime'

const { primitives, measurements, geometries } = jscad
// The 2D union snaps its output onto an epsilon grid, so bounds land within
// a rounding step of the exact figure rather than on it.
const bbox = (g: unknown) => measurements.measureBoundingBox(g).map((corner: number[]) => corner.map((n) => Math.round(n * 1e3) / 1e3))
const area = (g: unknown) => measurements.measureArea(g)

/**
 * @jscad/modeling's minkowskiSum takes geom3 only, so `minkowski() { shape;
 * circle(r); }` — the round-the-corners idiom — threw on the jscad engine.
 * The sum of a simple polygon with a convex shape is that shape swept along
 * every edge, unioned with the polygon itself.
 */
describe('2D minkowski', () => {
  beforeAll(() => { j$.init(jscad) })

  const square = (size: number, center = [0, 0]) => primitives.rectangle({ size: [size, size], center })

  it('grows a square by a square', () => {
    const result = j$.minkowski(square(4), square(2))
    expect(bbox(result)).toEqual([[-3, -3, 0], [3, 3, 0]])
  })

  it('is independent of operand order', () => {
    expect(bbox(j$.minkowski(square(2), square(4)))).toEqual(bbox(j$.minkowski(square(4), square(2))))
  })

  it('carries the offset of a shape that does not contain the origin', () => {
    const result = j$.minkowski(square(4), square(2, [10, 0]))
    expect(bbox(result)).toEqual([[7, -3, 0], [13, 3, 0]])
  })

  it('rounds a square with a circle to within a square of its area', () => {
    const r = 1
    const result = j$.minkowski(square(4), primitives.circle({ radius: r, segments: 64 }))
    // 4x4 grown by r: the square, four 4xr slabs, and a full circle at the corners.
    const expected = 16 + 4 * 4 * r + Math.PI * r * r
    expect(area(result)).toBeCloseTo(expected, 1)
  })

  it('keeps a hole that is wider than the sweep', () => {
    const ring = jscad.booleans.subtract(square(20), square(10))
    const result = j$.minkowski(ring, square(2))
    expect(geometries.geom2.toOutlines(result)).toHaveLength(2)
  })

  it('sweeps a non-convex profile', () => {
    const ell = jscad.booleans.union(
      primitives.rectangle({ size: [8, 2], center: [0, 0] }),
      primitives.rectangle({ size: [2, 8], center: [-3, 3] })
    )
    const result = j$.minkowski(ell, square(2))
    expect(bbox(result)).toEqual([[-5, -2, 0], [5, 8, 0]])
  })
})
