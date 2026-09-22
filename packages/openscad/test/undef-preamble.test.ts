import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import j$ from '@jscadui/openscad-runtime'

const code = (src: string) => transpile(parse(src).ast, { includeHeader: false }).code

const run = (src: string, call: string) => {
  const { code: js } = transpile(parse(src).ast, { currentFile: '/u.scad' })
  const fn = new Function('require', 'module', 'exports', 'j$', `${js}\nreturn ${call}`)
  return fn(() => ({}), { exports: {} }, {}, j$)
}

describe('the explicit-undef preamble', () => {
  it('checks each parameter in place instead of through an array', () => {
    const js = code('function f(a, b = 2) = a + b;')
    expect(js).not.toContain('resolveUndef')
    expect(js).toContain('if (a === _$U) a = undefined; if (b === _$U) b = undefined;')
  })

  it('declares the sentinel once per file, header or not', () => {
    const js = code('function f(a) = a; function g(b) = b;')
    expect(js.match(/var _\$U = j\$\.EXPLICIT_UNDEF/g)).toHaveLength(1)
  })

  it('turns an explicit undef into undef rather than the default', () => {
    expect(run('function f(a = 5) = a;', 'f_$f(j$.EXPLICIT_UNDEF)')).toBeUndefined()
    expect(run('function f(a = 5) = a; x = f(undef);', 'x')).toBeUndefined()
  })

  it('leaves an omitted argument to its default', () => {
    expect(run('function f(a = 5) = a; x = f();', 'x')).toBe(5)
  })

  it('checks a renamed self-referencing parameter under its new name', () => {
    const js = code('screw = 3; function f(screw = screw) = screw;')
    expect(js).toMatch(/if \((screw\$\d+) === _\$U\) \1 = undefined;/)
  })
})
