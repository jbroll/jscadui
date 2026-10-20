import { beforeAll, describe, expect, it } from 'vitest'
import * as manifold from '../src/index.js'
import * as jscadModule from '@jscad/modeling-for-manifold'

const jscad = jscadModule.default || jscadModule

// Internals a model has no reason to call; the tree evaluator answers "unsupported op" for them.
const NOT_SERVED = {
  colors: ['hueToColorComponent'],
  hulls: ['hullPoints2', 'hullPoints3'],
  utils: ['areAllShapesTheSameType', 'insertSorted'],
}

describe('modeling parity', () => {
  beforeAll(async () => {
    await manifold.init()
  })

  it('serves every member of every modeling namespace but the listed internals', () => {
    const missing = []
    for (const [ns, members] of Object.entries(jscad)) {
      if (typeof members !== 'object' || members === null) continue
      for (const name of Object.keys(members)) {
        if (!(manifold[ns] && name in manifold[ns]) && !NOT_SERVED[ns]?.includes(name)) missing.push(`${ns}.${name}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('extrudes a path or a 2D outline to a wall of the given width', () => {
    const path = manifold.primitives.line([[0, 0], [10, 0]])
    const wall = manifold.extrusions.extrudeRectangular({ size: 1, height: 5 }, path)
    expect(manifold.isManifoldGeom3(wall)).toBe(true)
    const [min, max] = manifold.measureBoundingBox(wall)
    expect(max[2] - min[2]).toBeCloseTo(5)
    expect(max[1] - min[1]).toBeCloseTo(2)
    const ring = manifold.extrusions.extrudeRectangular({ size: 1, height: 2 }, manifold.rectangle({ size: [10, 10] }))
    expect(manifold.measureVolume(ring)).toBeGreaterThan(0)
  })

  it('makes a triangle as a 2D shape that extrudes', () => {
    const t = manifold.primitives.triangle({ type: 'SSS', values: [3, 4, 5] })
    expect(manifold.isManifoldGeom2(t)).toBe(true)
    expect(manifold.measureVolume(manifold.extrudeLinear({ height: 1 }, t))).toBeCloseTo(6)
  })

  it('measures centre of mass and aggregate volume and area through modeling', () => {
    const a = manifold.cube({ size: 2, center: [10, 0, 0] })
    const b = manifold.cube({ size: 2, center: [0, 0, 0] })
    expect(manifold.measurements.measureCenterOfMass(a).map((v) => +v.toFixed(6))).toEqual([10, 0, 0])
    expect(manifold.measurements.measureAggregateVolume(a, b)).toBeCloseTo(16)
    expect(manifold.measurements.measureAggregateArea(a, b)).toBeCloseTo(48)
  })

  it('serves minkowski.minkowskiSum as the minkowski it already has', () => {
    expect(manifold.minkowski.minkowskiSum).toBe(manifold.minkowski)
  })
})
