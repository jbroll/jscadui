import { describe, expect, it, vi } from 'vitest'
import { runProjectTests, TEST_WORKER_TIMEOUT_MS } from '../src/testWorker.js'

describe('runProjectTests', () => {
  it('runs test/ only and times out hangs', async () => {
    const r = await runProjectTests({ 'test/a.js': `test('x',()=>{})`, 'notes/n.md': 'hi' }, 'fluent')
    expect(r.ok).toBe(true)
  })

  it('ignores notes/ and non-test files', async () => {
    const r = await runProjectTests({
      'main.js': `throw new Error('geometry must not run')`,
      'notes/n.md': 'hi',
      'test/a.js': `const t = require('test')\nt.test('x', () => { t.assert(true) })`,
    }, 'fluent')
    expect(r.ok).toBe(true)
    expect(r.passed).toBe(1)
    expect(r.failed).toBe(0)
  })

  it('reports failures with file and line', async () => {
    const r = await runProjectTests({
      'test/a.js': `const t = require('test')\nt('x', () => { t.assert(false, 'boom') })`,
    }, 'fluent')
    expect(r.ok).toBe(false)
    expect(r.failed).toBe(1)
    expect(r.failures[0].file).toBe('test/a.js')
    expect(r.failures[0].error.line).toBe(2)
  })

  it('times out a hanging worker within budget', async () => {
    const createWorker = () => ({ postMessage: vi.fn(), terminate: vi.fn() })
    const r = await runProjectTests({ 'test/a.js': `test('x',()=>{})` }, 'fluent', { createWorker, timeoutMs: 20 })
    expect(r.ok).toBe(false)
    expect(r.error?.name).toBe('TimeoutError')
  })

  it('exposes the 15 s kill budget', () => {
    expect(TEST_WORKER_TIMEOUT_MS).toBe(15000)
  })
})
