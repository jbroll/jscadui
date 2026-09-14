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
