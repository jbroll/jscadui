import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import type { FileResolver } from '../src/transpiler/context.js'
import j$ from '@jscadui/openscad-runtime'

const marker = { polygons: [] }

// OpenSCAD resolves duplicate top-level definitions last-wins: a later
// `function set(...)` replaces the earlier one for all callers, regardless
// of arity. The constructive library relies on this (its geom-merging
// `set(geom1, ..., oldGeom=$geomInfo)` follows the array `set(list, i, x)`).
// The bundled-include path must preserve that; first-wins drops the geom
// merge, $geomInfo loses every entry, and heightInfo() comes back undef.
const runBundledWithCube = (libSource: string, mainSource: string) => {
  const fileResolver: FileResolver = (filename) => {
    if (filename === 'lib.scad') {
      return { path: '/lib.scad', content: libSource }
    }
    return undefined
  }
  const { code } = transpile(parse(mainSource).ast, {
    currentFile: '/main.scad',
    fileResolver,
  })
  const fn = new Function('require', 'module', 'exports', 'j$', code)
  const mod = { exports: {} as Record<string, unknown> }
  const runtime = j$ as unknown as { cube: unknown }
  const realCube = runtime.cube
  let seen: unknown
  runtime.cube = (opts: unknown) => {
    seen = opts
    return marker
  }
  try {
    fn(() => ({}), mod, mod.exports, j$)
    ;(mod.exports.main as () => unknown)()
    return seen
  } finally {
    runtime.cube = realCube
  }
}

// A top-level variable forces the bundled-include path (pure function files
// take the require() path, where JS hoisting already gives last-wins).
describe('duplicate definitions in bundled includes resolve last-wins', () => {
  it('calls the later function definition', () => {
    const seen = runBundledWithCube(
      'shared = 1;\nfunction dup() = 1;\nfunction dup() = 2;\n',
      'include <lib.scad>\ncube(dup());\n'
    )
    expect((seen as { size: number }).size).toBe(2)
  })

  it('calls the later module definition', () => {
    const seen = runBundledWithCube(
      'shared = 1;\nmodule m(c=1) cube(c);\nmodule m(c=1) cube(c*2);\n',
      'include <lib.scad>\nm(5);\n'
    )
    expect((seen as { size: number }).size).toBe(10)
  })
})
