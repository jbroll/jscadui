import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

/**
 * Tests for module argument handling
 * Modules use options object pattern: module_$m({ param: value })
 */

describe('module arguments (options object pattern)', () => {
  // Helper to get the generated code for a module call
  function getModuleCall(scadCode: string): string {
    const result = transpile(parse(scadCode).ast, { includeHeader: false })
    return result.code.trim()
  }

  describe('positional arguments', () => {
    it('maps positional arguments to parameter names', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(1, 2, 3);
      `)
      // Now uses options object with parameter names
      expect(code).toContain('foo_$m({ a: 1, b: 2, c: 3 })')
    })

    it('handles single positional argument', () => {
      const code = getModuleCall(`
        module foo(a) { cube(a); }
        foo(42);
      `)
      expect(code).toContain('foo_$m({ a: 42 })')
    })
  })

  describe('named arguments', () => {
    it('preserves named arguments in options object', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(c=3, a=1, b=2);
      `)
      // Named args are in the options object (order preserved from call)
      expect(code).toContain('c: 3')
      expect(code).toContain('a: 1')
      expect(code).toContain('b: 2')
    })

    it('handles partial named arguments', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(c=3, a=1);
      `)
      // Only provided args are in options
      expect(code).toContain('c: 3')
      expect(code).toContain('a: 1')
      expect(code).not.toContain('b:')
    })

    it('handles single named argument', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(b=42);
      `)
      expect(code).toContain('foo_$m({ b: 42 })')
    })
  })

  describe('mixed positional and named', () => {
    it('handles positional then named', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(1, c=3);
      `)
      // First positional maps to 'a', named 'c' is explicit
      expect(code).toContain('a: 1')
      expect(code).toContain('c: 3')
    })

    it('handles named then positional', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(b=2, 1, 3);
      `)
      // b=2 is named, positionals fill remaining slots
      expect(code).toContain('b: 2')
      expect(code).toContain('a: 1')
      expect(code).toContain('c: 3')
    })

    it('handles interleaved named and positional', () => {
      const code = getModuleCall(`
        module foo(a, b, c, d) { cube(a); }
        foo(1, c=3, 2);
      `)
      // 1 fills 'a', c=3 is named, 2 fills 'b'
      expect(code).toContain('a: 1')
      expect(code).toContain('c: 3')
      expect(code).toContain('b: 2')
    })
  })

  describe('options object only includes provided args', () => {
    it('only includes arguments that were provided', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(a=1);
      `)
      // Options object only has 'a', not 'b' or 'c'
      expect(code).toContain('foo_$m({ a: 1 })')
      // The call itself doesn't have b: or c:
      expect(code).not.toContain('b:')
      expect(code).not.toContain('c:')
    })

    it('handles sparse argument list', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(a=1, c=3);
      `)
      expect(code).toContain('a: 1')
      expect(code).toContain('c: 3')
      expect(code).not.toContain('b:')
    })
  })

  describe('functions (non-module)', () => {
    it('handles function calls with named arguments', () => {
      const code = getModuleCall(`
        function add(x, y) = x + y;
        result = add(y=2, x=1);
      `)
      // Function should be defined with _$f suffix (namespace separation)
      expect(code).toContain('function add_$f(')
      // Result should call the function with _$f suffix
      expect(code).toContain('add_$f(')
    })
  })

  describe('builtin primitives', () => {
    it('reorders cube arguments', () => {
      const code = getModuleCall('cube(center=true, size=[10, 20, 30]);')
      // cube(size, center) - should handle named args
      expect(code).toContain('[10, 20, 30]')
      expect(code).toContain('true')
    })

    it('reorders cylinder arguments', () => {
      const code = getModuleCall('cylinder(r=5, h=10, center=true);')
      expect(code).toContain('j$.cylinder')
      expect(code).toContain('10')  // h
      expect(code).toContain('5')   // r
    })

    it('reorders sphere arguments', () => {
      const code = getModuleCall('sphere(d=20);')
      // d parameter is handled by _sphere helper
      expect(code).toContain('j$.sphere')
      // Diameter is passed to helper which divides by 2
      expect(code).toContain('20')
    })
  })

  describe('edge cases', () => {
    it('handles empty argument list', () => {
      const code = getModuleCall(`
        module foo() { cube(1); }
        foo();
      `)
      // Empty options object for no args
      expect(code).toContain('foo_$m({})')
    })

    it('handles default values in module definition', () => {
      const code = getModuleCall(`
        module foo(a=1, b=2, c=3) { cube(a); }
        foo(c=10);
      `)
      // Only c is provided in options object
      expect(code).toContain('foo_$m({ c: 10 })')
    })

    it('handles special variable arguments ($fn, $fa, $fs)', () => {
      const code = getModuleCall('sphere(r=10, $fn=32);')
      expect(code).toContain('j$.sphere')
      expect(code).toContain('10')
    })
  })
})
