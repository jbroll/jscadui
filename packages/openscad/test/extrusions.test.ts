import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import jscad from '@jscad/modeling'
import j$ from '@jscadui/openscad-runtime'
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
 * linear_extrude follows OpenSCAD's LinearExtrudeNode (arguments) and
 * extrudePolygon (slices, edge splits, quad diagonals). Expected volumes are
 * OpenSCAD 2026.09.23 --backend=manifold renders of the same call.
 */
describe('linear_extrude matches OpenSCAD', () => {
  beforeAll(() => {
    j$.init(jscad)
  })

  const unitSquare = () => primitives.rectangle({ size: [1, 1] })

  it('twist with scale 0 slices and splits as OpenSCAD does', () => {
    // linear_extrude(height=3, slices=20, twist=180, scale=0) square(1, center=true)
    const g = j$.linearExtrude({ height: 3, slices: 20, twist: 180, scale: 0 }, unitSquare())
    expect(volume(g)).toBeCloseTo(1.047921, 5)
  })

  it('takes the slice count from $fa/$fs when twisted', () => {
    // linear_extrude(height=20, twist=-90) translate([2,0]) square([10,4])
    const profile = transforms.translate([7, 2, 0], primitives.rectangle({ size: [10, 4] }))
    const g = j$.linearExtrude({ height: 20, twist: -90, $fn: 0, $fa: 12, $fs: 2 }, profile)
    expect(volume(g)).toBeCloseTo(807.882096, 4)
  })

  it('extrudes a non-uniform scale in slices', () => {
    // linear_extrude(height=10, scale=[2,0.5]) square(5)
    const g = j$.linearExtrude({ height: 10, scale: [2, 0.5] }, primitives.rectangle({ size: [5, 5], center: [2.5, 2.5] }))
    expect(volume(g)).toBeCloseTo(270.833333, 4)
  })

  it('reads h, v and a missing height as OpenSCAD does', () => {
    expect(bbox(j$.linearExtrude({ h: 4 }, unitSquare()))[1][2]).toBeCloseTo(4, 9)
    expect(bbox(j$.linearExtrude({ height: 6, h: 4 }, unitSquare()))[1][2]).toBeCloseTo(6, 9)
    expect(bbox(j$.linearExtrude({}, unitSquare()))[1][2]).toBeCloseTo(100, 9)
    // v sets the direction, and its length when there is no height
    const [min, max] = bbox(j$.linearExtrude({ v: [3, 2, 5] }, unitSquare()))
    expect(min).toEqual([-0.5, -0.5, 0])
    expect(max.map((c) => +c.toFixed(9))).toEqual([3.5, 2.5, 5])
    expect(j$.linearExtrude({ v: [10, 10, -5] }, unitSquare())).toBeUndefined()
    expect(j$.linearExtrude({ height: -1 }, unitSquare())).toBeUndefined()
  })

  it('ignores a scale that is not a number or 2-vector and clamps a negative one to 0', () => {
    expect(volume(j$.linearExtrude({ height: 10, scale: [4, 5, 6] }, unitSquare()))).toBeCloseTo(10, 9)
    expect(volume(j$.linearExtrude({ height: 3, scale: -2 }, unitSquare()))).toBeCloseTo(1, 9)
  })

  it('treats slices that are not a finite number as absent, and centers only on true', () => {
    for (const slices of [undefined, Infinity, NaN, '', true]) {
      expect(volume(j$.linearExtrude({ height: 10, twist: 30, slices }, unitSquare())))
        .toBeCloseTo(volume(j$.linearExtrude({ height: 10, twist: 30 }, unitSquare())), 9)
    }
    expect(bbox(j$.linearExtrude({ height: 10, center: 1 }, unitSquare()))[0][2]).toBe(0)
    expect(bbox(j$.linearExtrude({ height: 10, center: true }, unitSquare()))[0][2]).toBe(-5)
  })
})

describe('primitives center only on true', () => {
  beforeAll(() => {
    j$.init(jscad)
  })

  it('square, cube and cylinder with center = 1 stay at the origin corner', () => {
    expect(bbox(j$.square({ size: 2, center: 1 }))[0]).toEqual([0, 0, 0])
    expect(bbox(j$.cube({ size: 2, center: 1 }))[0]).toEqual([0, 0, 0])
    expect(bbox(j$.cylinder({ h: 2, r: 1, center: 1 }))[0][2]).toBe(0)
    expect(bbox(j$.cube({ size: 2, center: true }))[0]).toEqual([-1, -1, -1])
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
