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
    const j$ = { cube: () => ({}), getSpecialVar: () => 0, setSpecialVar: () => {}, safeUnion: (p: unknown[]) => p[0] }
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

  it('stubs only what the file never declares', () => {
    const src = `
      function here(x) = x + 1;
      module shown() { cube(here(1)); }
      shown();
      x = missing_fn(1);
      cube(x);
    `
    const { code } = transpile(parse(src).ast, { currentFile: '/c.scad' })
    expect(code).toContain('var missing_fn_$f = () => undefined')
    expect(code).not.toMatch(/var here_\$f = \(\) =>/)
    expect(code).not.toMatch(/var shown_\$m = \(\) =>/)
  })

  it('stubs each of several undefined symbols', () => {
    const src = 'x = miss_a(1) + miss_b(2); cube(x);'
    const { code } = transpile(parse(src).ast, { currentFile: '/d.scad' })
    expect(code).toContain('var miss_a_$f = () => undefined')
    expect(code).toContain('var miss_b_$f = () => undefined')
  })

  it('treats a name the exports list only mentions as declared', () => {
    const { code } = transpile(parse('function only(x) = x;').ast, { currentFile: '/e.scad' })
    expect(code).toMatch(/Object\.assign\(exports, \{[^}]*only_\$f[^}]*\}\)/)
    expect(code).not.toMatch(/var only_\$f = \(\) =>/)
  })
})
