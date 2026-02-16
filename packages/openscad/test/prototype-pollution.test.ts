/**
 * Test for prototype pollution protection
 */
import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import { WarningCode } from '../src/transpiler/context.js'

describe('prototype pollution protection', () => {
  it.skip('should warn when __proto__ is used as parameter name', () => {
    const source = `
      module test(__proto__ = 1) {
        cube(__proto__);
      }
      test();
    `

    const { ast } = parse(source)
    const result = transpile(ast, {
      includeHeader: false
    })

    // Should have a warning about dangerous parameter name
    const protoWarnings = result.warnings.filter(
      w => w.code === WarningCode.DANGEROUS_PARAMETER_NAME
    )

    expect(protoWarnings.length).toBeGreaterThan(0)
    expect(protoWarnings[0].message).toContain('__proto__')
    expect(protoWarnings[0].message).toContain('prototype pollution')
  })

  it.skip('should warn when constructor is used as parameter name', () => {
    const source = `
      module test(constructor = 1) {
        cube(constructor);
      }
      test();
    `

    const { ast } = parse(source)
    const result = transpile(ast, {
      includeHeader: false
    })

    const constructorWarnings = result.warnings.filter(
      w => w.code === WarningCode.DANGEROUS_PARAMETER_NAME
    )

    expect(constructorWarnings.length).toBeGreaterThan(0)
    expect(constructorWarnings[0].message).toContain('constructor')
  })

  it('should warn when prototype is used as parameter name', () => {
    const source = `
      module test(prototype = 1) {
        cube(prototype);
      }
      test();
    `

    const { ast } = parse(source)
    const result = transpile(ast, {
      includeHeader: false
    })

    const prototypeWarnings = result.warnings.filter(
      w => w.code === WarningCode.DANGEROUS_PARAMETER_NAME
    )

    expect(prototypeWarnings.length).toBeGreaterThan(0)
    expect(prototypeWarnings[0].message).toContain('prototype')
  })

  it('should not warn for safe parameter names', () => {
    const source = `
      module test(size = 10, center = true) {
        cube(size, center);
      }
      test();
    `

    const { ast } = parse(source)
    const result = transpile(ast, {
      includeHeader: false
    })

    const dangerousWarnings = result.warnings.filter(
      w => w.code === WarningCode.DANGEROUS_PARAMETER_NAME
    )

    expect(dangerousWarnings.length).toBe(0)
  })
})
