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

  it('still calls the original with a revoked Proxy as the options argument', () => {
    const { api, roundedCuboid } = fakeApi()
    const warn = vi.fn()
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const result = withOptionChecks(api, table, warn).primitives.roundedCuboid(proxy)
    expect(warn).not.toHaveBeenCalled()
    expect(roundedCuboid.mock.calls[0][0]).toBe(proxy)
    expect(result.made).toBe(proxy)
  })

  it('still calls the original and returns its result when warn throws', () => {
    const { api, roundedCuboid } = fakeApi()
    const warn = vi.fn(() => { throw new Error('warn blew up') })
    const options = { radius: 2 }
    const result = withOptionChecks(api, table, warn).primitives.roundedCuboid(options)
    expect(roundedCuboid.mock.calls[0][0]).toBe(options)
    expect(result).toEqual({ made: options })
  })

  it('does not warn on vectorText/vectorChar font, which their JSDoc omits', () => {
    const api = { text: { vectorText: vi.fn(), vectorChar: vi.fn() } }
    const warn = vi.fn()
    const wrapped = withOptionChecks(api, OPTION_TABLES['@jscad/modeling'], warn)
    wrapped.text.vectorText({ font: {}, input: 'A' })
    wrapped.text.vectorChar({ font: {}, input: 'A' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('checks a manifold-shaped api with a top-level alias of the same function', () => {
    const roundedCuboid = vi.fn((options) => ({ made: options }))
    const api = { primitives: { roundedCuboid }, roundedCuboid }
    const warn = vi.fn()
    const wrapped = withOptionChecks(api, table, warn)
    wrapped.primitives.roundedCuboid({ radius: 1 })
    wrapped.roundedCuboid({ radius: 2 })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(wrapped.primitives.roundedCuboid).toBe(wrapped.roundedCuboid)
    expect(api.roundedCuboid).toBe(roundedCuboid)
    expect(api.primitives.roundedCuboid).toBe(roundedCuboid)
  })
})

describe('withOptionChecks: types, angles and thrown errors', () => {
  const typed = {
    prefix: '',
    options: { 'primitives.cube': ['center', 'size'], 'primitives.roundedCuboid': ['roundRadius', 'size'] },
    types: { 'primitives.cube': { center: 'array', size: 'number' } },
    angles: ['transforms.rotateX'],
  }

  it('reports a number option given an array, and the reverse', () => {
    const warn = vi.fn()
    const cube = withOptionChecks({ primitives: { cube: () => 'c' } }, typed, warn).primitives.cube
    cube({ size: [1, 2, 3] })
    cube({ center: 5, size: 2 })
    cube({ size: '2' })
    expect(warn.mock.calls.map(([w]) => w)).toEqual([
      { fn: 'primitives.cube', option: 'size', expected: 'number', got: 'array' },
      { fn: 'primitives.cube', option: 'center', expected: 'array', got: 'number' },
    ])
  })

  it('reports an angle over 2π in a number or an array, and wraps functions with no options', () => {
    const rotateX = vi.fn((angle, shape) => shape)
    const warn = vi.fn()
    const wrapped = withOptionChecks({ transforms: { rotateX } }, typed, warn).transforms.rotateX
    expect(wrapped(90, 's')).toBe('s')
    wrapped([0, -180, 0], 's')
    wrapped(Math.PI * 2, 's')
    wrapped(-Math.PI, 's')
    expect(warn.mock.calls.map(([w]) => w)).toEqual([
      { fn: 'transforms.rotateX', option: 'angle', value: 90 },
      { fn: 'transforms.rotateX', option: 'angle', value: -180 },
    ])
    expect(rotateX).toHaveBeenCalledTimes(4)
  })

  it('adds the hints of its call to an error the function throws', () => {
    const cube = () => { throw new Error('size must be positive') }
    const warn = (fact) => ({ ...fact, hint: `hint for ${fact.option}` })
    const wrapped = withOptionChecks({ primitives: { cube } }, typed, warn).primitives.cube
    expect(() => wrapped({ size: [1, 2, 3] })).toThrow('size must be positive\nhint for size')
  })

  it('adds the limit a roundRadius error leaves out', () => {
    const roundedCuboid = () => { throw new Error('roundRadius must be smaller than the radius of all dimensions') }
    const wrapped = withOptionChecks({ primitives: { roundedCuboid } }, typed, vi.fn()).primitives.roundedCuboid
    expect(() => wrapped({ size: [40, 30, 2.4], roundRadius: 2 })).toThrow(/\nroundRadius 2 is too big: .* 2\.4 \/ 2 = 1\.2$/)
  })

  it('rethrows a thrown value that is not an Error unchanged', () => {
    const cube = () => { throw 'plain' }
    const wrapped = withOptionChecks({ primitives: { cube } }, typed, () => ({ hint: 'h' })).primitives.cube
    expect(() => wrapped({ size: [1] })).toThrow('plain')
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

  it('explains each fact for the api it was set to, keeping the api across resets', () => {
    const c = createWarningCollector()
    const fact = { fn: 'primitives.cylinder', option: 'radiusStart', suggestions: ['radius'] }
    expect(c.warn(fact).hint).toContain('jf.cylinder')
    c.setApi('modeling')
    c.reset()
    const warning = c.warn(fact)
    expect(warning.hint).toContain('primitives.cylinderElliptic')
    expect(c.list()).toEqual([warning])
    expect(c.warn(fact)).toEqual(warning)
    expect(c.list()).toHaveLength(1)
    c.setApi('bogus')
    expect(c.warn({ ...fact, option: 'r1' }).hint).toContain('jf.cylinder')
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

  it('still calls the original with a revoked Proxy argument or a throwing warn', () => {
    const { jf, Geom2 } = fakeFluent()
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    wrapFluentMethods(jf, methodTable, vi.fn())
    const shape = new Geom2()
    expect(shape.extrudeLinear(proxy).options).toBe(proxy)

    const throwingWarn = vi.fn(() => { throw new Error('warn blew up') })
    setMethodWarn(throwingWarn)
    const options = { hieght: 1 }
    const result = shape.extrudeLinear(options)
    expect(result.options).toBe(options)
  })

  it('checks angle and option types on methods the tables name', () => {
    const { jf, Geom2 } = fakeFluent()
    Geom2.prototype.rotateZ = function (angle) { return angle }
    const warn = vi.fn()
    wrapFluentMethods(jf, {
      ...methodTable,
      methodTypes: { FluentGeom2: { extrudeLinear: { height: 'number' } } },
      methodAngles: { FluentGeom2: ['rotateZ'] },
    }, warn)
    expect(new Geom2().rotateZ(45)).toBe(45)
    new Geom2().extrudeLinear({ height: [1, 2] })
    expect(warn.mock.calls.map(([w]) => w)).toEqual([
      { fn: 'FluentGeom2.rotateZ', option: 'angle', value: 45 },
      { fn: 'FluentGeom2.extrudeLinear', option: 'height', expected: 'number', got: 'array' },
    ])
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

describe('outline winding and boolean results', () => {
  const nodeRequire = createRequire(import.meta.url)
  const realModeling = nodeRequire('@jscad/modeling')
  const jf = nodeRequire('@jbroll/jscad-fluent')
  const CW = [[0, 0], [0, 10], [10, 0]]
  const CCW = [[0, 0], [10, 0], [0, 10]]
  const modelingWith = (warn) => withOptionChecks(realModeling, OPTION_TABLES['@jscad/modeling'], warn)
  const facts = (warn) => warn.mock.calls.map(([w]) => w)
  const insideOut = (outline) => realModeling.measurements.measureVolume(realModeling.extrusions.extrudeLinear({ height: 1 }, outline)) < 0

  afterEach(() => setMethodWarn(null))

  it('reverses clockwise points given to primitives.polygon and geometries.geom2.fromPoints, and says so', () => {
    const warn = vi.fn()
    const m = modelingWith(warn)
    const points = CW.map((p) => [...p])
    expect(insideOut(m.primitives.polygon({ points }))).toBe(false)
    expect(insideOut(m.primitives.polygon({ points, orientation: 'counterclockwise' }))).toBe(false)
    expect(insideOut(m.geometries.geom2.fromPoints(points))).toBe(false)
    expect(points).toEqual(CW)
    expect(facts(warn)).toEqual([
      { fn: 'primitives.polygon', option: 'points', area: -50, reversed: true },
      { fn: 'primitives.polygon', option: 'points', area: -50, reversed: true },
      { fn: 'geometries.geom2.fromPoints', option: 'points', area: -50, reversed: true },
    ])
  })

  it('leaves counter-clockwise points, a clockwise orientation option, holes and paths alone', () => {
    const warn = vi.fn()
    const m = modelingWith(warn)
    m.primitives.polygon({ points: CCW })
    m.geometries.geom2.fromPoints(CCW)
    expect(insideOut(m.primitives.polygon({ points: CW, orientation: 'clockwise' }))).toBe(false)
    m.primitives.polygon({ points: [[[0, 0], [10, 0], [10, 10], [0, 10]], [[2, 2], [2, 8], [8, 8], [8, 2]]] })
    m.primitives.polygon({ points: CW, paths: [[0, 1, 2]] })
    expect(warn).not.toHaveBeenCalled()
  })

  it('never reverses the paths of an outline with holes', () => {
    const warn = vi.fn()
    const m = modelingWith(warn)
    const outer = [[0, 0], [0, 10], [10, 10], [10, 0]]
    const hole = [[2, 2], [8, 2], [8, 8], [2, 8]]
    const outline = m.primitives.polygon({ points: [outer, hole] })
    expect(realModeling.geometries.geom2.toOutlines(outline).map((o) => o.length)).toEqual([4, 4])
    expect(realModeling.measurements.measureArea(outline)).toBeCloseTo(-64, 6)
    const jfWarn = vi.fn()
    const wrapped = withOptionChecks(jf, OPTION_TABLES['@jbroll/jscad-fluent'], jfWarn)
    expect(wrapped.polygon([outer, hole]).measureArea()).toBeCloseTo(-64, 6)
    expect(warn).not.toHaveBeenCalled()
    expect(jfWarn).not.toHaveBeenCalled()
  })

  it('reverses clockwise points given to jf.polygon, and says so', () => {
    const warn = vi.fn()
    const wrapped = withOptionChecks(jf, OPTION_TABLES['@jbroll/jscad-fluent'], warn)
    expect(wrapped.polygon(CW).extrudeLinear({ height: 1 }).measureVolume()).toBeGreaterThan(0)
    wrapped.polygon(CCW)
    expect(facts(warn)).toEqual([{ fn: 'jf.polygon', option: 'points', area: -50, reversed: true }])
  })

  it('reports a subtract or intersect that leaves nothing of a shape', () => {
    const warn = vi.fn()
    const { booleans, primitives, transforms } = modelingWith(warn)
    booleans.subtract(primitives.cube({ size: 2 }), primitives.cube({ size: 10 }))
    booleans.intersect(primitives.square({ size: 2 }), transforms.translate([10, 0, 0], primitives.square({ size: 2 })))
    booleans.subtract(primitives.cube({ size: 10 }), primitives.cube({ size: 2 }))
    booleans.subtract(booleans.subtract(primitives.cube({ size: 2 }), primitives.cube({ size: 10 })), primitives.cube({ size: 1 }))
    expect(facts(warn)).toEqual([
      { fn: 'booleans.subtract', empty: 'subtract' },
      { fn: 'booleans.intersect', empty: 'intersect' },
      { fn: 'booleans.subtract', empty: 'subtract' },
    ])
  })

  it('reports an empty boolean from a fluent method once', () => {
    const warn = vi.fn()
    wrapFluentMethods(jf, OPTION_TABLES['@jbroll/jscad-fluent'], warn)
    jf.cube({ size: 2 }).subtract(jf.cube({ size: 10 }))
    jf.square({ size: 2 }).intersect(jf.square({ size: 2 }).translate([10, 0, 0]))
    expect(facts(warn)).toEqual([
      { fn: 'FluentGeom3.subtract', empty: 'subtract' },
      { fn: 'FluentGeom2.intersect', empty: 'intersect' },
    ])
  })

  it('reports { points, faces } data given to a boolean, and the thrown error carries the hint', () => {
    const mesh = jf.hullPoints3([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]])
    const warn = vi.fn((fact) => ({ ...fact, hint: 'make it a shape' }))
    const { booleans, primitives } = modelingWith(warn)
    expect(() => booleans.union(primitives.cube(), mesh)).toThrow('only unions of the same type are supported\nmake it a shape')
    wrapFluentMethods(jf, OPTION_TABLES['@jbroll/jscad-fluent'], warn)
    expect(() => jf.cube().union(mesh)).toThrow('\nmake it a shape')
    expect(facts(warn)).toEqual([
      { fn: 'booleans.union', meshOperand: true },
      { fn: 'FluentGeom3.union', meshOperand: true },
    ])
  })
})
