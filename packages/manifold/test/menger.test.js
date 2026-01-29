import { describe, it, expect, beforeAll } from 'vitest'
import {
  init,
  cube,
  cylinder,
  union,
  subtract,
  intersect,
  translate,
  rotate,
  measureVolume
} from '../src/index.js'

describe('Menger/Sierpinski intersection test', () => {
  beforeAll(async () => {
    await init()
  })

  it('should correctly intersect three orthogonal extruded bars (Menger pattern)', () => {
    // This is the classic case that breaks JSCAD's BSP booleans
    // Three bars with cross-shaped holes, intersected together

    const barSize = 30
    const holeSize = 10

    // Create a bar with a cross-shaped hole
    const createBar = () => {
      const bar = cube({ size: [barSize, barSize, barSize] })
      const hole1 = cube({ size: [holeSize, holeSize, barSize + 2] })
      const hole2 = cube({ size: [holeSize, barSize + 2, holeSize] })
      const hole3 = cube({ size: [barSize + 2, holeSize, holeSize] })
      return subtract(bar, hole1, hole2, hole3)
    }

    const bar1 = createBar()
    const bar2 = rotate([Math.PI / 2, 0, 0], createBar())
    const bar3 = rotate([0, Math.PI / 2, 0], createBar())

    // This intersection would produce non-manifold edges with BSP booleans
    const result = intersect(bar1, bar2, bar3)

    // Verify we got a valid result
    expect(result.polygons.length).toBeGreaterThan(0)
    expect(result.isEmpty()).toBe(false)

    // Verify volume is positive and reasonable
    const vol = measureVolume(result)
    expect(vol).toBeGreaterThan(0)
    console.log('Menger intersection volume:', vol)
  })

  it('should handle Swiss Cheese pattern (multiple drilled holes)', () => {
    // Another problematic case for BSP booleans - multiple coplanar operations

    const box = cube({ size: [60, 60, 10], center: [0, 0, 0] })
    const holes = []

    // Create a grid of holes
    for (let x = -20; x <= 20; x += 10) {
      for (let y = -20; y <= 20; y += 10) {
        holes.push(
          translate(
            [x, y, 0],
            cylinder({ radius: 3, height: 12, center: [0, 0, 0] })
          )
        )
      }
    }

    const result = subtract(box, ...holes)

    expect(result.polygons.length).toBeGreaterThan(0)
    expect(result.isEmpty()).toBe(false)

    const vol = measureVolume(result)
    expect(vol).toBeGreaterThan(0)
    console.log('Swiss Cheese volume:', vol)
  })

  it('should handle coplanar faces in unions', () => {
    // Two cubes sharing a face - this creates coplanar polygons
    const c1 = cube({ size: 10, center: [0, 0, 0] })
    const c2 = cube({ size: 10, center: [10, 0, 0] })

    const result = union(c1, c2)

    expect(result.polygons.length).toBeGreaterThan(0)
    expect(result.isEmpty()).toBe(false)

    // Volume should be 2000 (two 10x10x10 cubes)
    const vol = measureVolume(result)
    expect(vol).toBeCloseTo(2000, 0)
  })
})
