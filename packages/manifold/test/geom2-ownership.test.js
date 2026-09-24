import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { init, cube, square } from '../src/index.js'
import { colorize } from '../src/colors/index.js'
import { union, intersect, subtract } from '../src/booleans/index.js'
import { fromJscadGeom2 } from '../src/geometries/ManifoldGeom2.js'
import * as jscadModule from '@jscad/modeling-for-manifold'

const jscad = jscadModule.default || jscadModule

const unregistered = () => {
  const spy = vi.spyOn(FinalizationRegistry.prototype, 'unregister')
  return () => spy.mock.results.map(r => r.value)
}

describe('ManifoldGeom3 disposal', () => {
  beforeAll(async () => { await init() })
  afterEach(() => { vi.restoreAllMocks() })

  it('dispose unregisters from the finalizer', () => {
    const results = unregistered()
    const c = cube({ size: 1 })
    const m = c.manifold
    c.dispose()
    expect(results()).toContain(true)
    expect(m.isDeleted()).toBe(true)
  })
})

describe('ManifoldGeom2 ownership', () => {
  beforeAll(async () => { await init() })
  afterEach(() => { vi.restoreAllMocks() })

  it('dispose deletes the CrossSection and unregisters it', () => {
    const results = unregistered()
    const s = square({ size: 2 })
    const cs = s.crossSection
    s.dispose()
    expect(results()).toContain(true)
    expect(cs.isDeleted()).toBe(true)
    expect(s.crossSection).toBe(null)
    expect(() => s.dispose()).not.toThrow()
  })

  it('a CrossSection built lazily from a jscad source is owned', () => {
    const results = unregistered()
    const g = fromJscadGeom2(jscad.primitives.rectangle({ size: [2, 2] }))
    const cs = g.crossSection
    g.dispose()
    expect(results()).toContain(true)
    expect(cs.isDeleted()).toBe(true)
  })

  it('dispose of a jscad-sourced wrapper that never built a handle is harmless', () => {
    const g = fromJscadGeom2(jscad.primitives.rectangle({ size: [2, 2] }))
    expect(() => g.dispose()).not.toThrow()
  })

  it('clone owns its own handle', () => {
    const s = square({ size: 2 })
    const copy = s.clone()
    expect(copy.crossSection).not.toBe(s.crossSection)
    copy.dispose()
    expect(s.area()).toBeCloseTo(4, 6)
  })

  it('dispose of colorize source leaves colored usable', () => {
    const s = square({ size: 2 })
    const colored = colorize([1, 0, 0], s)
    s.dispose()
    expect(colored.area()).toBeCloseTo(4, 6)
  })

  for (const [name, op] of [['union', union], ['intersect', intersect], ['subtract', subtract]]) {
    it(`single-input ${name} returns a distinct handle`, () => {
      const s = square({ size: 2 })
      const r = op(s)
      expect(r.crossSection).not.toBe(s.crossSection)
      r.dispose()
      expect(s.area()).toBeCloseTo(4, 6)
    })
  }
})
