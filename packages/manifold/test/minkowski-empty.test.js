import { describe, it, expect, beforeAll } from 'vitest'
import {
  init,
  cube,
  sphere,
  translate,
  intersect,
  minkowski,
} from '../src/index.js'

// dotSCAD's r_union3 dilates children with minkowski(); when a dilate input
// is empty the sum must come back empty, not throw ("null is not a valid
// Manifold") or poison downstream ops with a null-wrapping object.
describe('minkowski with an empty operand', () => {
  beforeAll(async () => {
    await init()
  })

  it('returns empty instead of throwing', () => {
    const empty = intersect(cube({ size: 10 }), translate([100, 0, 0], cube({ size: 10 })))
    expect(empty.isEmpty()).toBe(true)
    const r = minkowski(empty, sphere({ radius: 2 }))
    expect(r.isEmpty()).toBe(true)
    expect(r.volume()).toBe(0)
  })

  it('returns empty when the second operand is empty', () => {
    const empty = intersect(cube({ size: 10 }), translate([100, 0, 0], cube({ size: 10 })))
    const r = minkowski(sphere({ radius: 2 }), empty)
    expect(r.isEmpty()).toBe(true)
  })
})
