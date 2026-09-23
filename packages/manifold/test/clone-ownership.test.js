import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { init, cube, measureVolume, getManifold } from '../src/index.js'
import { colorize } from '../src/colors/index.js'
import { union, intersect } from '../src/booleans/index.js'
import { retessellate } from '../src/modifiers/index.js'
import * as jscadModule from '@jscad/modeling-for-manifold'

const jscad = jscadModule.default || jscadModule

// Every manifold an operation consumed must end up owned by an input wrapper,
// owned by the result, or deleted.
const expectNoLeak = (op, inputs) => {
  const Manifold = getManifold()
  const consumed = []
  let proto = cube({ size: 1 }).manifold
  while (!Object.hasOwn(proto, 'translate')) proto = Object.getPrototypeOf(proto)
  const translate = proto.translate
  vi.spyOn(proto, 'translate').mockImplementation(function (...args) {
    consumed.push(this)
    return translate.apply(this, args)
  })
  for (const name of ['union', 'intersection']) {
    const orig = Manifold[name]
    vi.spyOn(Manifold, name).mockImplementation((ms, ...rest) => {
      if (Array.isArray(ms)) consumed.push(...ms)
      return orig.call(Manifold, ms, ...rest)
    })
  }
  const result = op(...inputs)
  const owned = new Set([result.manifold, ...inputs.filter(g => g.isManifoldGeom3).map(g => g.manifold)])
  for (const m of consumed) {
    if (!owned.has(m)) expect(m.isDeleted()).toBe(true)
  }
  return result
}

describe('clone ownership', () => {
  beforeAll(async () => { await init() })
  afterEach(() => { vi.restoreAllMocks() })

  it('dispose of clone leaves original usable', () => {
    const c = cube({ size: 10 })
    const volBefore = measureVolume(c)
    const copy = c.clone()
    copy.dispose()
    expect(measureVolume(c)).toBeCloseTo(volBefore, 1)
  })
  it('dispose of colorize source leaves colored usable', () => {
    const c = cube({ size: 10 })
    const colored = colorize([1, 0, 0], c)
    c.dispose()
    expect(measureVolume(colored)).toBeCloseTo(1000, 0)
  })
  it('retessellate result owns its own handle', () => {
    const c = cube({ size: 10 })
    const r = retessellate(c)
    expect(r.manifold).not.toBe(c.manifold)
    c.dispose()
    expect(measureVolume(r)).toBeCloseTo(1000, 0)
  })
  it('dispose of retessellate result leaves input usable', () => {
    const c = cube({ size: 10 })
    retessellate(c).dispose()
    expect(measureVolume(c)).toBeCloseTo(1000, 0)
  })
  it('single plain geom3 union frees its temporary', () => {
    const r = expectNoLeak(union, [jscad.primitives.cube({ size: 10 })])
    expect(measureVolume(r)).toBeCloseTo(1000, 0)
  })
  it('single plain geom3 intersect frees its temporary', () => {
    const r = expectNoLeak(intersect, [jscad.primitives.cube({ size: 10 })])
    expect(measureVolume(r)).toBeCloseTo(1000, 0)
  })
  it('plain geom3 union inputs are freed', () => {
    const a = jscad.primitives.cube({ size: 10 })
    const b = jscad.primitives.cube({ size: 10, center: [5, 0, 0] })
    const r = expectNoLeak(union, [a, b])
    expect(measureVolume(r)).toBeCloseTo(1500, 0)
  })
  it('plain geom3 intersect inputs are freed', () => {
    const a = jscad.primitives.cube({ size: 10 })
    const b = jscad.primitives.cube({ size: 10, center: [5, 0, 0] })
    const r = expectNoLeak(intersect, [a, b])
    expect(measureVolume(r)).toBeCloseTo(500, 0)
  })
  it('single wrapped union input stays usable after result disposal', () => {
    const c = cube({ size: 10 })
    expectNoLeak(union, [c]).dispose()
    expect(measureVolume(c)).toBeCloseTo(1000, 0)
  })
})
