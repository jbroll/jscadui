import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

/**
 * Unit tests for expression handling in the transpiler
 */

describe('transpileExpression', () => {
  // Helper to transpile a single expression
  function transpileExpr(scadCode: string): string {
    const result = transpile(parse(scadCode).ast, { includeHeader: false })
    return result.code.trim()
  }

  describe('literals', () => {
    it('handles numeric literals', () => {
      expect(transpileExpr('x = 42;')).toContain('const x = 42')
    })

    it('handles floating point literals', () => {
      expect(transpileExpr('x = 3.14;')).toContain('const x = 3.14')
    })

    it('handles negative numbers', () => {
      // Unary minus on literals uses regular negation
      expect(transpileExpr('x = -5;')).toContain('const x = -5')
    })

    it('handles string literals', () => {
      expect(transpileExpr('x = "hello";')).toContain('const x = "hello"')
    })

    it('handles boolean true', () => {
      expect(transpileExpr('x = true;')).toContain('const x = true')
    })

    it('handles boolean false', () => {
      expect(transpileExpr('x = false;')).toContain('const x = false')
    })

    it('handles undef', () => {
      expect(transpileExpr('x = undef;')).toContain('const x = undefined')
    })
  })

  describe('vector literals', () => {
    it('handles simple vector', () => {
      expect(transpileExpr('x = [1, 2, 3];')).toContain('const x = [1, 2, 3]')
    })

    it('handles nested vectors', () => {
      expect(transpileExpr('x = [[1, 2], [3, 4]];')).toContain('const x = [[1, 2], [3, 4]]')
    })

    it('handles empty vector', () => {
      expect(transpileExpr('x = [];')).toContain('const x = []')
    })
  })

  describe('range expressions', () => {
    it('handles simple range [start:end]', () => {
      const code = transpileExpr('x = [0:10];')
      expect(code).toContain('j$.range(0, 10, 1)')
    })

    it('handles range with step [start:step:end]', () => {
      const code = transpileExpr('x = [0:2:10];')
      expect(code).toContain('j$.range(0, 10, 2)')
    })

    it('handles negative step', () => {
      const code = transpileExpr('x = [10:-1:0];')
      // Negative literals are preserved
      expect(code).toContain('j$.range(10, 0, -1)')
    })
  })

  describe('arithmetic operators', () => {
    it('handles addition with j$.vadd for vector support', () => {
      const code = transpileExpr('x = a + b;')
      expect(code).toContain('j$.vadd(a, b)')
    })

    it('handles subtraction with j$.vsub', () => {
      const code = transpileExpr('x = a - b;')
      expect(code).toContain('j$.vsub(a, b)')
    })

    it('handles multiplication with j$.vmul', () => {
      const code = transpileExpr('x = a * b;')
      expect(code).toContain('j$.vmul(a, b)')
    })

    it('handles division with j$.vdiv', () => {
      const code = transpileExpr('x = a / b;')
      expect(code).toContain('j$.vdiv(a, b)')
    })

    it('handles modulo', () => {
      const code = transpileExpr('x = a % b;')
      expect(code).toContain('(a % b)')
    })
  })

  describe('comparison operators', () => {
    it('handles equality with deep comparison', () => {
      const code = transpileExpr('x = a == b;')
      expect(code).toContain('j$.eq(a, b)')
    })

    it('handles inequality with deep comparison', () => {
      const code = transpileExpr('x = a != b;')
      expect(code).toContain('!j$.eq(a, b)')
    })

    it('handles less than', () => {
      const code = transpileExpr('x = a < b;')
      expect(code).toContain('(a < b)')
    })

    it('handles greater than', () => {
      const code = transpileExpr('x = a > b;')
      expect(code).toContain('(a > b)')
    })

    it('handles less than or equal', () => {
      const code = transpileExpr('x = a <= b;')
      expect(code).toContain('(a <= b)')
    })

    it('handles greater than or equal', () => {
      const code = transpileExpr('x = a >= b;')
      expect(code).toContain('(a >= b)')
    })
  })

  describe('logical operators', () => {
    it('handles logical AND', () => {
      const code = transpileExpr('x = a && b;')
      expect(code).toContain('(a && b)')
    })

    it('handles logical OR', () => {
      const code = transpileExpr('x = a || b;')
      expect(code).toContain('(a || b)')
    })

    it('handles logical NOT', () => {
      const code = transpileExpr('x = !a;')
      expect(code).toContain('!a')
    })
  })

  describe('ternary expressions', () => {
    it('handles ternary operator', () => {
      const code = transpileExpr('x = a ? b : c;')
      expect(code).toContain('(a ? b : c)')
    })
  })

  describe('array access', () => {
    it('handles array indexing', () => {
      const code = transpileExpr('x = arr[0];')
      expect(code).toContain('arr[0]')
    })

    it('handles nested array access', () => {
      const code = transpileExpr('x = arr[0][1];')
      expect(code).toContain('arr[0][1]')
    })
  })

  describe('function calls', () => {
    it('handles trig functions with degree conversion', () => {
      const sinCode = transpileExpr('x = sin(45);')
      expect(sinCode).toContain('Math.sin')
      expect(sinCode).toContain('Math.PI')

      const cosCode = transpileExpr('x = cos(45);')
      expect(cosCode).toContain('Math.cos')
    })

    it('handles math functions', () => {
      expect(transpileExpr('x = sqrt(4);')).toContain('Math.sqrt(4)')
      expect(transpileExpr('x = abs(5);')).toContain('Math.abs(5)')
      expect(transpileExpr('x = floor(3.7);')).toContain('Math.floor(3.7)')
    })

    it('handles len function', () => {
      const code = transpileExpr('x = len([1,2,3]);')
      expect(code).toContain('.length')
    })

    it('handles concat function', () => {
      const code = transpileExpr('x = concat([1,2], [3,4]);')
      // Uses Array.concat
      expect(code).toContain('concat')
    })
  })

  describe('let expressions', () => {
    it('handles simple let expression', () => {
      const code = transpileExpr('x = let(a = 1) a + 1;')
      expect(code).toContain('const')
      expect(code).toContain('return')
    })

    it('handles let with multiple bindings', () => {
      const code = transpileExpr('x = let(a = 1, b = 2) a + b;')
      expect(code).toContain('const')
    })
  })

  describe('list comprehensions', () => {
    it('handles simple for comprehension', () => {
      const code = transpileExpr('x = [for (i = [0:3]) i * 2];')
      expect(code).toContain('j$.range(0, 3, 1)')
      // Uses map for simple list comprehension
      expect(code).toContain('.map')
    })

    it('handles for with if filter', () => {
      const code = transpileExpr('x = [for (i = [0:5]) if (i > 2) i];')
      expect(code).toContain('j$.range(0, 5, 1)')
      // Uses map and filter for conditional comprehension
      expect(code).toContain('.map')
      expect(code).toContain('.filter')
    })
  })
})
