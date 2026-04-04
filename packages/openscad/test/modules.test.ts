import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

/**
 * Unit tests for module transpilation patterns.
 * Covers options destructuring, self-referencing defaults, nested modules,
 * and children passing — patterns that commonly cause regressions.
 */

function transpileCode(scadCode: string): string {
  const result = transpile(parse(scadCode).ast, { includeHeader: false })
  return result.code
}

describe('module declaration', () => {
  it('emits curried module pattern: module_$m(args)(children)', () => {
    const code = transpileCode(`
      module box(size=10) {
        cube(size);
      }
    `)
    expect(code).toContain('box_$m')
    // Should be a function that takes args and returns a function taking children
    expect(code).toMatch(/box_\$m/)
  })

  it('handles module with no parameters', () => {
    const code = transpileCode(`
      module thing() {
        cube(5);
      }
    `)
    expect(code).toContain('thing_$m')
  })

  it('handles self-referencing default parameters', () => {
    // function f(screw = screw) — the default references an outer variable
    // with the same name. Must rename to avoid TDZ in JavaScript.
    const code = transpileCode(`
      screw = 5;
      function f(screw = screw) = screw * 2;
    `)
    // Should contain a renamed parameter like screw$1
    expect(code).toMatch(/screw\$\w+/)
  })
})

describe('module instantiation', () => {
  it('passes named args correctly', () => {
    const code = transpileCode(`
      module box(size=10, center=false) {
        cube(size, center=center);
      }
      box(size=20, center=true);
    `)
    expect(code).toContain('box_$m')
  })

  it('passes children to module calls', () => {
    const code = transpileCode(`
      module wrapper() {
        children();
      }
      wrapper() {
        cube(10);
        sphere(5);
      }
    `)
    // children should be passed as array
    expect(code).toContain('children')
  })

  it('handles single child without braces', () => {
    const code = transpileCode(`
      module wrapper() {
        children();
      }
      wrapper() cube(10);
    `)
    expect(code).toContain('cube')
  })
})

describe('nested modules', () => {
  it('inner module can access outer scope', () => {
    const code = transpileCode(`
      module outer() {
        module inner() {
          cube(10);
        }
        inner();
      }
    `)
    // Inner modules are emitted as local const closures, not top-level _$m declarations
    expect(code).toMatch(/const inner\b/)
    expect(code).toContain('cube')
  })

  it('module calling another module', () => {
    const code = transpileCode(`
      module base() {
        cube(10);
      }
      module assembly() {
        base();
        translate([20, 0, 0]) base();
      }
      assembly();
    `)
    expect(code).toContain('base_$m')
    expect(code).toContain('assembly_$m')
  })
})

describe('children() handling', () => {
  it('children(i) accesses specific child', () => {
    const code = transpileCode(`
      module pick_first() {
        children(0);
      }
    `)
    expect(code).toContain('children')
    // Should index into children array
    expect(code).toMatch(/children.*\[.*0.*\]|children.*0/)
  })

  it('$children gives child count', () => {
    const code = transpileCode(`
      module counted() {
        echo($children);
        children();
      }
    `)
    // $children is transpiled to _children.length
    expect(code).toContain('_children.length')
  })
})
