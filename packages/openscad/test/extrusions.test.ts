import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import jscad from '@jscad/modeling'
import j$, { subdivideSides } from '@jscadui/openscad-runtime'
import { initScadRuntime, evalScadSolidSync } from '../bin/run-jscad.js'

const { primitives, transforms, booleans, extrusions, measurements, geometries } = jscad

const volume = (g) => measurements.measureVolume(g)
const bbox = (g) => measurements.measureBoundingBox(g)

// Native @jscad/modeling v2 geom2 is what the browser worker passes to the runtime.
describe('extrusions on native @jscad/modeling geom2', () => {
  beforeAll(() => {
    j$.init(jscad)
  })

  const atTen = () => primitives.rectangle({ size: [4, 4], center: [10, 0] })
  const circleAtTen = () => transforms.translate([10, 0, 0], primitives.circle({ radius: 3, segments: 32 }))
  const holed = () => booleans.subtract(
    primitives.rectangle({ size: [8, 8], center: [10, 0] }),
    primitives.rectangle({ size: [4, 4], center: [10, 0] })
  )
  const mirrored = () => transforms.mirror({ normal: [1, 0, 0] }, atTen())

  // $fa=12, $fs=2 and outer radius 12..14 give 30 segments for a full turn.
  const cases = [
    ['square', atTen],
    ['translated circle', circleAtTen],
    ['geom2 with a hole', holed],
    ['mirrored geom2', mirrored],
  ] as const

  for (const [name, make] of cases) {
    it(`rotate_extrude of a ${name} uses the profile radius for segments`, () => {
      const result = j$.rotateExtrude({}, make())
      const expected = extrusions.extrudeRotate({ segments: 30 }, make())
      expect(volume(result)).toBeCloseTo(volume(expected), 3)
      expect(bbox(result)).toEqual(bbox(expected))
    })
  }

  it('rotate_extrude(angle=90) scales segments to the swept angle', () => {
    const result = j$.rotateExtrude({ angle: 90 }, circleAtTen())
    const expected = extrusions.extrudeRotate({ segments: 8, angle: Math.PI / 2 }, circleAtTen())
    expect(volume(result)).toBeCloseTo(volume(expected), 3)
    expect(bbox(result)).toEqual(bbox(expected))
  })

  it('returns undefined for an empty geom2', () => {
    expect(j$.rotateExtrude({}, geometries.geom2.create())).toBeUndefined()
    expect(j$.linearExtrude({ height: 5 }, geometries.geom2.create())).toBeUndefined()
  })

  it('linear_extrude keeps holes and transforms', () => {
    expect(volume(j$.linearExtrude({ height: 5 }, holed()))).toBeCloseTo(240, 2)
    const twisted = j$.linearExtrude({ height: 5, twist: 90, slices: 4 }, mirrored())
    const [min, max] = bbox(twisted)
    expect(min[2]).toBeCloseTo(0, 6)
    expect(max[2]).toBeCloseTo(5, 6)
    expect(volume(twisted)).toBeGreaterThan(0)
  })
})

describe('extrusions on the Manifold backend', () => {
  it('rotate_extrude of the corpus square matches the 30-segment revolve', async () => {
    const ctx = await initScadRuntime()
    const scad = fileURLToPath(new URL('./corpus/basics/rotate-extrude.scad', import.meta.url))
    const solid = evalScadSolidSync(scad, ctx)
    // square(3, center) at x=10 spans r 8.5..11.5, z -1.5..1.5; a 30-gon ring has volume n/2*sin(2pi/n)*(R^2-r^2)*h
    const n = 30
    expect(solid.volume()).toBeCloseTo(n / 2 * Math.sin(2 * Math.PI / n) * (11.5 ** 2 - 8.5 ** 2) * 3, 2)
    expect(solid.boundingBox()[1][0]).toBeCloseTo(11.5, 6)
  }, 30000)
})

/**
 * A twisted extrusion subdivides each edge first. Interpolating the ends as
 * p0 + (p1 - p0) * t lands one ulp off p1 at t = 1, so the corner two sides
 * share stops being bit-identical — and everything downstream of
 * extrudeFromSlices matches slice vertices exactly. NopSCADlib's fans.scad
 * (twist = -30) died in calculatePlane on a single split corner.
 */
describe('subdivideSides', () => {
  const sides = [[[0, 0], [7.249958896496416, 0.7578418183378942]], [[7.249958896496416, 0.7578418183378942], [0, 1]]]

  it('keeps the shared corner bit-identical', () => {
    const out = subdivideSides(sides, 7)
    const ends = out.map((s) => s[1])
    const starts = out.map((s) => s[0])
    for (let i = 0; i < out.length - 1; i++) {
      expect(ends[i]).toEqual(starts[i + 1])
    }
  })

  it('reuses the original endpoints rather than interpolating them', () => {
    const out = subdivideSides(sides, 7)
    expect(out[0][0]).toBe(sides[0][0])
    expect(out[6][1]).toBe(sides[0][1])
  })

  it('returns the sides untouched when there is nothing to split', () => {
    expect(subdivideSides(sides, 1)).toBe(sides)
  })

  it('produces segsPerEdge pieces per side', () => {
    expect(subdivideSides(sides, 4)).toHaveLength(8)
  })
})

/**
 * A profile that collapsed to a single point still has sides, so the
 * empty-profile guard lets it through, and extrudeRotate throws "the callback
 * function must return slices with one or more edges". OpenSCAD revolves a
 * degenerate profile to nothing — dotSCAD's lotus_like_flower.scad reaches
 * rotate_extrude with 13 sides all at the origin.
 */
describe('rotate_extrude of a degenerate profile', () => {
  const atOrigin = geometries.geom2.create(
    Array.from({ length: 13 }, () => [[0, 0], [0, 0]])
  )

  it('returns nothing rather than throwing', () => {
    expect(j$.rotateExtrude({ angle: 360 }, atOrigin)).toBeUndefined()
  })

  it('returns nothing for a profile collapsed to a point off the axis', () => {
    const offAxis = geometries.geom2.create(
      Array.from({ length: 13 }, () => [[5, 5], [5, 5]])
    )
    expect(j$.rotateExtrude({ angle: 360 }, offAxis)).toBeUndefined()
  })

  it('returns nothing for a profile collapsed to a line', () => {
    const line = geometries.geom2.create([[[5, 0], [6, 3]], [[6, 3], [7, 6]], [[7, 6], [5, 0]]])
    expect(j$.rotateExtrude({ angle: 360 }, line)).toBeUndefined()
  })

  it('still extrudes a real profile', () => {
    const square = primitives.rectangle({ size: [2, 2], center: [3, 0] })
    expect(j$.rotateExtrude({ angle: 360 }, square)).toBeDefined()
  })
})
