import { describe, expect, it } from 'vitest'
import { runTestFile, TEST_API } from '../src/testPackage.js'
describe('runTestFile', () => {
  it('counts asserts per part', async () => {
    const r = await runTestFile(`const {test, assertPart} = require('test'); test('a', () => assertPart(0, {volume: 1}))`, {})
    expect(r.assertsByPart['0']).toBe(1)
  })

  it('counts passing and failing tests', () => {
    const r = runTestFile(`const {test, assert} = require('test')
test('pass', () => assert(true))
test('fail', () => assert(false, 'nope'))`, { filename: 'test/counts.test.js' })
    expect(r.passed).toBe(1)
    expect(r.failed).toBe(1)
    expect(r.tests.map((t) => [t.name, t.ok])).toEqual([['pass', true], ['fail', false]])
    expect(r.tests[1].error).toMatchObject({ name: 'AssertionError', message: 'nope', file: 'test/counts.test.js', line: 3 })
    expect(r.errors).toEqual([])
  })

  it('attributes a failing assert to the assert line, not the package', () => {
    const r = runTestFile(`const {test, assert} = require('test')
test('a', () => {
  assert(true)
  assert(false, 'second fails')
})`, { filename: 'test/lines.test.js' })
    expect(r.tests[0].error).toMatchObject({ file: 'test/lines.test.js', line: 4 })
    expect(r.assertsByPart).toEqual({})
  })

  it('counts assertPart only on passing assert', () => {
    const r = runTestFile(`const {test, assertPart} = require('test')
test('ok', () => { assertPart(0, { volume: 1 }); assertPart(1, { dims: [2, 2, 2] }) })
test('bad index', () => assertPart(-1, { volume: 1 }))
test('bad checks', () => assertPart(0, null))`, {})
    expect(r.assertsByPart).toEqual({ 0: 1, 1: 1 })
    expect(r.passed).toBe(1)
    expect(r.failed).toBe(2)
  })

  it('reports a throw with file, line and column', () => {
    const r = runTestFile(`const {test} = require('test')
test('a', () => {
  throw new Error('boom')
})`, { filename: 'test/throw.test.js' })
    expect(r.failed).toBe(1)
    expect(r.tests[0].error).toMatchObject({ name: 'Error', message: 'boom', file: 'test/throw.test.js', line: 3 })
    expect(r.tests[0].error.column).toBeGreaterThan(0)
  })

  it('reports a top-level throw as a file error', () => {
    const r = runTestFile(`const {test} = require('test')
require('nope')`, { filename: 'test/missing.test.js' })
    expect(r.passed).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.errors[0]).toMatchObject({ name: 'ModuleNotFoundError', file: 'test/missing.test.js' })
  })

  it('reports a syntax error as a file error naming the file', () => {
    const r = runTestFile(`const {test} = require('test'
test('a', () => {})`, { filename: 'test/broken.test.js' })
    expect(r.failed).toBe(1)
    expect(r.errors[0]).toMatchObject({ name: 'SyntaxError', file: 'test/broken.test.js' })
  })

  it('resolves extra require specifiers from api', () => {
    const r = runTestFile(`const {test, assert} = require('test')
const part = require('./part.js')
test('a', () => assert(part.volume === 1))`, { filename: 'test/api.test.js', './part.js': { volume: 1 } })
    expect(r.passed).toBe(1)
    expect(r.failed).toBe(0)
  })

  it('fails async test functions instead of missing their asserts', () => {
    const r = runTestFile(`const {test} = require('test')
test('a', async () => {})`, { filename: 'test/async.test.js' })
    expect(r.passed).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.tests[0].error.name).toBe('AsyncTestError')
  })

  it('answers a file with no tests with zeros', () => {
    const r = runTestFile(`const {test} = require('test')`, {})
    expect(r).toMatchObject({ passed: 0, failed: 0, assertsByPart: {}, tests: [], errors: [] })
  })

  it('names the default file when api carries none', () => {
    const r = runTestFile(`throw new Error('top')`, {})
    expect(r.errors[0]).toMatchObject({ file: 'test.js' })
  })
})

describe('TEST_API', () => {
  it('serves test, assert and assertPart via require', () => {
    expect(Object.keys(TEST_API).sort()).toEqual(['assert', 'assertPart', 'test'])
    const r = runTestFile(`const api = require('test')
if (typeof api.test !== 'function' || typeof api.assert !== 'function' || typeof api.assertPart !== 'function') throw new Error('shape')`, {})
    expect(r.failed).toBe(0)
  })

  it('refuses use outside runTestFile', () => {
    expect(() => TEST_API.assert(true)).toThrow('runTestFile')
  })
})
