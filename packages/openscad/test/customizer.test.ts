import { describe, it, expect } from 'vitest'
import { extractCustomizerParameters } from '../src/customizer/extract.js'
import { toJscadParameterDefinitions } from '../src/customizer/definitions.js'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

const byName = (src: string) =>
  Object.fromEntries(extractCustomizerParameters(src).parameters.map(p => [p.name, p]))
const kinds = (src: string) =>
  Object.fromEntries(extractCustomizerParameters(src).variables.map(v => [v.name, v.kind]))

describe('extractCustomizerParameters', () => {
  it('extracts literal types and default group', () => {
    const p = byName('a = 5;\nb = -2.5;\nc = "x";\nd = true;\ne = [1, 2, 3];\n')
    expect(p.a).toMatchObject({ type: 'number', default: 5, group: 'Parameters', widget: { kind: 'spinbox' } })
    expect(p.b.default).toBe(-2.5)
    expect(p.c).toMatchObject({ type: 'string', default: 'x', widget: { kind: 'text' } })
    expect(p.d).toMatchObject({ type: 'boolean', default: true, widget: { kind: 'checkbox' } })
    expect(p.e).toMatchObject({ type: 'vector', default: [1, 2, 3] })
  })

  it('reads groups, hidden sections, descriptions and locations', () => {
    const src = [
      '/* [Dimensions] */',
      '// Width of the box',
      'width = 50;',
      '/* [Hidden] */',
      'eps = 0.01;',
    ].join('\n')
    const schema = extractCustomizerParameters(src)
    expect(schema.parameters).toHaveLength(1)
    expect(schema.parameters[0]).toMatchObject({
      name: 'width', group: 'Dimensions', description: 'Width of the box', location: { line: 3, column: 1 },
    })
    expect(schema.groups).toEqual(['Dimensions'])
    expect(kinds(src)).toEqual({ width: 'parameter', eps: 'hidden' })
  })

  it('does not take a comment separated by a blank line as description', () => {
    expect(byName('// unrelated\n\nw = 1;\n').w.description).toBeUndefined()
  })

  it('parses slider, step and dropdown annotations', () => {
    const p = byName([
      'a = 5; // [10]',
      'b = 5; // [0:100]',
      'c = 5; // [0:5:100]',
      'd = 1; // 0.5',
      'e = "PLA"; // [PLA, PETG, ABS]',
      'f = 10; // [10:Small, 20:Large]',
      'g = "ab"; // 8',
      'h = [1, 2]; // [0:10]',
    ].join('\n'))
    expect(p.a.widget).toEqual({ kind: 'slider', min: 0, max: 10 })
    expect(p.b.widget).toEqual({ kind: 'slider', min: 0, max: 100 })
    expect(p.c.widget).toEqual({ kind: 'slider', min: 0, step: 5, max: 100 })
    expect(p.d.widget).toEqual({ kind: 'spinbox', step: 0.5 })
    expect(p.e.widget).toEqual({ kind: 'dropdown', options: [{ value: 'PLA' }, { value: 'PETG' }, { value: 'ABS' }] })
    expect(p.f.widget).toEqual({ kind: 'dropdown', options: [{ value: 10, label: 'Small' }, { value: 20, label: 'Large' }] })
    expect(p.g.widget).toEqual({ kind: 'text', maxLength: 8 })
    expect(p.h.widget).toEqual({ kind: 'slider', min: 0, max: 10 })
  })

  it('does not apply a trailing comment of a derived variable as description', () => {
    const p = byName('a = 1;\nb = a * 2; // note\nc = 3;\n')
    expect(p.c.description).toBeUndefined()
  })

  it('applies an annotation on the last line of the file', () => {
    expect(byName('a = 5; // [0:9]').a.widget).toEqual({ kind: 'slider', min: 0, max: 9 })
  })

  it('classifies derived, special, unsupported and after-limit variables', () => {
    const src = [
      'include <lib.scad>',
      'a = 1;',
      'b = a * 2;',
      '$fn = 32;',
      's = ["x", "y"];',
      'big = [1, 2, 3, 4, 5];',
      'module __Customizer_Limit__ () {}',
      'late = 3;',
    ].join('\n')
    expect(kinds(src)).toEqual({
      a: 'parameter', b: 'derived', $fn: 'special', s: 'unsupported', big: 'unsupported', late: 'after-limit',
    })
  })

  it('ignores assignments inside modules and function bodies', () => {
    expect(kinds('function f(x) = x;\nw = 2;\nmodule m() { inner = 1; }\n')).toEqual({ w: 'parameter' })
  })

  it('keeps the last of duplicate assignments', () => {
    expect(byName('a = 1;\na = 2;\n').a.default).toBe(2)
  })
})

