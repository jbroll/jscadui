import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

/**
 * Unit tests for recursive function transpilation patterns.
 * These patterns are the targets for Phase 2 (trampolining) — we need
 * to ensure they transpile correctly BEFORE any optimization, so we
 * can detect regressions when trampolining is added.
 */

function transpileCode(scadCode: string): string {
  const result = transpile(parse(scadCode).ast, { includeHeader: false })
  return result.code
}

describe('simple recursion', () => {
  it('transpiles self-recursive function', () => {
    const code = transpileCode(`
      function factorial(n) = n <= 1 ? 1 : n * factorial(n - 1);
    `)
    expect(code).toMatch(/function factorial_\$f/)
    // Must call itself by the _$f name
    expect(code).toContain('factorial_$f')
  })

  it('transpiles tail-recursive function', () => {
    // This is a tail-recursive pattern — candidate for trampolining
    const code = transpileCode(`
      function sum_helper(n, acc=0) = n <= 0 ? acc : sum_helper(n - 1, acc + n);
    `)
    expect(code).toMatch(/function sum_helper_\$f/)
    expect(code).toContain('sum_helper_$f')
  })

  it('transpiles recursive function with named args in self-call', () => {
    // This is the pattern that exposed the _$f$obj bounce bug:
    // arc() calls itself with partial named args
    const code = transpileCode(`
      function arc(n, r, angle, cp, points, wedge=false) =
        points != undef ? arc(n, points=points, wedge=wedge) : n;
    `)
    // Should have both positional and $obj variants
    expect(code).toMatch(/function arc_\$f\(/)
    expect(code).toMatch(/function arc_\$f\$obj\(/)
    // The self-call with named args should use the $obj variant
    expect(code).toContain('arc_$f$obj')
  })
})

describe('mutual recursion', () => {
  it('transpiles mutually recursive functions', () => {
    const code = transpileCode(`
      function is_even(n) = n == 0 ? true : is_odd(n - 1);
      function is_odd(n) = n == 0 ? false : is_even(n - 1);
    `)
    // Both functions must be hoisted declarations
    expect(code).toMatch(/function is_even_\$f\(/)
    expect(code).toMatch(/function is_odd_\$f\(/)
    // Each calls the other
    expect(code).toMatch(/is_even_\$f.*is_odd_\$f|is_odd_\$f.*is_even_\$f/s)
  })
})

describe('recursive modules', () => {
  it('transpiles recursive module', () => {
    const code = transpileCode(`
      module tree(depth) {
        if (depth > 0) {
          cube(depth);
          translate([depth*2, 0, 0]) tree(depth - 1);
        }
      }
      tree(3);
    `)
    expect(code).toContain('tree_$m')
  })
})

describe('deep recursion patterns (dotSCAD)', () => {
  it('transpiles accumulator-style recursion', () => {
    // Common dotSCAD pattern that causes stack overflow without trampolining
    const code = transpileCode(`
      function _cumulate(list, i=0, acc=[]) =
        i >= len(list) ? acc :
        _cumulate(list, i + 1, concat(acc, [list[i]]));
    `)
    expect(code).toMatch(/function _cumulate_\$f/)
    // Self-call should reference the function
    expect(code).toContain('_cumulate_$f')
  })

  it('transpiles list-building recursion', () => {
    const code = transpileCode(`
      function _points(n, step, i=0) =
        i >= n ? [] :
        concat([[i * step, 0]], _points(n, step, i + 1));
    `)
    expect(code).toMatch(/function _points_\$f/)
  })
})
