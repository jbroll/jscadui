import { describe, it, expect } from 'vitest'
import j$, { createJ$Instance } from '@jscadui/openscad-runtime'

const rt = createJ$Instance()

type Meta = { name: string; kind: string; params?: { name: string; default?: string }[]; lazy?: boolean }[]
type Call<R = unknown> = (...args: unknown[]) => R
interface Loaded {
  washer: Call<{ opts: Record<string, unknown>; kids: unknown[] }>
  area: Call<number>
  fa: Call<number>
  nut: Call
  main: unknown
  M3_washer: unknown
  layer_height: unknown
  fn: Record<string, Call>
  vars: Record<string, unknown>
  $meta: Meta
}

const washerParams = [{ name: 'type' }, { name: 'h', default: '2' }]
const raw = () => ({
  washer_$m: (opts = {}) => (children: (() => unknown)[] = []) => ({ opts, kids: children.map((c) => c()) }),
  area_$f: (r: number) => Math.PI * r * r,
  area_$f$obj: ({ r }: { r: number }) => Math.PI * r * r,
  fa_$f: () => rt.getSpecialVar('$fa'),
  M3_washer: [3, 7],
  layer_height: () => rt.getSpecialVar('$fn') * 0.1,
})
const meta: Meta = [
  { name: 'washer', kind: 'module', params: washerParams },
  { name: 'area', kind: 'function', params: [{ name: 'r' }] },
  { name: 'fa', kind: 'function', params: [] },
  { name: 'M3_washer', kind: 'variable' },
  { name: 'layer_height', kind: 'variable', lazy: true },
]
const load = (m: Meta = meta, r: object = raw(), exports: object = {}) => {
  rt.exportClean(exports, r, m)
  return exports as Loaded
}

describe('exportClean', () => {
  it('maps positional module arguments to parameter names', () => {
    expect(load().washer([3, 7], 1).opts).toEqual({ type: [3, 7], h: 1 })
  })

  it('takes a trailing plain object as named arguments', () => {
    expect(load().washer([3, 7], { h: 4 }).opts).toEqual({ type: [3, 7], h: 4 })
  })

  it('passes $ keys through to the module options', () => {
    expect(load().washer([3, 7], { $fn: 64 }).opts).toEqual({ type: [3, 7], $fn: 64 })
  })

  it('wraps children geometry in thunks', () => {
    const g = { polygons: [] }
    expect(load().washer([3, 7], { children: g }).kids).toEqual([g])
    expect(load().washer([3, 7], { children: [g, g] }).kids).toEqual([g, g])
    expect(load().washer([3, 7]).kids).toEqual([])
  })

  it('calls functions positionally or by name', () => {
    const e = load()
    expect(e.area(2)).toBeCloseTo(4 * Math.PI)
    expect(e.area({ r: 2 })).toBeCloseTo(4 * Math.PI)
    expect(e.fn.area(2)).toBeCloseTo(4 * Math.PI)
  })

  it('runs a function with $ arguments inside a special-variable scope', () => {
    expect(load().fa({ $fa: 7 })).toBe(7)
  })

  it('exports plain variables by value and lazy ones as getters', () => {
    const e = load()
    expect(e.M3_washer).toEqual([3, 7])
    expect(e.vars.M3_washer).toEqual([3, 7])
    expect(e.layer_height).toBe(0)
    expect(rt.withScope({ $fn: 30 }, () => e.vars.layer_height)).toBeCloseTo(3)
  })

  it('gives a shared name to the module, then the function, then the variable', () => {
    const r = { ...raw(), nut_$m: () => () => 'module', nut_$f: () => 'function', nut: 'variable' }
    const m = [
      { name: 'nut', kind: 'variable' },
      { name: 'nut', kind: 'function', params: [] },
      { name: 'nut', kind: 'module', params: [] },
    ]
    const e = load(m, r)
    expect(e.nut()).toBe('module')
    expect(e.fn.nut()).toBe('function')
    expect(e.vars.nut).toBe('variable')
  })

  it('gives reserved names no bare export', () => {
    const r = { main_$m: () => () => 'm', fn_$f: () => 'f', vars: 1 }
    const m = [
      { name: 'main', kind: 'module', params: [] },
      { name: 'fn', kind: 'function', params: [] },
      { name: 'vars', kind: 'variable' },
    ]
    const e = load(m, r, { main: 'original' })
    expect(e.main).toBe('original')
    expect(e.fn.fn()).toBe('f')
    expect(e.vars.vars).toBe(1)
  })

  it('leaves a raw lazy variable already on exports as its thunk', () => {
    const thunk = () => rt.getSpecialVar('$fn') * 0.1
    const e = load([{ name: 'layer_height', kind: 'variable', lazy: true }], { layer_height: thunk }, { layer_height: thunk })
    expect(e.layer_height).toBe(thunk)
    expect(rt.withScope({ $fn: 30 }, () => e.vars.layer_height)).toBeCloseTo(3)
  })

  it('does not replace a raw variable on exports with a module of the same name', () => {
    const r = { nut_$m: () => () => 'module', nut: 'variable' }
    const e = load([{ name: 'nut', kind: 'variable' }, { name: 'nut', kind: 'module', params: [] }], r, { ...r })
    expect(e.nut).toBe('variable')
    expect(e.vars.nut).toBe('variable')
  })

  it('publishes the metadata', () => {
    expect(load().$meta).toBe(meta)
  })

  it('is inherited by the default instance', () => {
    expect(typeof j$.exportClean).toBe('function')
  })
})
