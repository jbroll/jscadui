import { describe, expect, it } from 'vitest'
import { runTestFile, TEST_API } from '../src/testPackage.js'
describe('runTestFile', () => {
  it('counts asserts per part', async () => {
    const r = await runTestFile(`const {test, assertPart} = require('test'); test('a', () => assertPart(0, {volume: 1}))`, {})
    expect(r.assertsByPart['0']).toBe(1)
  })

  it('counts passing and failing tests', async () => {
    const r = await runTestFile(`const {test, assert} = require('test')
test('pass', () => assert(true))
test('fail', () => assert(false, 'nope'))`, { filename: 'test/counts.test.js' })
    expect(r.passed).toBe(1)
    expect(r.failed).toBe(1)
    expect(r.tests.map((t) => [t.name, t.ok])).toEqual([['pass', true], ['fail', false]])
    expect(r.tests[1].error).toMatchObject({ name: 'AssertionError', message: 'nope', file: 'test/counts.test.js', line: 3 })
    expect(r.errors).toEqual([])
  })

  it('attributes a failing assert to the assert line, not the package', async () => {
    const r = await runTestFile(`const {test, assert} = require('test')
test('a', () => {
  assert(true)
  assert(false, 'second fails')
})`, { filename: 'test/lines.test.js' })
    expect(r.tests[0].error).toMatchObject({ file: 'test/lines.test.js', line: 4 })
    expect(r.assertsByPart).toEqual({})
  })

  it('counts assertPart only on passing assert', async () => {
    const r = await runTestFile(`const {test, assertPart} = require('test')
test('ok', () => { assertPart(0, { volume: 1 }); assertPart(1, { dims: [2, 2, 2] }) })
test('bad index', () => assertPart(-1, { volume: 1 }))
test('bad checks', () => assertPart(0, null))`, {})
    expect(r.assertsByPart).toEqual({ 0: 1, 1: 1 })
    expect(r.passed).toBe(1)
    expect(r.failed).toBe(2)
  })

  it('reports a throw with file, line and column', async () => {
    const r = await runTestFile(`const {test} = require('test')
test('a', () => {
  throw new Error('boom')
})`, { filename: 'test/throw.test.js' })
    expect(r.failed).toBe(1)
    expect(r.tests[0].error).toMatchObject({ name: 'Error', message: 'boom', file: 'test/throw.test.js', line: 3 })
    expect(r.tests[0].error.column).toBeGreaterThan(0)
  })

  it('reports a top-level throw as a file error', async () => {
    const r = await runTestFile(`const {test} = require('test')
require('nope')`, { filename: 'test/missing.test.js' })
    expect(r.passed).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.errors[0]).toMatchObject({ name: 'ModuleNotFoundError', file: 'test/missing.test.js' })
  })

  it('reports a syntax error as a file error naming the file', async () => {
    const r = await runTestFile(`const {test} = require('test'
test('a', () => {})`, { filename: 'test/broken.test.js' })
    expect(r.failed).toBe(1)
    expect(r.errors[0]).toMatchObject({ name: 'SyntaxError', file: 'test/broken.test.js' })
  })

  it('resolves extra require specifiers from api', async () => {
    const r = await runTestFile(`const {test, assert} = require('test')
const part = require('./part.js')
test('a', () => assert(part.volume === 1))`, { filename: 'test/api.test.js', './part.js': { volume: 1 } })
    expect(r.passed).toBe(1)
    expect(r.failed).toBe(0)
  })

  it('resolves relative project paths from a files map', async () => {
    const r = await runTestFile(`const {test, assert} = require('test')
const helper = require('../lib/helper.js')
test('a', () => assert(helper.volume === 5))`, {
      filename: 'test/a.test.js',
      files: { 'lib/helper.js': `module.exports = { volume: 5 }`, 'test/a.test.js': '' },
    })
    expect(r.passed).toBe(1)
    expect(r.failed).toBe(0)
  })

  it('resolves absolute project paths from a files map', async () => {
    const r = await runTestFile(`const {test, assert} = require('test')
const helper = require('/lib/helper.js')
test('a', () => assert(helper.volume === 5))`, {
      filename: 'test/a.test.js',
      files: { 'lib/helper.js': `module.exports = { volume: 5 }` },
    })
    expect(r.passed).toBe(1)
    expect(r.failed).toBe(0)
  })

  it('rejects project requires that escape the project', async () => {
    const r = await runTestFile(`const {test} = require('test')
require('../../outside.js')
test('a', () => {})`, { filename: 'test/a.test.js', files: {} })
    expect(r.failed).toBe(1)
  })

  it('runs async test functions', async () => {
    const r = await runTestFile(`const {test, assert} = require('test')
test('a', async () => { await Promise.resolve(); assert(true) })`, { filename: 'test/async-ok.test.js' })
    expect(r.passed).toBe(1)
    expect(r.failed).toBe(0)
  })

  it('captures a failing assert inside an async test', async () => {
    const r = await runTestFile(`const {test, assert} = require('test')
test('a', async () => { await Promise.resolve(); assert(false, 'async nope') })`, { filename: 'test/async-fail.test.js' })
    expect(r.passed).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.tests[0].error).toMatchObject({ name: 'AssertionError', message: 'async nope' })
  })

  it('answers a file with no tests with zeros', async () => {
    const r = await runTestFile(`const {test} = require('test')`, {})
    expect(r).toMatchObject({ passed: 0, failed: 0, assertsByPart: {}, tests: [], errors: [] })
  })

  it('names the default file when api carries none', async () => {
    const r = await runTestFile(`throw new Error('top')`, {})
    expect(r.errors[0]).toMatchObject({ file: 'test.js' })
  })
})

describe('TEST_API', () => {
  it('serves test, assert and assertPart via require', async () => {
    expect(Object.keys(TEST_API).sort()).toEqual(['assert', 'assertPart', 'test'])
    const r = await runTestFile(`const api = require('test')
if (typeof api.test !== 'function' || typeof api.assert !== 'function' || typeof api.assertPart !== 'function') throw new Error('shape')`, {})
    expect(r.failed).toBe(0)
  })

  it('refuses use outside runTestFile', () => {
    expect(() => TEST_API.assert(true)).toThrow('runTestFile')
  })
})
