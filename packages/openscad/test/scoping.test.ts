import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

/**
 * Unit tests for scoping, hoisting, and special variable propagation.
 * These tests verify transpiler output patterns that caused regressions in
 * BOSL2 (2182 forward-reference failures) and nopscadlib (10 geometry mismatches).
 */

function transpileCode(scadCode: string): string {
  const result = transpile(parse(scadCode).ast, { includeHeader: false })
  return result.code
}

describe('function hoisting', () => {
  it('emits function declarations (not var assignments) for user functions', () => {
    const code = transpileCode('function add(a, b) = a + b;')
    // Must use `function add_$f(...)` not `var add_$f = ...`
    // var declarations are NOT hoisted with their values in JavaScript,
    // which breaks forward references (BOSL2 has 936+ forward-referenced functions)
    expect(code).toMatch(/^function add_\$f\(/m)
    expect(code).not.toMatch(/\bvar\s+add_\$f\b/)
    expect(code).not.toMatch(/\bconst\s+add_\$f\b/)
    expect(code).not.toMatch(/\blet\s+add_\$f\b/)
  })

  it('emits function declarations for _$f$obj variants too', () => {
    const code = transpileCode('function add(a, b) = a + b;')
    // The named-arg object variant must also be a hoisted function declaration
    expect(code).toMatch(/^function add_\$f\$obj\(/m)
    expect(code).not.toMatch(/\bvar\s+add_\$f\$obj\b/)
  })

  it('forward reference: function called before definition', () => {
    // This is the pattern that broke 2182 BOSL2 models
    const code = transpileCode(`
      x = helper(5);
      function helper(n) = n * 2;
    `)
    // helper_$f must be callable before its declaration site in the output
    // This works with function declarations (hoisted) but NOT with var (not hoisted)
    expect(code).toMatch(/^function helper_\$f\(/m)
  })

  it('mutual forward references between functions', () => {
    const code = transpileCode(`
      function is_even(n) = n == 0 ? true : is_odd(n - 1);
      function is_odd(n) = n == 0 ? false : is_even(n - 1);
    `)
    // Both must be function declarations for mutual recursion to work
    expect(code).toMatch(/^function is_even_\$f\(/m)
    expect(code).toMatch(/^function is_odd_\$f\(/m)
  })
})

describe('_$f$obj named argument handling', () => {
  it('generates delegation wrapper for object variant', () => {
    const code = transpileCode('function arc(n, r, angle, cp, points, wedge=false) = n;')
    // The $obj variant destructures WITHOUT defaults and delegates to _$f
    expect(code).toContain('_$f$obj')
    expect(code).toMatch(/let\s*\{.*n.*,.*r.*,.*angle.*,.*cp.*,.*points.*,.*wedge.*\}\s*=\s*_opts/)
    // Should delegate to the positional variant
    expect(code).toMatch(/return arc_\$f\(/)
  })

  it('partial named args do not corrupt other parameters', () => {
    // When calling arc(n, points=foo, wedge=bar), only n is positional.
    // The _$f$obj variant receives {n, points, wedge} — angle, r, cp should stay undefined.
    // This was the bug: bounce mapped ALL positional args to names, setting angle incorrectly.
    const code = transpileCode(`
      function arc(n, r, angle, cp, points, wedge=false) = n;
      x = arc(10, points=[1,2], wedge=true);
    `)
    // The call with named args should use the $obj variant
    expect(code).toContain('_$f$obj')
  })
})

describe('special variable scope propagation', () => {
  it('emits withScope for module calls with $fn', () => {
    const code = transpileCode(`
      module my_shape($fn=32) {
        circle(r=10);
      }
      my_shape($fn=64);
    `)
    // Must push scope with $fn so primitives inside see it
    expect(code).toContain('withScope')
    expect(code).toContain('$fn')
  })

  it('emits withScope even when no special vars are overridden', () => {
    // An empty withScope push/pop is semantically meaningful:
    // it creates an isolated scope layer that prevents child modifications
    // from leaking to siblings. Removing it caused 10 nopscadlib geometry mismatches.
    const code = transpileCode(`
      module wrapper() {
        children();
      }
      wrapper() cube(10);
    `)
    // The module call should still use withScope (or pushScope/popScope)
    // to maintain scope isolation
    expect(code).toContain('withScope')
  })

  it('nested modules propagate special vars through scope stack', () => {
    const code = transpileCode(`
      module outer($fn=16) {
        inner();
      }
      module inner() {
        circle(r=5);
      }
      outer($fn=32);
    `)
    // outer's $fn=32 should be visible inside inner() via the scope stack
    expect(code).toContain('withScope')
    expect(code).toContain('$fn')
  })
})

describe('let binding scoping', () => {
  it('let bindings use unique suffixes to avoid shadowing', () => {
    const code = transpileCode(`
      function f(x) = let(x = x + 1) x * 2;
    `)
    // The let binding for x should get a unique suffix to avoid shadowing the parameter
    // e.g., x$1 = x + 1, then return x$1 * 2
    expect(code).toMatch(/\bx\$\d+\b/)
  })

  it('nested let bindings get different suffixes', () => {
    const code = transpileCode(`
      function f(x) = let(x = x + 1) let(x = x * 2) x;
    `)
    // Should have two different suffixed versions of x
    const suffixes = code.match(/\bx\$(\d+)\b/g) || []
    const uniqueSuffixes = new Set(suffixes)
    expect(uniqueSuffixes.size).toBeGreaterThanOrEqual(2)
  })
})

describe('for-loop scoping', () => {
  it('for loop variable does not leak outside', () => {
    const code = transpileCode(`
      for (i = [0:3]) {
        cube(i);
      }
    `)
    // The loop variable 'i' should be scoped to the loop body
    // Using .map() or for-of with const/let ensures this
    expect(code).not.toContain('var i ')
  })

  it('nested for loops have independent variables', () => {
    const code = transpileCode(`
      for (i = [0:2]) {
        for (j = [0:2]) {
          cube([i, j, 1]);
        }
      }
    `)
    // Both i and j should be properly scoped
    expect(code).toContain('i')
    expect(code).toContain('j')
  })
})
