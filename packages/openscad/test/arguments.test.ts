import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

/**
 * Tests for named argument reordering
 * OpenSCAD allows mixing positional and named arguments in any order
 */

describe('reorderNamedArgs', () => {
  // Helper to get the generated code for a module call
  function getModuleCall(scadCode: string): string {
    const result = transpile(parse(scadCode).ast, { includeHeader: false })
    return result.code.trim()
  }

  describe('positional arguments only', () => {
    it('keeps positional arguments in order', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(1, 2, 3);
      `)
      expect(code).toContain('foo(1, 2, 3)')
    })

    it('handles single positional argument', () => {
      const code = getModuleCall(`
        module foo(a) { cube(a); }
        foo(42);
      `)
      expect(code).toContain('foo(42)')
    })
  })

  describe('named arguments only', () => {
    it('reorders named arguments to match definition', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(c=3, a=1, b=2);
      `)
      // Should reorder to (a, b, c) order
      expect(code).toContain('foo(1, 2, 3)')
    })

    it('handles partial named arguments', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(c=3, a=1);
      `)
      // b should be undefined
      expect(code).toContain('foo(1, undefined, 3)')
    })

    it('handles single named argument', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(b=42);
      `)
      expect(code).toContain('foo(undefined, 42)')
    })
  })

  describe('mixed positional and named', () => {
    it('handles positional then named', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(1, c=3);
      `)
      // First positional fills 'a', named fills 'c'
      expect(code).toContain('foo(1, undefined, 3)')
    })

    it('handles named then positional', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(b=2, 1, 3);
      `)
      // b=2 is named, 1 fills 'a', 3 fills 'c'
      expect(code).toContain('foo(1, 2, 3)')
    })

    it('handles interleaved named and positional', () => {
      const code = getModuleCall(`
        module foo(a, b, c, d) { cube(a); }
        foo(1, c=3, 2);
      `)
      // 1 fills 'a', c=3 is named, 2 fills 'b' (skipped), then 'd'
      // Wait, 2 should fill 'b' not 'd' because b wasn't named yet
      expect(code).toContain('foo(1, 2, 3)')
    })
  })

  describe('trailing undefined trimming', () => {
    it('trims trailing undefined values', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(a=1);
      `)
      // Should not have trailing undefineds
      expect(code).toContain('foo(1)')
      expect(code).not.toContain('foo(1, undefined, undefined)')
    })

    it('keeps intermediate undefined values', () => {
      const code = getModuleCall(`
        module foo(a, b, c) { cube(a); }
        foo(a=1, c=3);
      `)
      expect(code).toContain('foo(1, undefined, 3)')
    })
  })

  describe('functions (non-module)', () => {
    it('handles function calls with named arguments', () => {
      const code = getModuleCall(`
        function add(x, y) = x + y;
        result = add(y=2, x=1);
      `)
      // Function should be defined (now uses function declaration for hoisting)
      expect(code).toContain('function add(')
      // Result should call the function
      expect(code).toContain('add(')
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
      expect(code).toContain('foo()')
    })

    it('handles default values in module definition', () => {
      const code = getModuleCall(`
        module foo(a=1, b=2, c=3) { cube(a); }
        foo(c=10);
      `)
      // Only c is overridden
      expect(code).toContain('foo(undefined, undefined, 10)')
    })

    it('handles special variable arguments ($fn, $fa, $fs)', () => {
      const code = getModuleCall('sphere(r=10, $fn=32);')
      expect(code).toContain('j$.sphere')
      expect(code).toContain('10')
    })
  })
})
