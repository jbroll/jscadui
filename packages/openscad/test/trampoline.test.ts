import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

/**
 * Unit tests for tail-call trampolining.
 * Verifies that self-recursive functions in tail position get the
 * while-loop trampoline treatment with bounce objects.
 */

function transpileCode(scadCode: string): string {
  const result = transpile(parse(scadCode).ast, { includeHeader: false })
  return result.code
}

describe('tail-call trampoline', () => {
  describe('detection', () => {
    it('detects simple tail recursion', () => {
      const code = transpileCode(`
        function sum_helper(n, acc=0) = n <= 0 ? acc : sum_helper(n - 1, acc + n);
      `)
      // Should have while-loop trampoline
      expect(code).toContain('while (true)')
      expect(code).toContain('__bounce__')
    })

    it('does NOT trampoline non-tail recursion', () => {
      // n * factorial(n-1) is NOT in tail position because * happens after the call
      const code = transpileCode(`
        function factorial(n) = n <= 1 ? 1 : n * factorial(n - 1);
      `)
      expect(code).not.toContain('while (true)')
      expect(code).not.toContain('__bounce__')
      // Should be a normal function
      expect(code).toContain('return')
    })

    it('does NOT trampoline non-recursive functions', () => {
      const code = transpileCode(`
        function add(a, b) = a + b;
      `)
      expect(code).not.toContain('while (true)')
      expect(code).not.toContain('__bounce__')
    })

    it('detects tail call in both ternary branches', () => {
      const code = transpileCode(`
        function f(n, acc=0) = n < 0 ? f(0, acc) : n == 0 ? acc : f(n-1, acc+n);
      `)
      expect(code).toContain('while (true)')
      expect(code).toContain('__bounce__')
    })

    it('detects tail call inside let expression', () => {
      const code = transpileCode(`
        function cumulate(list, i=0, acc=[]) =
          i >= len(list) ? acc :
          let(newval = list[i])
          cumulate(list, i + 1, concat(acc, [newval]));
      `)
      expect(code).toContain('while (true)')
      expect(code).toContain('__bounce__')
    })
  })

  describe('bounce object generation', () => {
    it('generates bounce with positional args mapped to param names', () => {
      const code = transpileCode(`
        function sum_r(n, acc=0) = n <= 0 ? acc : sum_r(n - 1, acc + n);
      `)
      // Bounce should map args to parameter names as object
      expect(code).toContain('args: {')
      expect(code).toMatch(/args:\s*\{.*n:/)
      expect(code).toMatch(/args:\s*\{.*acc:/)
    })

    it('generates bounce with named args in self-call', () => {
      // This is the critical pattern: arc(n, points=pts, wedge=w)
      const code = transpileCode(`
        function arc(n, r, angle, cp, points, wedge=false) =
          points != undef ? arc(n, points=points, wedge=wedge) : n;
      `)
      expect(code).toContain('while (true)')
      // Bounce should only include args that were passed
      expect(code).toMatch(/__bounce__.*args:\s*\{.*n:/)
      expect(code).toMatch(/__bounce__.*args:\s*\{.*points:/)
      expect(code).toMatch(/__bounce__.*args:\s*\{.*wedge:/)
      // r, angle, cp should NOT be in the bounce (they weren't passed)
      // The destructuring reassignment handles defaults for omitted params
    })

    it('generates correct destructuring reassignment with defaults', () => {
      const code = transpileCode(`
        function f(a, b, c=10) = a > 0 ? f(a-1, b, c) : b;
      `)
      // The reassignment should include default for c
      expect(code).toMatch(/\(\{a, b, c = 10\} = _r\.args\)/)
    })
  })

  describe('hoisting preservation', () => {
    it('trampolined functions are still function declarations', () => {
      const code = transpileCode(`
        function f(n, acc=0) = n <= 0 ? acc : f(n-1, acc+n);
      `)
      // Must be function declarations (hoisted), not var/const/let
      expect(code).toMatch(/^function f_\$f\(/m)
      expect(code).toMatch(/^function f_\$f\$obj\(/m)
      expect(code).not.toMatch(/\bvar\s+f_\$f\b/)
      expect(code).not.toMatch(/\bconst\s+f_\$f\b/)
    })
  })

  describe('both variants generated', () => {
    it('_$f gets while-loop, _$f$obj delegates to _$f', () => {
      const code = transpileCode(`
        function sum_r(n, acc=0) = n <= 0 ? acc : sum_r(n - 1, acc + n);
      `)
      // Split by the two function definitions
      const fIdx = code.indexOf('function sum_r_$f(')
      const objIdx = code.indexOf('function sum_r_$f$obj(')
      expect(fIdx).toBeGreaterThanOrEqual(0)
      expect(objIdx).toBeGreaterThan(fIdx)

      const fBody = code.slice(fIdx, objIdx)
      const objBody = code.slice(objIdx)

      // _$f should have the while loop and bounce logic
      expect(fBody).toContain('while (true)')
      expect(fBody).toContain('__bounce__')

      // _$f$obj should delegate to _$f (no duplicated body)
      expect(objBody).toContain('return sum_r_$f(')
      expect(objBody).not.toContain('while (true)')
    })
  })

  describe('EXPLICIT_UNDEF preamble', () => {
    it('preamble runs before the while loop', () => {
      const code = transpileCode(`
        function f(a, b=5) = a <= 0 ? b : f(a-1, b);
      `)
      // The EXPLICIT_UNDEF check should appear before while(true)
      const fBody = code.slice(code.indexOf('function f_$f('))
      const undefPos = fBody.indexOf('EXPLICIT_UNDEF')
      const whilePos = fBody.indexOf('while (true)')
      expect(undefPos).toBeGreaterThan(0)
      expect(whilePos).toBeGreaterThan(undefPos)
    })
  })
})
