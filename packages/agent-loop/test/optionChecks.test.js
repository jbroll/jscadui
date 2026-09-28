import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { OPTION_TABLES } from '../api/optionTable.js'
import {
  createWarningCollector, MAX_WARNINGS, setMethodWarn, suggestOptions, withOptionChecks, wrapFluentMethods,
} from '../src/optionChecks.js'

const table = {
  prefix: '',
  options: { 'primitives.roundedCuboid': ['center', 'roundRadius', 'segments', 'size'], 'primitives.missing': ['size'] },
}

const fakeApi = () => {
  const roundedCuboid = vi.fn((options) => ({ made: options }))
  const api = { primitives: { roundedCuboid }, transforms: { translate: vi.fn() } }
  api.default = api
  return { api, roundedCuboid }
}

describe('withOptionChecks', () => {
  it('warns on an unknown key and still calls the original with the same arguments', () => {
    const { api, roundedCuboid } = fakeApi()
    const warn = vi.fn()
    const options = { size: [30, 20, 10], radius: 2 }
    const extra = { other: 1 }
    const result = withOptionChecks(api, table, warn).primitives.roundedCuboid(options, extra)
    expect(warn).toHaveBeenCalledWith({ fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] })
    expect(roundedCuboid.mock.calls[0][0]).toBe(options)
    expect(roundedCuboid.mock.calls[0][1]).toBe(extra)
    expect(result).toEqual({ made: options })
  })

  it('does not warn on known keys', () => {
    const warn = vi.fn()
    withOptionChecks(fakeApi().api, table, warn).primitives.roundedCuboid({ size: [1, 1, 1], roundRadius: 0.1 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores a first argument that is not a plain object', () => {
    const warn = vi.fn()
    const wrapped = withOptionChecks(fakeApi().api, table, warn)
    class Geometry { constructor() { this.polygons = [] } }
    wrapped.primitives.roundedCuboid([1, 2])
    wrapped.primitives.roundedCuboid(5)
    wrapped.primitives.roundedCuboid(new Geometry())
    wrapped.primitives.roundedCuboid()
    expect(warn).not.toHaveBeenCalled()
  })

  it('skips table entries the api does not have', () => {
    const wrapped = withOptionChecks(fakeApi().api, table, vi.fn())
    expect(Object.keys(wrapped.primitives)).toEqual(['roundedCuboid'])
  })

  it('copies the namespaces it wraps and never mutates the api', () => {
    const { api, roundedCuboid } = fakeApi()
    const primitives = api.primitives
    const wrapped = withOptionChecks(api, table, vi.fn())
    expect(api.primitives).toBe(primitives)
    expect(api.primitives.roundedCuboid).toBe(roundedCuboid)
    expect(wrapped.primitives).not.toBe(primitives)
    expect(wrapped.transforms).toBe(api.transforms)
    expect(wrapped.default).toBe(wrapped)
  })

  it('names fluent functions with the table prefix', () => {
    const warn = vi.fn()
    withOptionChecks({ cube: () => 'c' }, { prefix: 'jf.', options: { cube: ['center', 'size'] } }, warn).cube({ sise: 1 })
    expect(warn).toHaveBeenCalledWith({ fn: 'jf.cube', option: 'sise', suggestions: ['size'] })
  })

  it('wraps accessor exports that cannot be redefined in place', () => {
    const fn = vi.fn()
    const ns = {}
    Object.defineProperty(ns, 'roundedCuboid', { get: () => fn, enumerable: true })
    const api = {}
    Object.defineProperty(api, 'primitives', { get: () => ns, enumerable: true })
    Object.defineProperty(api, '__esModule', { value: true })
    const warn = vi.fn()
    const wrapped = withOptionChecks(api, table, warn)
    wrapped.primitives.roundedCuboid({ radius: 1 })
    expect(warn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledOnce()
    expect(wrapped.__esModule).toBe(true)
  })

  it('returns the api unchanged without a table', () => {
    const { api } = fakeApi()
    expect(withOptionChecks(api, undefined, vi.fn())).toBe(api)
  })

  it('checks the real roundedCuboid entry', () => {
    const warn = vi.fn()
    const api = { primitives: { roundedCuboid: () => null } }
    withOptionChecks(api, OPTION_TABLES['@jscad/modeling'], warn).primitives.roundedCuboid({ size: [3, 2, 1], radius: 2 })
    expect(warn).toHaveBeenCalledWith({ fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'] })
  })
})

describe('suggestOptions', () => {
  it('suggests near spellings and names that contain the key', () => {
    expect(suggestOptions('hieght', ['height', 'twistAngle'])).toEqual(['height'])
    expect(suggestOptions('radius', ['center', 'roundRadius', 'size'])).toEqual(['roundRadius'])
    expect(suggestOptions('xyzzy', ['center', 'size'])).toEqual([])
  })
})

describe('createWarningCollector', () => {
  it('keeps each fn and option once', () => {
    const c = createWarningCollector()
    c.warn({ fn: 'a', option: 'x', suggestions: [] })
    c.warn({ fn: 'a', option: 'x', suggestions: [] })
    c.warn({ fn: 'b', option: 'x', suggestions: [] })
    expect(c.list().map((w) => w.fn)).toEqual(['a', 'b'])
  })

  it('stops at the cap and starts over on reset', () => {
    const c = createWarningCollector()
    for (let i = 0; i < MAX_WARNINGS + 5; i += 1) c.warn({ fn: 'f', option: `o${i}`, suggestions: [] })
    expect(c.list()).toHaveLength(20)
    c.reset()
    expect(c.list()).toEqual([])
  })

  it('hands out a copy of its list', () => {
    const c = createWarningCollector()
    c.list().push({})
    expect(c.list()).toEqual([])
  })
})

// Fresh classes per call, so one test's wraps never reach another's.
const fakeFluent = () => {
  class GeometryArray extends Array {
    mirror(options) { return { options } }
  }
  class Geom2Array extends GeometryArray {}
  class Geom2 {
    extrudeLinear(options, extra) { return { options, extra, self: this } }
    translate(offset) { return offset }
  }
  return { jf: { circle: () => new Geom2(), geom2Array: () => new Geom2Array() }, Geom2, Geom2Array }
}

const methodTable = {
  prefix: 'jf.',
  options: {},
  methods: {
    FluentGeom2: { extrudeLinear: ['height', 'twistAngle'] },
    FluentGeometryArray: { mirror: ['normal', 'origin'] },
    FluentGeom3: { center: ['axes', 'relativeTo'] },
  },
}

describe('wrapFluentMethods', () => {
  afterEach(() => setMethodWarn(null))

  it('warns on an unknown method option and calls the original with the same this and arguments', () => {
    const { jf, Geom2 } = fakeFluent()
    const warn = vi.fn()
    wrapFluentMethods(jf, methodTable, warn)
    const shape = new Geom2()
    const options = { hieght: 8 }
    const extra = { other: 1 }
    const result = shape.extrudeLinear(options, extra)
    expect(warn).toHaveBeenCalledWith({ fn: 'FluentGeom2.extrudeLinear', option: 'hieght', suggestions: ['height'] })
    expect(result.options).toBe(options)
    expect(result.extra).toBe(extra)
    expect(result.self).toBe(shape)
  })

  it('wraps inherited array methods once, on the base class', () => {
    const { jf, Geom2Array } = fakeFluent()
    const warn = vi.fn()
    wrapFluentMethods(jf, methodTable, warn)
    new Geom2Array().mirror({ normals: [1, 0, 0] })
    expect(warn).toHaveBeenCalledWith({ fn: 'FluentGeometryArray.mirror', option: 'normals', suggestions: ['normal'] })
  })

  it('ignores a first argument that is not a plain object and methods the table leaves out', () => {
    const { jf, Geom2 } = fakeFluent()
    const warn = vi.fn()
    wrapFluentMethods(jf, methodTable, warn)
    new Geom2().extrudeLinear([1, 2])
    new Geom2().extrudeLinear()
    expect(new Geom2().translate({ anything: 1 })).toEqual({ anything: 1 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('installs once and reports to the latest target', () => {
    const { jf, Geom2 } = fakeFluent()
    const first = vi.fn()
    const second = vi.fn()
    wrapFluentMethods(jf, methodTable, first)
    const wrapped = Geom2.prototype.extrudeLinear
    wrapFluentMethods(jf, methodTable, second)
    expect(Geom2.prototype.extrudeLinear).toBe(wrapped)
    new Geom2().extrudeLinear({ hieght: 1 })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    setMethodWarn(null)
    new Geom2().extrudeLinear({ hieght: 1 })
    expect(second).toHaveBeenCalledOnce()
  })

  it('skips classes with no factory, factories that throw and results that are not objects', () => {
    const jf = { cube: () => { throw new Error('no cube on this engine') }, arc: () => 'arc' }
    expect(() => wrapFluentMethods(jf, methodTable, vi.fn())).not.toThrow()
    expect(Object.getOwnPropertyNames(String.prototype)).not.toContain('center')
  })

  it('checks the real fluent classes against the generated table', () => {
    const jf = createRequire(import.meta.url)('@jbroll/jscad-fluent')
    const warn = vi.fn()
    wrapFluentMethods(jf, OPTION_TABLES['@jbroll/jscad-fluent'], warn)
    const solid = jf.circle({ radius: 5 }).extrudeLinear({ height: 10, twist: 1 }).center({ axes: [true, true, false] })
    expect(solid.measureVolume()).toBeGreaterThan(0)
    expect(warn.mock.calls.map(([w]) => w)).toEqual([
      { fn: 'FluentGeom2.extrudeLinear', option: 'twist', suggestions: ['twistAngle', 'twistSteps'] },
    ])
  })
})
