import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

function transpileCode(scadCode: string): string {
  const result = transpile(parse(scadCode).ast, { includeHeader: false })
  return result.code.trim()
}

describe('output code quality', () => {
  describe('no duplicate _$f$obj blocks', () => {
    it('function with params generates exactly one _$f$obj', () => {
      const code = transpileCode(`
        function add(a, b) = a + b;
        x = add(1, 2);
        y = add(b=3, a=4);
      `)
      const objCount = (code.match(/function add_\$f\$obj/g) || []).length
      expect(objCount).toBe(1)
    })

    it('multiple functions each get one _$f$obj', () => {
      const code = transpileCode(`
        function foo(x) = x * 2;
        function bar(a, b) = a + b;
        r1 = foo(5);
        r2 = bar(1, 2);
      `)
      const fooObjCount = (code.match(/function foo_\$f\$obj/g) || []).length
      const barObjCount = (code.match(/function bar_\$f\$obj/g) || []).length
      expect(fooObjCount).toBe(1)
      expect(barObjCount).toBe(1)
    })
  })

  describe('Object.assign usage', () => {
    it('generates exactly one Object.assign for exports', () => {
      const code = transpileCode(`
        function foo(x) = x;
        module bar() { cube(1); }
        val = 42;
      `)
      const assignCount = (code.match(/Object\.assign\(exports/g) || []).length
      expect(assignCount).toBe(1)
    })
  })

  describe('syntactically valid JavaScript', () => {
    it('simple program produces parseable JS', () => {
      const code = transpileCode(`
        cube(10);
      `)
      // Should not throw when checked for basic structural validity
      // Check balanced braces/parens
      expect(countChar(code, '(')).toBe(countChar(code, ')'))
      expect(countChar(code, '{')).toBe(countChar(code, '}'))
      expect(countChar(code, '[')).toBe(countChar(code, ']'))
    })

    it('complex program produces balanced output', () => {
      const code = transpileCode(`
        function fib(n) = n <= 1 ? n : fib(n-1) + fib(n-2);
        module fancy(size=10, $fn=32) {
          difference() {
            sphere(size);
            translate([0, 0, size/2])
              cube(size, center=true);
          }
        }
        fancy(20);
        val = fib(10);
      `)
      expect(countChar(code, '(')).toBe(countChar(code, ')'))
      expect(countChar(code, '{')).toBe(countChar(code, '}'))
      expect(countChar(code, '[')).toBe(countChar(code, ']'))
    })

    it('generated code does not contain undefined references from transpiler bugs', () => {
      const code = transpileCode(`
        module test(a=1, b=2) {
          x = a + b;
          cube(x);
        }
        test(a=5);
      `)
      // Should not contain literal 'undefined' as a variable name (transpiler bug indicator)
      // Note: 'undefined' as a value (e.g., default) is fine
      expect(code).not.toMatch(/var undefined\b/)
      expect(code).not.toMatch(/const undefined\b/)
    })
  })

  describe('functions without parameters', () => {
    it('no-param function does not generate _$f$obj version', () => {
      const code = transpileCode(`
        function pi() = 3.14159;
      `)
      expect(code).toContain('function pi_$f()')
      expect(code).not.toContain('pi_$f$obj')
    })

    it('no-param function generates simple declaration', () => {
      const code = transpileCode(`
        function answer() = 42;
      `)
      // Should be a simple function, not a function with object destructuring
      expect(code).toContain('function answer_$f() { return 42; }')
    })
  })

  describe('module exports consistency', () => {
    it('exports include both _$f and _$f$obj for parameterized functions', () => {
      const result = transpile(parse(`
        function add(a, b) = a + b;
      `).ast, { includeHeader: false })
      expect(result.exports).toContain('add_$f')
      expect(result.exports).toContain('add_$f$obj')
    })

    it('exports include _$m for modules', () => {
      const result = transpile(parse(`
        module mymod(x) { cube(x); }
      `).ast, { includeHeader: false })
      expect(result.exports).toContain('mymod_$m')
    })

    it('exports include top-level variables', () => {
      const result = transpile(parse(`
        my_val = 42;
      `).ast, { includeHeader: false })
      expect(result.exports).toContain('my_val')
    })

    it('exports always include main', () => {
      const result = transpile(parse(`
        cube(10);
      `).ast, { includeHeader: false })
      expect(result.exports).toContain('main')
    })

    it('no-param functions only export _$f (not _$f$obj)', () => {
      const result = transpile(parse(`
        function constant() = 42;
      `).ast, { includeHeader: false })
      expect(result.exports).toContain('constant_$f')
      expect(result.exports).not.toContain('constant_$f$obj')
    })
  })

  describe('code size and bloat', () => {
    it('simple cube does not generate excessive code', () => {
      const code = transpileCode(`cube(10);`)
      // A simple cube should produce a reasonable amount of code
      // Main concern: no large boilerplate for trivial inputs
      const lines = code.split('\n').filter(l => l.trim().length > 0)
      expect(lines.length).toBeLessThan(10)
    })

    it('module with many parameters does not duplicate destructuring', () => {
      const code = transpileCode(`
        module box(w=10, h=10, d=10, center=false, color="blue") {
          cube([w, h, d], center=center);
        }
      `)
      // Should have exactly one let { ... } destructuring
      const destructureCount = (code.match(/let \{/g) || []).length
      expect(destructureCount).toBe(1)
    })
  })
})

/** Count occurrences of a character in a string */
function countChar(s: string, ch: string): number {
  // Skip characters inside string literals
  let count = 0
  let inString = false
  let stringChar = ''
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    if (escaped) {
      escaped = false
      continue
    }
    if (s[i] === '\\') {
      escaped = true
      continue
    }
    if (inString) {
      if (s[i] === stringChar) inString = false
      continue
    }
    if (s[i] === '"' || s[i] === "'") {
      inString = true
      stringChar = s[i]
      continue
    }
    if (s[i] === ch) count++
  }
  return count
}
