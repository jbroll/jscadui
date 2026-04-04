import { describe, it, expect } from 'vitest'
import { transpile } from '../src/transpiler/transpile.js'
import { parse } from '../src/parser/parse.js'

describe('Function argument handling', () => {
  it('should generate dual-mode functions (positional and object)', () => {
    const code = `
function foo(a, b=5, c) = a + b + c;
`
    const result = transpile(parse(code).ast)

    // Should generate both _$f (positional) and _$f$obj (object) versions
    expect(result.code).toContain('function foo_$f(')
    expect(result.code).toContain('function foo_$f$obj(')
  })

  it('should call positional version for all-positional args', () => {
    const code = `
function foo(a, b=5, c) = a + b + c;
x = foo(1, 2, 3);
`
    const result = transpile(parse(code).ast)

    // Should call foo_$f with positional args (need to escape $ in regex)
    expect(result.code).toMatch(/foo_\$f\(1,\s*2,\s*3\)/)
  })

  it('should call object version for named args', () => {
    const code = `
function foo(a, b=5, c) = a + b + c;
x = foo(1, c=3);
`
    const result = transpile(parse(code).ast)

    // Should call foo_$f$obj with object args
    expect(result.code).toContain('foo_$f$obj(')
    expect(result.code).toMatch(/\{\s*a:\s*1.*c:\s*3\s*\}/)
  })

  it('should handle skipped parameters correctly', () => {
    const code = `
function test(a, b, c, d=4, e=5) = [a, b, c, d, e];
// Skip parameters b and c by using named args
result = test(1, d=40, e=50);
`
    const result = transpile(parse(code).ast)

    // Should use object version to skip b and c
    expect(result.code).toContain('test_$f$obj(')

    // Check that only a, d, e are passed in the object
    expect(result.code).toMatch(/test_\$f\$obj\(\s*\{\s*a:\s*1.*d:\s*40.*e:\s*50\s*\}\s*\)/)
  })

  it('should preserve default values when using named args', () => {
    const code = `
function add(x, y=10, z=20) = x + y + z;
// Only pass x and z, y should get default 10
result = add(5, z=30);
`
    const result = transpile(parse(code).ast)

    // Should use object version
    expect(result.code).toContain('add_$f$obj(')

    // Check that only x and z are passed, y is omitted (will get default)
    expect(result.code).toMatch(/add_\$f\$obj\(\s*\{\s*x:\s*5.*z:\s*30\s*\}\s*\)/)

    // The _$f$obj delegates to _$f which has the defaults in its parameter list
    expect(result.code).toMatch(/return add_\$f\(/)
  })

  it('should handle undef in positional version', () => {
    const code = `
function test(a, b=5, c) = [a, b, c];
result = test(1, undef, 3);
`
    const result = transpile(parse(code).ast)

    // Should use positional version (no named args)
    expect(result.code).toContain('test_$f(')

    // undef as explicit call arg becomes EXPLICIT_UNDEF so JS default params don't silently apply
    expect(result.code).toMatch(/test_\$f\(1,\s*j\$\.EXPLICIT_UNDEF,\s*3\)/)

    // Function should convert EXPLICIT_UNDEF back to undefined via resolveUndef
    expect(result.code).toMatch(/j\$\.resolveUndef\(a, b, c\)/)
  })

  it('should work with no-parameter functions', () => {
    const code = `
function empty() = 42;
result = empty();
`
    const result = transpile(parse(code).ast)

    // Should only generate _$f version (no params = no object version needed)
    expect(result.code).toContain('function empty_$f()')
    expect(result.code).not.toContain('empty_$f$obj')

    // Should call the function without arguments
    expect(result.code).toMatch(/empty_\$f\(\s*\)/)
  })
})

describe('_$f$obj delegation calling conventions', () => {
  function transpileCode(scadCode: string): string {
    return transpile(parse(scadCode).ast, { includeHeader: false }).code
  }

  it('_$f$obj destructures without defaults and delegates to _$f', () => {
    const code = transpileCode('function f(a, b=5, c=10) = a + b + c;')
    // _$f$obj should destructure without defaults
    expect(code).toMatch(/function f_\$f\$obj\(_opts = \{\}\) \{ let \{ a, b, c \} = _opts; return f_\$f\(a, b, c\); \}/)
    // _$f should have the defaults
    expect(code).toMatch(/function f_\$f\(a, b = 5, c = 10\)/)
  })

  it('missing args become undefined, triggering JS default params', () => {
    // When calling f(x=1), y is not in _opts, so destructured y=undefined.
    // Delegating f_$f(1, undefined) makes JS default b=5 fire. Correct!
    const code = transpileCode(`
      function f(x, y=5) = x + y;
      result = f(x=1);
    `)
    // The call uses $obj
    expect(code).toContain('f_$f$obj(')
    // $obj delegates without defaults
    expect(code).toMatch(/let \{ x, y \} = _opts; return f_\$f\(x, y\)/)
  })

  it('EXPLICIT_UNDEF passes through to _$f preamble', () => {
    // Calling f(1, undef) should pass EXPLICIT_UNDEF to _$f.
    // The _$f preamble converts it to real undefined.
    // Crucially, JS default b=5 does NOT fire because EXPLICIT_UNDEF !== undefined.
    const code = transpileCode(`
      function f(a, b=5) = [a, b];
      result = f(1, undef);
    `)
    // Positional call uses _$f directly
    expect(code).toMatch(/f_\$f\(1, j\$\.EXPLICIT_UNDEF\)/)
    // _$f has preamble to convert EXPLICIT_UNDEF via resolveUndef
    expect(code).toMatch(/j\$\.resolveUndef\(a, b\)/)
  })

  it('named EXPLICIT_UNDEF through delegation preserves semantics', () => {
    // f(a=1, b=undef) goes through _$f$obj → _$f(1, EXPLICIT_UNDEF)
    const code = transpileCode(`
      function f(a, b=5) = [a, b];
      result = f(a=1, b=undef);
    `)
    // Named call uses $obj
    expect(code).toContain('f_$f$obj(')
    // $obj delegates, passing EXPLICIT_UNDEF through
    expect(code).toMatch(/let \{ a, b \} = _opts; return f_\$f\(a, b\)/)
  })

  it('self-referencing defaults in delegation use renamed params', () => {
    // function f(screw = screw) has a renamed param to avoid TDZ
    const code = transpileCode(`
      screw = "M3";
      function f(screw = screw) = screw;
    `)
    // _$f$obj should destructure using the renamed param and delegate
    expect(code).toContain('_$f$obj')
    expect(code).toMatch(/return f_\$f\(/)
  })

  it('all-positional calls bypass _$f$obj entirely', () => {
    const code = transpileCode(`
      function f(a, b=5, c=10) = a + b + c;
      result = f(1, 2, 3);
    `)
    // Direct positional call
    expect(code).toMatch(/f_\$f\(1, 2, 3\)/)
    // Should NOT go through $obj for this call
    expect(code).not.toMatch(/f_\$f\$obj\(\s*\{\s*a:\s*1/)
  })

  it('no-param functions skip _$f$obj entirely', () => {
    const code = transpileCode('function f() = 42;')
    expect(code).toContain('function f_$f()')
    expect(code).not.toContain('_$f$obj')
  })

  it('tail-recursive _$f$obj delegates instead of duplicating trampoline', () => {
    const code = transpileCode(`
      function sum(n, acc=0) = n <= 0 ? acc : sum(n - 1, acc + n);
    `)
    // _$f has the trampoline
    expect(code).toMatch(/function sum_\$f\(.*while \(true\)/)
    // _$f$obj just delegates
    expect(code).toMatch(/function sum_\$f\$obj\(_opts = \{\}\) \{ let \{ n, acc \} = _opts; return sum_\$f\(n, acc\); \}/)
  })
})

describe('Module self-referencing parameter defaults', () => {
  it('should handle module(screw = screw) default pattern without TDZ', () => {
    // This pattern appears in NopSCADlib: the default for 'screw' references the outer variable 'screw'.
    // The `let { screw }` destructuring shadows the outer 'screw', causing TDZ errors in naive approach.
    // Fix: rename the param in destructuring (screw: _screw_param$N) so outer 'screw' stays accessible.
    const code = `
screw = "M3";
module foo(type, screw = screw) {
  x = screw;
}
foo(type = "test");
`
    const { ast } = parse(code)
    const result = transpile(ast)
    // Verify the generated code uses an alias for the self-referencing param
    expect(result.code).toContain('_screw_param')
    // Verify the outer 'screw' is used as the fallback default via resolveParams
    expect(result.code).toMatch(/resolveParams\(.*_screw_param.*\[.*screw\]/)
    // Verify the alias appears in the destructuring pattern
    expect(result.code).toMatch(/screw:\s*_screw_param/)
    // Verify there's no naive self-reference `screw = ... ? screw : screw`
    expect(result.code).not.toMatch(/screw\s*=\s*screw\b.*\?\s*screw\s*:\s*screw/)
  })
})
