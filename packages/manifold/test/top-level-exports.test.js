import { describe, it, expect } from 'vitest'
import * as manifold from '../src/index.js'

describe('top-level export identity', () => {
  it('top-level functions are the same objects as namespaced versions', () => {
    expect(manifold.union).toBe(manifold.booleans.union)
    expect(manifold.subtract).toBe(manifold.booleans.subtract)
    expect(manifold.intersect).toBe(manifold.booleans.intersect)
    expect(manifold.translate).toBe(manifold.transforms.translate)
    expect(manifold.rotate).toBe(manifold.transforms.rotate)
    expect(manifold.scale).toBe(manifold.transforms.scale)
    expect(manifold.cube).toBe(manifold.primitives.cube)
    expect(manifold.sphere).toBe(manifold.primitives.sphere)
    expect(manifold.extrudeLinear).toBe(manifold.extrusions.extrudeLinear)
    expect(manifold.hull).toBe(manifold.hulls.hull)
    expect(manifold.colorize).toBe(manifold.colors.colorize)
    expect(manifold.measureBoundingBox).toBe(manifold.measurements.measureBoundingBox)
  })
})