describe('toJscadParameterDefinitions', () => {
  it('emits groups, sliders, choices, checkboxes and vector components', () => {
    const defs = toJscadParameterDefinitions(extractCustomizerParameters([
      '/* [Size] */',
      '// Width',
      'w = 2.5; // [0:10]',
      'v = [1, 2];',
      'm = "PLA"; // [PLA, ABS]',
      'lid = false;',
    ].join('\n')))
    expect(defs).toEqual([
      { name: '_group_0', type: 'group', caption: 'Size' },
      { name: 'w', type: 'slider', caption: 'Width', initial: 2.5, min: 0, max: 10, step: 0.1 },
      { name: 'v[0]', type: 'number', caption: 'v [0]', initial: 1, step: 1 },
      { name: 'v[1]', type: 'number', caption: 'v [1]', initial: 2, step: 1 },
      { name: 'm', type: 'choice', caption: 'm', values: ['PLA', 'ABS'], initial: 'PLA' },
      { name: 'lid', type: 'checkbox', caption: 'lid', checked: false, initial: false },
    ])
  })
})

describe('transpile with customizer option', () => {
  const src = [
    'width = 50; // [10:100]',
    'size = [1, 2];',
    'derived = width * 2;',
    'module box() { cube([width, derived, size[1]]); }',
    'box();',
  ].join('\n')

  const load = (code: string) => {
    const calls: unknown[] = []
    const j$ = {
      cube: (o: unknown) => { calls.push(o); return o },
      withScope: (_: unknown, f: () => unknown) => f(),
      vmul: (a: number, b: number) => a * b,
      setSpecialVar() {},
      safeUnion: (parts: unknown[]) => parts[0],
    }
    const exports: Record<string, any> = {}
    new Function('exports', 'j$', 'require', code)(exports, j$, () => ({}))
    return { exports, calls }
  }

  it('leaves output unchanged when the option is off', () => {
    const { ast } = parse(src)
    const off = transpile(ast, {})
    expect(off.code).not.toContain('getParameterDefinitions')
    expect(off.code).toContain('const main = () =>')
    expect(off.customizer).toBeUndefined()
  })

  it('exports definitions and applies overrides to derived variables', () => {
    const result = transpile(parse(src).ast, { customizer: true })
    expect(result.customizer?.parameters.map(p => p.name)).toEqual(['width', 'size'])

    const { exports, calls } = load(result.code)
    expect(exports.getParameterDefinitions().map((d: { name: string }) => d.name))
      .toEqual(['_group_0', 'width', 'size[0]', 'size[1]'])

    exports.main({})
    expect(calls.at(-1)).toEqual({ size: [50, 100, 2] })
    exports.main({ width: 70, 'size[1]': 9 })
    expect(calls.at(-1)).toEqual({ size: [70, 140, 9] })
    exports.main()
    expect(calls.at(-1)).toEqual({ size: [50, 100, 2] })
  })

  it('does not change output for files without parameters', () => {
    const plain = 'x = 1 + 1;\ncube(x);\n'
    const on = transpile(parse(plain).ast, { customizer: true })
    const off = transpile(parse(plain).ast, {})
    expect(on.code).toBe(off.code)
  })
})
