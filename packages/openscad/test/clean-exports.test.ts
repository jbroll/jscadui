import { describe, it, expect, beforeAll } from 'vitest'
import jscad from '@jscad/modeling'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import type { TranspiledFile } from '../src/transpiler/context.js'
import type { MetaEntry } from '../src/transpiler/cleanExports.js'
import shared, { createJ$Instance } from '@jscadui/openscad-runtime'

// Instances inherit from the shared runtime, whose init installs the geometry primitives.
beforeAll(() => { shared.init(jscad) })

type Files = Record<string, string>
type Call<R = unknown> = (...args: unknown[]) => R
interface Loaded {
  $meta: MetaEntry[]
  vars: Record<string, unknown>
  washer: Call
  area: Call<number>
  twice: Call<number>
  half: Call<number>
  nut?: Call
  washer_$m: unknown
  area_$f: unknown
  main: unknown
  M3_washer: unknown
  other_d: unknown
  x: unknown
}

// Transpiles `entry` and its dependencies into one cache, then loads it with a require that loads the others.
const load = (files: Files, entry = '/main.scad') => {
  const j$ = createJ$Instance()
  const cache = new Map<string, Loaded>()
  const transpiled = new Map<string, TranspiledFile>()
  const fileResolver = (name: string) => (files['/' + name] ? { path: '/' + name, content: files['/' + name] } : undefined)
  const compile = (path: string) => transpiled.get(path)?.code
    ?? transpile(parse(files[path]).ast, { currentFile: path, fileResolver, includeHeader: false }, transpiled).code
  compile(entry)
  const req = (path: string): Loaded => {
    const cached = cache.get(path)
    if (cached) return cached
    const mod = { exports: {} as Loaded }
    cache.set(path, mod.exports)
    new Function('require', 'module', 'exports', 'j$', compile(path))(req, mod, mod.exports, j$)
    return mod.exports
  }
  return { exports: req(entry), j$ }
}

const SRC = `
module washer(type, h = 2 * (1 + 0)) { cylinder(r = type[0], h = h); children(); }
function area(r) = PI * r * r;
M3_washer = [3, 7];
layer_height = $fn * 0.1;
`

describe('clean exports', () => {
  it('lists modules, functions and variables in $meta with default source text', () => {
    const { exports } = load({ '/main.scad': SRC })
    expect(exports.$meta).toEqual([
      { name: 'washer', kind: 'module', params: [{ name: 'type' }, { name: 'h', default: '2 * (1 + 0)' }] },
      { name: 'area', kind: 'function', params: [{ name: 'r' }] },
      { name: 'M3_washer', kind: 'variable' },
      { name: 'layer_height', kind: 'variable', lazy: true },
    ])
  })

  it('calls a module positionally and returns geometry', () => {
    const { exports } = load({ '/main.scad': SRC })
    expect(exports.washer(exports.M3_washer)).toBeTruthy()
  })

  it('reads a special-variable variable through a getter', () => {
    const { exports, j$ } = load({ '/main.scad': SRC })
    expect(j$.withScope({ $fn: 30 }, () => exports.vars.layer_height)).toBeCloseTo(3)
  })

  it('keeps a lazy variable callable through a use forwarder', () => {
    const files = {
      '/L.scad': 'V = $fn * 2;',
      '/U.scad': 'include <L.scad>\nmodule u() cube(1);',
      '/F.scad': 'use <U.scad>\nfunction g() = V;',
      // P transpiles F inside its include of X, so F inherits V as lazy and calls the forwarder.
      '/X.scad': 'use <F.scad>\nx = g();',
      '/P.scad': 'include <L.scad>\ninclude <X.scad>',
    }
    expect(load(files, '/P.scad').exports.x).toBe(0)
  })

  it('calls a function by name', () => {
    const { exports } = load({ '/main.scad': SRC })
    expect(exports.area({ r: 1 })).toBeCloseTo(Math.PI)
  })

  it('keeps the suffixed exports beside the clean ones', () => {
    const { exports } = load({ '/main.scad': SRC })
    expect(typeof exports.washer_$m).toBe('function')
    expect(typeof exports.area_$f).toBe('function')
    expect(typeof exports.main).toBe('function')
  })

  it('re-exports clean names through a bundled include', () => {
    const files = {
      '/other.scad': 'other_d = 4; module bolt(d = 3) cylinder(d = d, h = 10); function twice(x) = 2 * x;',
      '/main.scad': 'include <other.scad>\nmodule plate() bolt(d = twice(2));',
    }
    const { exports } = load(files)
    expect(exports.twice(3)).toBe(6)
    expect(exports.other_d).toBe(4)
    expect(exports.$meta.map((e) => e.name)).toEqual(expect.arrayContaining(['plate', 'bolt', 'twice', 'other_d']))
  })

  it('re-exports clean names through an optimized include', () => {
    const files = {
      '/pure.scad': 'module nut(d = 3) cylinder(d = d, h = 2); function half(x) = x / 2;',
      '/main.scad': 'include <pure.scad>\nnut(d = half(8));',
    }
    const { exports } = load(files)
    expect(exports.half(8)).toBe(4)
    expect(exports.nut?.(3)).toBeTruthy()
    expect(exports.$meta.find((e) => e.name === 'nut')?.params).toEqual([{ name: 'd', default: '3' }])
  })

  it('does not re-export names from use', () => {
    const files = {
      '/pure.scad': 'module nut(d = 3) cylinder(d = d, h = 2);',
      '/main.scad': 'use <pure.scad>\nnut();',
    }
    const { exports } = load(files)
    expect(exports.nut).toBeUndefined()
  })

  it('declares no stub for a name the export line mentions', () => {
    const { code } = transpile(parse(SRC).ast, { includeHeader: false })
    expect(code).not.toMatch(/var washer_\$m = \(\) =>/)
  })
})
