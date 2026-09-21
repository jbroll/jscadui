import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import j$ from '@jscadui/openscad-runtime'

/**
 * j$.NO_CHILD marks a conditional branch that was not taken. It is internal to
 * the generated code: callers of main() get geometry or undefined. The browser
 * renderer converts every returned entity and throws "invalid jscad geometry,
 * not an object" on the sentinel, which the STL path never sees because it
 * unions the result.
 */
describe('main() result', () => {
  const runMain = (src: string) => {
    const { code } = transpile(parse(src).ast, { currentFile: '/t.scad' })
    const fn = new Function('require', 'module', 'exports', 'j$', code)
    const mod = { exports: {} as Record<string, unknown> }
    fn(() => ({}), mod, mod.exports, j$)
    return (mod.exports.main as () => unknown)()
  }

  it('returns undefined for a single untaken top-level conditional', () => {
    expect(runMain('if ($preview) cube(1);')).toBeUndefined()
  })

  it('returns undefined for several untaken top-level conditionals', () => {
    expect(runMain('if ($preview) cube(1);\nif ($preview) sphere(1);')).toBeUndefined()
  })

  it('returns undefined for a statement that is a function call', () => {
    // BOSL's 022-math-sum_of_squares.scad is `sum_of_squares([1,2,3]);` — the
    // value is a number, and the browser rejects a number as geometry.
    expect(runMain('function sq(v) = v * v;\nsq(3);')).toBeUndefined()
  })

  it('never returns the NO_CHILD sentinel', () => {
    expect(runMain('if (false) cube(1);')).not.toBe(j$.NO_CHILD)
  })
})

/**
 * $preview is a run-time special variable, not a transpile-time constant: the
 * app shows a preview and exports a render from the same transpiled module.
 */
describe('$preview', () => {
  const marker = { polygons: [] }

  const runMainWith = (src: string, preview: boolean) => {
    const { code } = transpile(parse(src).ast, { currentFile: '/p.scad' })
    const fn = new Function('require', 'module', 'exports', 'j$', code)
    const mod = { exports: {} as Record<string, unknown> }
    const runtime = j$ as unknown as { cube: unknown }
    const realCube = runtime.cube
    runtime.cube = () => marker
    j$.setSpecialVar('$preview', preview)
    try {
      fn(() => ({}), mod, mod.exports, j$)
      return (mod.exports.main as () => unknown)()
    } finally {
      runtime.cube = realCube
      j$.setSpecialVar('$preview', false)
    }
  }

  it('takes the branch when $preview is set at run time', () => {
    expect(runMainWith('if ($preview) cube(1);', true)).toBe(marker)
  })

  it('skips the branch when $preview is clear', () => {
    expect(runMainWith('if ($preview) cube(1);', false)).toBeUndefined()
  })

  it('defaults to false', () => {
    expect(j$.getSpecialVar('$preview')).toBe(false)
  })
})
