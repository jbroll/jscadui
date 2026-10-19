import { describe, expect, it, vi } from 'vitest'
import { runProjectTests, TEST_WORKER_TIMEOUT_MS } from '../src/testWorker.js'
import { jscadRunTests } from '../src_frame/bundle.test-worker.js'

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

  it('returns an answering worker result over the slot protocol', async () => {
    let worker
    const createWorker = () => (worker = {
      postMessage: (message) => worker.onmessage({
        data: {
          method: '__RESPONSE__',
          id: message.id,
          params: { ok: true, passed: 2, failed: 0, failures: [], assertsByPart: {} },
        },
      }),
      terminate: vi.fn(),
    })
    const r = await runProjectTests({ 'test/a.js': `test('x',()=>{})` }, 'fluent', { createWorker, timeoutMs: 1000 })
    expect(r).toMatchObject({ ok: true, passed: 2 })
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('exposes the api style to test files as require(api)', async () => {
    const r = await runProjectTests({
      'test/a.js': `const t = require('test')\nconst api = require('api')\nt.test('x', () => { t.assert(api === 'fluent', 'wrong api') })`,
    }, 'fluent')
    expect(r.ok).toBe(true)
    expect(r.passed).toBe(1)
  })

  it('the worker entry answers test runs without geometry', async () => {
    const r = await jscadRunTests({
      files: {
        'main.js': `throw new Error('geometry must not run')`,
        'test/a.js': `test('x',()=>{})`,
      },
      api: 'fluent',
    })
    expect(r.ok).toBe(true)
    expect(r.passed).toBe(1)
    expect(r.files).toEqual(['test/a.js'])
  })

  it('exposes the 15 s kill budget', () => {
    expect(TEST_WORKER_TIMEOUT_MS).toBe(15000)
  })
})
