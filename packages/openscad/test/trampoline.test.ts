import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import j$ from '@jscadui/openscad-runtime'

const run = (src: string, call: string) => {
  const { code: js } = transpile(parse(src).ast, { currentFile: '/t.scad' })
  const fn = new Function('require', 'module', 'exports', 'j$', `${js}\nreturn ${call}`)
  return fn(() => ({}), { exports: {} }, {}, j$)
}

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

  describe('_$f$obj delegation', () => {
    it('_$f has while-loop, _$f$obj delegates to _$f', () => {
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

      // _$f should have the while-loop trampoline
      expect(fBody).toContain('while (true)')
      expect(fBody).toContain('__bounce__')

      // _$f$obj should delegate to _$f (no duplicated trampoline)
      expect(objBody).toContain('return sum_r_$f(')
      expect(objBody).not.toContain('while (true)')
    })
  })

  describe('resolveUndef preamble', () => {
    it('preamble runs before the while loop', () => {
      const code = transpileCode(`
        function f(a, b=5) = a <= 0 ? b : f(a-1, b);
      `)
      // The resolveUndef call should appear before while(true)
      const fBody = code.slice(code.indexOf('function f_$f('))
      const resolvePos = fBody.indexOf('resolveUndef')
      const whilePos = fBody.indexOf('while (true)')
      expect(resolvePos).toBeGreaterThan(0)
      expect(whilePos).toBeGreaterThan(resolvePos)
    })
  })
})

describe('runaway tail recursion', () => {
  it('fails with OpenSCAD\'s message instead of spinning', () => {
    expect(() => run('function spin(n) = spin(n + 1);', 'spin_$f(0)'))
      .toThrow("Recursion detected calling function 'spin'")
  })

  it('still runs a long legitimate tail recursion', () => {
    expect(run('function count(n, acc = 0) = n <= 0 ? acc : count(n - 1, acc + 1);', 'count_$f(900000)'))
      .toBe(900000)
  })

  it('fails a runaway local function inside a module', () => {
    const src = `
      module m() {
        function spin(n) = spin(n + 1);
        echo(spin(0));
      }
    `
    const { code: js } = transpile(parse(src).ast, { currentFile: '/t.scad' })
    const body = js.slice(js.indexOf('const spin'))
    expect(body).toContain("j$.recursionDetected('spin')")
  })
})

describe('local function TCO in modules', () => {
  it('trampolines self-tail-recursive local functions inside modules', () => {
    const code = transpileCode(`
      module m() {
        function _helper(acc, i=0) = i >= 100 ? acc : _helper(acc + i, i + 1);
        echo(_helper(0));
      }
    `)
    // Local _helper should get a while-loop trampoline
    expect(code).toContain('while (true)')
    expect(code).toContain('__bounce__')
  })

  it('does NOT trampoline non-tail local functions', () => {
    const code = transpileCode(`
      module m() {
        function factorial(n) = n <= 1 ? 1 : n * factorial(n - 1);
        echo(factorial(5));
      }
    `)
    // Non-tail recursion should not get trampoline
    expect(code).not.toContain('while (true)')
    expect(code).not.toContain('__bounce__')
  })
})
