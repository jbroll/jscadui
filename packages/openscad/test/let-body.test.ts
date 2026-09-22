import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import j$ from '@jscadui/openscad-runtime'

/**
 * `function f(...) = let(...) expr;` is the commonest function shape in dotSCAD
 * and BOSL2. Compiled to `return (() => { const ...; return expr })()`, every
 * call pays a closure and a stack frame, which halves how deep a recursion can
 * go: dotSCAD's maze carver recursed ~615 levels at four frames a level and
 * overflowed a browser worker. As the whole body, the bindings can simply be
 * statements of the function.
 */
describe('a let() that is the whole function body', () => {
  const code = (src: string) => transpile(parse(src).ast, { includeHeader: false }).code

  const run = (src: string, call: string) => {
    const { code: js } = transpile(parse(src).ast, { currentFile: '/l.scad' })
    const fn = new Function('require', 'module', 'exports', 'j$', `${js}\nreturn ${call}`)
    return fn(() => ({}), { exports: {} }, {}, j$)
  }

  it('is emitted as statements, not an IIFE', () => {
    const js = code('function f(a) = let(b = a + 1) b * 2;')
    const body = js.slice(js.indexOf('function f_$f('), js.indexOf('function f_$f$obj'))
    expect(body).not.toContain('(() =>')
    expect(run('function f(a) = let(b = a + 1) b * 2;', 'f_$f(3)')).toBe(8)
  })

  it('flattens a let nested directly in a let', () => {
    const src = 'function f(a) = let(b = a + 1) let(c = b * 2) c + b;'
    const js = code(src)
    const body = js.slice(js.indexOf('function f_$f('), js.indexOf('function f_$f$obj'))
    expect(body).not.toContain('(() =>')
    expect(run(src, 'f_$f(3)')).toBe(12)
  })

  it('keeps a let that is only part of the body as an expression', () => {
    expect(run('function f(a) = 1 + let(b = a) b;', 'f_$f(4)')).toBe(5)
  })

  it('still scopes a special variable the let binds', () => {
    expect(run('function f() = let($fn = 8) $fn;', 'f_$f()')).toBe(8)
  })

  it('lets later bindings see earlier ones', () => {
    expect(run('function f(a) = let(b = a, c = b + 1, d = c * b) d;', 'f_$f(2)')).toBe(6)
  })

  it('keeps a function with no parameters working', () => {
    expect(run('function f() = let(b = 5) b + 1;', 'f_$f()')).toBe(6)
  })

  it('recurses through a let body without an extra frame per level', () => {
    // Mutual recursion shaped like dotSCAD's go_maze <-> next_cells.
    const src = `
      function go(n) = let(a = n - 1) next(a);
      function next(n) = let(b = n) b <= 0 ? 0 : 1 + go(b);
    `
    expect(run(src, 'go_$f(2000)')).toBe(1999)
  })
})
