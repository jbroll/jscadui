import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

/**
 * .scad files may legally reference modules/functions that are never defined
 * (OpenSCAD warns and renders nothing). The generated .js MUST still be valid:
 * an undefined module/function call must be a no-op, not a ReferenceError.
 */
describe('undefined symbol handling — valid JS', () => {
  // Run transpiled code with a minimal j$ and a require stub; it must not throw
  // ReferenceError for the undefined symbols.
  const run = (code: string) => {
    const j$ = { cube: () => ({}), getSpecialVar: () => 0, setSpecialVar: () => {} }
    const fn = new Function('require', 'module', 'exports', 'j$', code)
    const mod = { exports: {} as Record<string, unknown> }
    fn(() => ({}), mod, mod.exports, j$)
    return mod.exports.main as (() => unknown) | undefined
  }

  it('undefined module call does not ReferenceError', () => {
    const { code } = transpile(parse('undefined_mod(5);').ast, { currentFile: '/a.scad' })
    const main = run(code)
    expect(() => main && main()).not.toThrow()
  })

  it('undefined function call does not ReferenceError', () => {
    const { code } = transpile(parse('x = undefined_fn(5); cube(x);').ast, { currentFile: '/b.scad' })
    const main = run(code)
    expect(() => main && main()).not.toThrow()
  })
})
