import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { createExecutorClient, serveExecutor } from './executor-protocol.js'
import { createProvider } from './fake-provider.js'
import { loadFixtures, runJob } from './run-eval.js'
import { startExecutor } from './sandbox.js'

const KEY = 'sk-test-provider-key-canary'
const CHILD = { kind: 'child' }
const cubeHole = (await loadFixtures()).find((f) => f.name === 'cube-hole')

const job = (overrides = {}) => ({ fixture: cubeHole, run: 1, runs: 1, maxTurns: cubeHole.maxTurns, ...overrides })

const inChild = (model, { api = 'fluent', ...overrides } = {}, onLog = () => {}) =>
  runJob(job(overrides), { provider: createProvider({ kind: 'fake', model, apiKey: KEY }), api, startExecutor: () => startExecutor({ api, sandbox: CHILD }) }, onLog)

// An executor in this process behind the IPC protocol, recording every message the conversation sends it.
const recordedExecutor = (sent) => () => {
  const handlers = { client: [], server: [] }
  const deliver = (to, message) => queueMicrotask(() => handlers[to].forEach((fn) => fn(structuredClone(message))))
  serveExecutor({ send: (m) => deliver('client', m), onMessage: (fn) => handlers.server.push(fn) }, createEvalBackend)
  return createExecutorClient(
    {
      send: (m) => {
        sent.push(m)
        deliver('server', m)
      },
      onMessage: (fn) => handlers.client.push(fn),
    },
    { api: 'fluent' },
  )
}

describe('an executor child', () => {
  it('grades a project', async () => {
    const grader = startExecutor({ api: 'fluent', sandbox: CHILD })
    try {
      const source = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'
      const graded = await grader.gradeProject({ files: { 'main.js': source }, entry: 'main.js' })
      expect(graded.measure.volume).toBeCloseTo(8000, 0)
      expect(graded.solid.watertight).toBe(true)
      expect(await grader.gradeProject(null)).toEqual({ measure: null, solid: null, params: [] })
    } finally {
      grader.close()
    }
  }, 30_000)
})

describe('runJob', () => {
  it('never sends the executor the provider key', async () => {
    const sent = []
    const result = await runJob(job(), { provider: createProvider({ kind: 'fake', model: 'ok', apiKey: KEY }), api: 'fluent', startExecutor: recordedExecutor(sent) }, () => {})
    expect(result.error).toBeUndefined()
    expect(sent.map((m) => m.method ?? m.type)).toEqual(['init', 'reset', 'requestTool', 'requestTool', 'requestTool', 'init', 'gradeProject'])
    expect(JSON.stringify(sent)).not.toContain(KEY)
  })

  it('runs one conversation against an executor child and streams its log lines', async () => {
    const lines = []
    const result = await inChild('ok', { run: 2, runs: 3 }, (text) => lines.push(text))
    expect(result.fixture).toBe('cube-hole')
    expect(result.run).toBe(2)
    expect(result.error).toBeUndefined()
    expect(result.metrics.rounds).toBe(4)
    expect(result.metrics.toolCalls).toBe(3)
    expect(result.report.checkRate).toBeGreaterThan(0)
    expect(lines[0]).toMatch(/^== cube-hole run 2\/3/)
    expect(lines).toContain('assistant: building it')
    expect(lines.some((l) => l.startsWith('→ write'))).toBe(true)
    expect(lines.at(-1)).toBe('assistant: done')
  }, 30_000)

  it('caps the conversation at the maxTurns it is given', async () => {
    const result = await inChild('ok', { maxTurns: 1 })
    expect(result.maxTurns).toBe(1)
    expect(result.metrics.toolCalls).toBe(1)
  }, 30_000)

  it('keeps a provider error on the result', async () => {
    const result = await inChild('fail')
    expect(result.error).toBe('status 500')
    expect(result.providerError).toBe(true)
  }, 30_000)

  it('runs under the api it is given', async () => {
    const result = await inChild('ok', { api: 'modeling' })
    expect(result.api).toBe('modeling')
  }, 30_000)

  it('runs model code in the executor child under the permission model, with no way to the home dir, keys, writes, processes or imports', async () => {
    process.env.JSCAD_EVAL_CANARY = '1'
    let result
    try {
      result = await inChild('sandbox-probe')
    } finally {
      delete process.env.JSCAD_EVAL_CANARY
    }
    const probe = JSON.parse(result.transcript.find((m) => m.role === 'tool').content).error.message
    for (const denied of ['config', 'keys', 'write', 'spawn', 'worker']) expect(probe).toContain(`${denied}:ERR_ACCESS_DENIED`)
    expect(probe).toContain('import:failed to load module node:fs')
    expect(probe).not.toContain('JSCAD_EVAL_CANARY')
  }, 30_000)

  it('answers model code that takes the executor down with an EvaluatorCrashed tool error', async () => {
    const result = await inChild('exit')
    expect(JSON.parse(result.transcript.find((m) => m.role === 'tool').content).error.name).toBe('EvaluatorCrashed')
    expect(result.error).toBeUndefined()
  }, 30_000)
})
