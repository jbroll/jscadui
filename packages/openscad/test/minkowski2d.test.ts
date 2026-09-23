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

  const twoCircles = () => jscad.booleans.union(
    primitives.circle({ radius: 1, segments: 64 }),
    primitives.circle({ radius: 1, segments: 64, center: [20, 0] })
  )
  // Each 10x10 square grown by r = 1: 100 + 4 * 10 + pi.
  const roundedSquare = 100 + 40 + Math.PI

  it('sums each part of a multi-part operand separately', () => {
    const result = j$.minkowski(primitives.rectangle({ size: [10, 10] }), twoCircles())
    expect(geometries.geom2.toOutlines(result)).toHaveLength(2)
    expect(area(result)).toBeCloseTo(2 * roundedSquare, 1)
  })

  it('sums a multi-part operand given first', () => {
    const result = j$.minkowski(twoCircles(), primitives.rectangle({ size: [10, 10] }))
    expect(area(result)).toBeCloseTo(2 * roundedSquare, 1)
  })

  it('sums two operands when neither is convex', () => {
    const ell = jscad.booleans.union(
      primitives.rectangle({ size: [8, 2], center: [0, 0] }),
      primitives.rectangle({ size: [2, 8], center: [-3, 3] })
    )
    const pair = jscad.booleans.union(square(2), square(2, [20, 0]))
    const result = j$.minkowski(ell, pair)
    expect(bbox(result)).toEqual([[-5, -2, 0], [25, 8, 0]])
    expect(geometries.geom2.toOutlines(result)).toHaveLength(2)
  })

  it('matches the sum over convex parts when both operands are non-convex', () => {
    const armA = primitives.rectangle({ size: [8, 2], center: [0, 0] })
    const armB = primitives.rectangle({ size: [2, 8], center: [-3, 3] })
    const ring = jscad.booleans.subtract(square(20), square(10))
    const result = j$.minkowski(ring, jscad.booleans.union(armA, armB))
    const byParts = jscad.booleans.union(j$.minkowski(ring, armA), j$.minkowski(ring, armB))
    expect(bbox(result)).toEqual([[-14, -11, 0], [14, 17, 0]])
    expect(area(result)).toBeCloseTo(area(byParts), 1)
  })

  it('keeps a hole in the convex-side search', () => {
    const ring = jscad.booleans.subtract(square(20), square(10))
    const result = j$.minkowski(square(2), ring)
    expect(geometries.geom2.toOutlines(result)).toHaveLength(2)
    expect(area(result)).toBeCloseTo(22 * 22 - 8 * 8, 1)
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
