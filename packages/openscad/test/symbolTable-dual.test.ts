import { describe, it, expect } from 'vitest'
import { SymbolTable } from '../src/transpiler/symbolTable.js'

/**
 * Tests for dual-defined symbol handling in SymbolTable
 *
 * Dual-defined symbols occur when a name is used for both a module and a function,
 * which is common in BOSL2 where many modules have corresponding function versions.
 */
describe('SymbolTable - Dual-Defined Symbols', () => {
  it('creates dual-defined entry when module then function added', () => {
    const table = new SymbolTable()

    table.define('cube', { kind: 'module', source: 'local', params: ['size'] })
    table.define('cube', { kind: 'function', source: 'local', params: ['size'] })

    expect(table.isDualDefined('cube')).toBe(true)
    expect(table.isDefined('cube')).toBe(true)
  })

  it('creates dual-defined entry when function then module added', () => {
    const table = new SymbolTable()

    table.define('sphere', { kind: 'function', source: 'local', params: ['r'] })
    table.define('sphere', { kind: 'module', source: 'local', params: ['r'] })

    expect(table.isDualDefined('sphere')).toBe(true)
    expect(table.isDefined('sphere')).toBe(true)
  })

  it('lookup returns module version by default for dual-defined', () => {
    const table = new SymbolTable()

    table.define('cylinder', { kind: 'module', source: 'local', params: ['h', 'r'] })
    table.define('cylinder', { kind: 'function', source: 'local', params: ['h', 'r'] })

    const info = table.lookup('cylinder')
    expect(info?.kind).toBe('module')
  })

  it('lookup returns function version when preferKind=function', () => {
    const table = new SymbolTable()

    table.define('cube', { kind: 'module', source: 'local', params: ['size'] })
    table.define('cube', { kind: 'function', source: 'local', params: ['size'] })

    const info = table.lookup('cube', 'function')
    expect(info?.kind).toBe('function')
  })

  it('lookup returns module version when preferKind=module', () => {
    const table = new SymbolTable()

    table.define('sphere', { kind: 'function', source: 'local', params: ['r'] })
    table.define('sphere', { kind: 'module', source: 'local', params: ['r'] })

    const info = table.lookup('sphere', 'module')
    expect(info?.kind).toBe('module')
  })

  it('getParams returns module params by default for dual-defined', () => {
    const table = new SymbolTable()

    table.define('cube', { kind: 'module', source: 'local', params: ['size', 'center'] })
    table.define('cube', { kind: 'function', source: 'local', params: ['size'] })

    const params = table.getParams('cube')
    expect(params).toEqual(['size', 'center'])
  })

  it('getParams returns function params when preferKind=function', () => {
    const table = new SymbolTable()

    table.define('sphere', { kind: 'module', source: 'local', params: ['r', 'center'] })
    table.define('sphere', { kind: 'function', source: 'local', params: ['r'] })

    const params = table.getParams('sphere', 'function')
    expect(params).toEqual(['r'])
  })

  it('setParams updates module version by default', () => {
    const table = new SymbolTable()

    table.define('cylinder', { kind: 'module', source: 'local' })
    table.define('cylinder', { kind: 'function', source: 'local' })

    table.setParams('cylinder', ['h', 'r', 'd'])

    const params = table.getParams('cylinder', 'module')
    expect(params).toEqual(['h', 'r', 'd'])
  })

  it('setParams updates function version when kind=function', () => {
    const table = new SymbolTable()

    table.define('square', { kind: 'module', source: 'local' })
    table.define('square', { kind: 'function', source: 'local' })

    table.setParams('square', ['size', 'center'], 'function')

    const params = table.getParams('square', 'function')
    expect(params).toEqual(['size', 'center'])
  })

  it('isKind returns true for both kinds in dual-defined', () => {
    const table = new SymbolTable()

    table.define('union', { kind: 'module', source: 'local' })
    table.define('union', { kind: 'function', source: 'local' })

    expect(table.isKind('union', 'module')).toBe(true)
    expect(table.isKind('union', 'function')).toBe(true)
    expect(table.isKind('union', 'variable')).toBe(false)
  })

  it('getByKind includes dual-defined names in both results', () => {
    const table = new SymbolTable()

    table.define('cube', { kind: 'module', source: 'local' })
    table.define('cube', { kind: 'function', source: 'local' })
    table.define('sphere', { kind: 'module', source: 'local' })
    table.define('len', { kind: 'function', source: 'local' })

    const modules = table.getByKind('module')
    const functions = table.getByKind('function')

    expect(modules).toContain('cube')
    expect(modules).toContain('sphere')
    expect(functions).toContain('cube')
    expect(functions).toContain('len')
  })

  it('getDualDefined returns all dual-defined names', () => {
    const table = new SymbolTable()

    table.define('cube', { kind: 'module', source: 'local' })
    table.define('cube', { kind: 'function', source: 'local' })
    table.define('sphere', { kind: 'function', source: 'local' })
    table.define('sphere', { kind: 'module', source: 'local' })
    table.define('cylinder', { kind: 'module', source: 'local' })

    const dualDefined = table.getDualDefined()

    expect(dualDefined).toHaveLength(2)
    expect(dualDefined).toContain('cube')
    expect(dualDefined).toContain('sphere')
    expect(dualDefined).not.toContain('cylinder')
  })

  it('clone preserves dual-defined symbols', () => {
    const table = new SymbolTable()

    table.define('union', { kind: 'module', source: 'local', params: ['children'] })
    table.define('union', { kind: 'function', source: 'local', params: ['a', 'b'] })

    const copy = table.clone()

    expect(copy.isDualDefined('union')).toBe(true)
    expect(copy.getParams('union', 'module')).toEqual(['children'])
    expect(copy.getParams('union', 'function')).toEqual(['a', 'b'])
  })

  it('merge handles dual-defined symbols from other table', () => {
    const table1 = new SymbolTable()
    const table2 = new SymbolTable()

    table2.define('difference', { kind: 'module', source: 'imported', params: ['children'] })
    table2.define('difference', { kind: 'function', source: 'imported', params: ['a', 'b'] })

    table1.merge(table2)

    expect(table1.isDualDefined('difference')).toBe(true)
    expect(table1.getParams('difference', 'module')).toEqual(['children'])
    expect(table1.getParams('difference', 'function')).toEqual(['a', 'b'])
  })

  it('updating existing dual-defined symbol updates correct version', () => {
    const table = new SymbolTable()

    table.define('cube', { kind: 'module', source: 'local', params: ['size'] })
    table.define('cube', { kind: 'function', source: 'local', params: ['size'] })

    // Update module version
    table.define('cube', { kind: 'module', source: 'local', params: ['size', 'center'] })

    expect(table.getParams('cube', 'module')).toEqual(['size', 'center'])
    expect(table.getParams('cube', 'function')).toEqual(['size'])
    expect(table.isDualDefined('cube')).toBe(true)
  })

  it('variable kind replaces dual-defined symbol entirely', () => {
    const table = new SymbolTable()

    table.define('x', { kind: 'module', source: 'local' })
    table.define('x', { kind: 'function', source: 'local' })
    expect(table.isDualDefined('x')).toBe(true)

    // Variable definition replaces dual-defined
    table.define('x', { kind: 'variable', source: 'local' })

    expect(table.isDualDefined('x')).toBe(false)
    expect(table.isKind('x', 'variable')).toBe(true)
  })

  it('handles different sources for module vs function versions', () => {
    const table = new SymbolTable()

    table.define('translate', { kind: 'module', source: 'local', params: ['v'] })
    table.define('translate', { kind: 'function', source: 'imported', params: ['v', 'p'] })

    const moduleInfo = table.lookup('translate', 'module')
    const functionInfo = table.lookup('translate', 'function')

    expect(moduleInfo?.source).toBe('local')
    expect(functionInfo?.source).toBe('imported')
  })
})
