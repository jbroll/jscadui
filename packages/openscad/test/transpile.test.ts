import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = join(__dirname, 'corpus')

/**
 * Snapshot tests for full transpilation
 * Ensures transpiler output remains consistent across refactoring
 */

describe('transpile corpus', () => {
  // Get all .scad files in corpus root (not BOSL subdirectory)
  const corpusFiles = readdirSync(corpusDir)
    .filter(f => f.endsWith('.scad'))
    .sort()

  corpusFiles.forEach(file => {
    it(`transpiles ${file} correctly`, () => {
      const source = readFileSync(join(corpusDir, file), 'utf8')
      const { ast, errors } = parse(source)

      // Parse should succeed
      expect(errors).toHaveLength(0)

      const result = transpile(ast, { includeHeader: true, format: true })

      // Should produce valid JavaScript
      expect(result.code).toBeTruthy()
      expect(result.code.length).toBeGreaterThan(0)

      // Snapshot the output for regression detection
      expect(result.code).toMatchSnapshot()
    })
  })
})

describe('transpile with options', () => {
  it('includes header when includeHeader is true', () => {
    const source = 'cube([10, 10, 10]);'
    const result = transpile(parse(source).ast, { includeHeader: true })

    expect(result.code).toContain('require')
    expect(result.code).toContain('@jscad/modeling')
  })

  it('excludes header when includeHeader is false', () => {
    const source = 'cube([10, 10, 10]);'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).not.toContain('require')
    expect(result.code).not.toContain('@jscad/modeling')
  })

  it('uses custom fn value', () => {
    const source = 'sphere(r=10);'
    const result = transpile(parse(source).ast, { includeHeader: true, fn: 24 })

    // fn value should appear in the helper
    expect(result.code).toContain('24')
  })

  it('includes source line comments when enabled', () => {
    const source = `module foo() {
  cube(10);
}

function bar(x) = x * 2;

foo();
translate([5, 0, 0]) cube(5);
`
    const result = transpile(parse(source).ast, { includeHeader: false, includeSourceComments: true })

    // Should have line comments for module declaration
    expect(result.code).toContain('// line 1 in input.scad')
    // Should have line comment for function declaration
    expect(result.code).toContain('// line 5 in input.scad')
    // Should have line comment for module call
    expect(result.code).toContain('// line 7 in input.scad')
    // Should have line comment for transform
    expect(result.code).toContain('// line 8 in input.scad')
  })

  it('excludes source line comments when disabled', () => {
    const source = `module foo() {
  cube(10);
}
foo();
`
    const result = transpile(parse(source).ast, { includeHeader: false, includeSourceComments: false })

    // Should not have any line comments
    expect(result.code).not.toContain('// line')
  })

  it('excludes source line comments by default', () => {
    const source = `module foo() {
  cube(10);
}
foo();
`
    const result = transpile(parse(source).ast, { includeHeader: false })

    // Should not have any line comments by default
    expect(result.code).not.toContain('// line')
  })
})

describe('transpile exports', () => {
  it('exports module definitions', () => {
    const source = `
      module myModule() {
        cube([10, 10, 10]);
      }
    `
    const result = transpile(parse(source).ast)

    expect(result.exports).toContain('myModule_$m')
  })

  it('exports function definitions', () => {
    const source = `
      function myFunc(x) = x * 2;
    `
    const result = transpile(parse(source).ast)

    expect(result.exports).toContain('myFunc_$f')
  })

  it('exports top-level variables', () => {
    const source = `
      myVar = 42;
    `
    const result = transpile(parse(source).ast)

    expect(result.exports).toContain('myVar')
  })
})

describe('transpile primitives', () => {
  it('generates cube with correct parameters', () => {
    const source = 'cube([10, 20, 30], center=true);'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).toContain('j$.cube')
    expect(result.code).toContain('[10, 20, 30]')
    expect(result.code).toContain('true')
  })

  it('generates sphere with radius', () => {
    const source = 'sphere(r=15);'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).toContain('j$.sphere')
    expect(result.code).toContain('15')
  })

  it('generates cylinder', () => {
    const source = 'cylinder(h=20, r=5);'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).toContain('j$.cylinder')
    expect(result.code).toContain('20')
    expect(result.code).toContain('5')
  })
})

describe('transpile transforms', () => {
  it('generates translate', () => {
    const source = 'translate([10, 20, 30]) cube(5);'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).toContain('translate')
    expect(result.code).toContain('[10, 20, 30]')
  })

  it('generates rotate', () => {
    const source = 'rotate([45, 0, 0]) cube(5);'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).toContain('j$.rotate')
    expect(result.code).toContain('[45, 0, 0]')
  })

  it('generates scale', () => {
    const source = 'scale([2, 2, 2]) cube(5);'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).toContain('scale')
    expect(result.code).toContain('[2, 2, 2]')
  })

  it('generates mirror', () => {
    const source = 'mirror([1, 0, 0]) cube(5);'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).toContain('mirror')
    expect(result.code).toContain('[1, 0, 0]')
  })
})

describe('transpile booleans', () => {
  it('generates union', () => {
    const source = 'union() { cube(5); sphere(3); }'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).toContain('union')
  })

  it('generates difference', () => {
    const source = 'difference() { cube(10); sphere(5); }'
    const result = transpile(parse(source).ast, { includeHeader: false })

    // JSCAD uses 'subtract' for difference
    expect(result.code).toContain('subtract')
  })

  it('generates intersection', () => {
    const source = 'intersection() { cube(10); sphere(8); }'
    const result = transpile(parse(source).ast, { includeHeader: false })

    // JSCAD uses 'intersect' for intersection
    expect(result.code).toContain('intersect')
  })
})

describe('transpile extrusions', () => {
  it('generates linear_extrude', () => {
    const source = 'linear_extrude(height=10) circle(r=5);'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).toContain('j$.linearExtrude')
    expect(result.code).toContain('10')
  })

  it('generates rotate_extrude', () => {
    const source = 'rotate_extrude() translate([10, 0, 0]) circle(r=2);'
    const result = transpile(parse(source).ast, { includeHeader: false })

    expect(result.code).toContain('j$.rotateExtrude')
  })
})
