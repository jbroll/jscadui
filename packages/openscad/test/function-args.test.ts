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

    // The object destructuring should have y = 10 default
    expect(result.code).toMatch(/\{\s*x.*y\s*=\s*10.*z\s*=\s*20\s*\}/)
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

    // Function should convert EXPLICIT_UNDEF back to undefined (for other cases)
    expect(result.code).toMatch(/if \(b === j\$\.EXPLICIT_UNDEF\) b = undefined/)
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
    // Verify the outer 'screw' is used as the fallback default (no TDZ)
    expect(result.code).toMatch(/_screw_param.+ === undefined.*\bscrew\b/)
    // Verify the alias appears in the destructuring pattern
    expect(result.code).toMatch(/screw:\s*_screw_param/)
    // Verify there's no naive self-reference `screw = ... ? screw : screw`
    expect(result.code).not.toMatch(/screw\s*=\s*screw\b.*\?\s*screw\s*:\s*screw/)
  })
})
