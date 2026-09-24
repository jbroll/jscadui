import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { init, cube, square } from '../src/index.js'
import { translate, rotate, scale, mirror, transform } from '../src/transforms/index.js'
import * as jscadModule from '@jscad/modeling-for-manifold'

const jscad = jscadModule.default || jscadModule

// Records every handle a method was called on, and every handle it returned.
const track = (proto, names) => {
  const seen = []
  for (const name of names) {
    const orig = proto[name]
    vi.spyOn(proto, name).mockImplementation(function (...args) {
      const out = orig.apply(this, args)
      seen.push(this, out)
      return out
    })
  }
  return seen
}

const protoOf = (handle, method) => {
  let p = handle
  while (!Object.hasOwn(p, method)) p = Object.getPrototypeOf(p)
  return p
}

const ops = [
  ['translate', (g) => translate([1, 2, 3], g)],
  ['rotate', (g) => rotate([0.1, 0.2, 0.3], g)],
  ['scale', (g) => scale([2, 2, 2], g)],
  ['mirror', (g) => mirror({ normal: [1, 0, 0] }, g)],
  ['mirror about an origin', (g) => mirror({ origin: [1, 1, 1], normal: [1, 0, 0] }, g)],
  ['transform', (g) => transform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1], g)],
]

describe('transforms free the handles they create for plain geometry', () => {
  beforeAll(async () => { await init() })
  afterEach(() => { vi.restoreAllMocks() })

  for (const [name, op] of ops) {
    it(`${name} of a plain geom3`, () => {
      const seen = track(protoOf(cube({ size: 1 }).manifold, 'translate'), ['translate', 'rotate', 'scale', 'mirror', 'transform'])
      const result = op(jscad.primitives.cube({ size: 10 }))
      for (const m of seen) if (m !== result.manifold) expect(m.isDeleted()).toBe(true)
      expect(result.volume()).toBeCloseTo(name === 'scale' ? 8000 : 1000, 3)
    })

    it(`${name} of a plain geom2`, () => {
      const seen = track(protoOf(square({ size: 1 }).crossSection, 'translate'), ['translate', 'rotate', 'scale', 'mirror', 'transform'])
      const result = op(jscad.primitives.rectangle({ size: [10, 10] }))
      for (const s of seen) if (s !== result.crossSection) expect(s.isDeleted()).toBe(true)
      expect(result.area()).toBeGreaterThan(90)
    })
  }

  it('leaves a wrapped input usable', () => {
    const c = cube({ size: 10 })
    translate([1, 0, 0], c).dispose()
    mirror({ origin: [1, 1, 1], normal: [1, 0, 0] }, c).dispose()
    expect(c.volume()).toBeCloseTo(1000, 3)
  })
})
