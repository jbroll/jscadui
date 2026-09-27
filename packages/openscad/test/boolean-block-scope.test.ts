import { describe, it, expect, beforeAll } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import j$ from '@jscadui/openscad-runtime'
import { initScadRuntime } from '../bin/run-jscad.js'

// Special-variable assignments in a builtin-boolean child block (e.g. the
// `$removing = true` inside assemble()'s remove-pass union) must use dynamic
// scope so children see them. Emitted as plain consts they are dropped: the
// remove pass then re-renders the adds and difference() empties everything.
describe('special assignments in boolean child blocks use dynamic scope', () => {
  beforeAll(async () => {
    await initScadRuntime()
  })

  const sizesFor = (src: string) => {
    const { code } = transpile(parse(src).ast, { currentFile: '/scope.scad' })
    const fn = new Function('require', 'module', 'exports', 'j$', code)
    const mod = { exports: {} as Record<string, unknown> }
    const realCube = (j$ as unknown as { cube: (o: unknown) => unknown }).cube
    const seen: number[] = []
    ;(j$ as unknown as { cube: unknown }).cube = (opts: { size: number }) => {
      seen.push(opts.size)
      return (realCube as (o: unknown) => unknown)(opts)
    }
    try {
      fn(() => ({}), mod, mod.exports, j$)
      ;(mod.exports.main as () => unknown)()
      return seen
    } finally {
      ;(j$ as unknown as { cube: unknown }).cube = realCube
    }
  }

  it('union block assignment is visible to children', () => {
    expect(sizesFor('$v = 1;\nmodule sized(n=$v) { cube(n); }\nunion() {\n $v = 7;\n sized();\n}\n')).toEqual([7])
  })

  it('difference block assignment is visible to children', () => {
    expect(sizesFor('$v = 1;\nmodule sized(n=$v) { cube(n); }\ndifference() {\n $v = 9;\n sized();\n}\n')).toEqual([9])
  })

  it('restores the outer value after the block', () => {
    expect(
      sizesFor('$v = 1;\nmodule sized(n=$v) { cube(n); }\nunion() {\n $v = 7;\n sized();\n union() {\n $v = 9;\n sized();\n }\n sized();\n}\n')
    ).toEqual([7, 9, 7])
  })
})
