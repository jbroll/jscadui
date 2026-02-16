/**
 * Test explicit special variable scoping with j$.withScope()
 */
import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'

describe('explicit special variable scoping', () => {
  it('should use withScope for modules with special vars', () => {
    const source = `
      module test_with(size=10) {
        cube(size, $fn=32);
      }
    `

    const { ast } = parse(source)
    const result = transpile(ast, { includeHeader: false })

    // Should use j$.withScope()
    expect(result.code).toContain('j$.withScope')
    expect(result.code).toContain('return j$.withScope($$sv, () => {')
    
    // Should NOT use pushScope/popScope
    expect(result.code).not.toContain('j$.pushScope')
    expect(result.code).not.toContain('j$.popScope')
    expect(result.code).not.toContain('try {')
    expect(result.code).not.toContain('finally {')
  })

  it('should use withScope even for modules without declared special vars', () => {
    const source = `
      module test_without(size=10) {
        cube(size);
      }
    `

    const { ast } = parse(source)
    const result = transpile(ast, { includeHeader: false })

    // Should use withScope to pass through any special vars from caller
    // Example: test_without(size=20, $fn=32) should pass $fn through even though not declared
    expect(result.code).toContain('j$.withScope($$sv, () => {')

    // Should NOT use old pushScope/popScope pattern
    expect(result.code).not.toContain('j$.pushScope')
    expect(result.code).not.toContain('j$.popScope')
    expect(result.code).not.toContain('try {')
    expect(result.code).not.toContain('finally {')
  })

  it('should handle modules with declared special var parameters', () => {
    const source = `
      module test_declared($fn=16, size=10) {
        cube(size);
      }
    `

    const { ast } = parse(source)
    const result = transpile(ast, { includeHeader: false })

    // Should use withScope since $fn is a parameter
    expect(result.code).toContain('j$.withScope($$sv, () => {')
  })
})
