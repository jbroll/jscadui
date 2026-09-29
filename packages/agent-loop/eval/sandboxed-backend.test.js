import { describe, expect, it } from 'vitest'
import { createExecutorClient } from './executor-protocol.js'
import { summarize } from './report.js'
import { regradeResults, freshExecutorGrader, runJob } from './run-eval.js'
import { createSandboxedBackend } from './sandboxed-backend.js'
import { startExecutor } from './sandbox.js'

const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'
const EXITS = 'module.exports = { main: () => process.exit(3) }'
const THROWS = 'module.exports = { main: () => { throw new Error("bad model") } }'
const SPINS = 'module.exports = { main: () => { for (;;); } }'
const forge = (value) =>
  `module.exports = { main: () => { for (let id = 0; id < 64; id++) process.send(${value}); return new Promise(() => {}) } }`

const fixture = {
  name: 'box',
  prompt: 'make a 20mm cube',
  requires: ['eval'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m) => [{ name: 'volume', pass: (m?.volume ?? 0) > 7000 }],
}

let nextId = 0
const tool = (name, input) => [{ type: 'tool_use', id: `t${nextId++}`, name, input }, { type: 'done', stopReason: 'tool_use' }]
const done = () => [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }]
const scripted = (rounds) => ({
  async *send() {
    for (const event of rounds.shift() ?? []) yield event
  },
})

const startChild = () => startExecutor({ api: 'fluent', sandbox: { kind: 'child' } })

const run = (rounds, options = {}, f = fixture) =>
  runJob({ fixture: f, run: 1, runs: 1, maxTurns: f.maxTurns }, { provider: scripted(rounds), api: 'fluent', startExecutor: startChild, ...options }, () => {})

const toolResults = (result) => result.transcript.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content))

// An executor that exits before it is ready, as crt does when it cannot start the container.
const neverReady = () => {
  let exit
  const executor = createExecutorClient({ send: () => {}, onMessage: () => {}, onExit: (fn) => (exit = fn), kill: () => {} }, { api: 'fluent' })
  exit("code 1: Error: Chroot 'jscad-eval' not found")
  return executor
}

describe('replies model code forges from inside the executor', () => {
  it('cannot mark the run as a provider error', async () => {
    const result = await run([tool('eval', { source: forge("{ type: 'reply', id, ok: false, error: 'empty provider reply' }") }), done()])
    expect(result.providerError).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(toolResults(result)[0]).toEqual({ ok: false, error: { name: 'EvaluatorError', message: 'empty provider reply' } })
  }, 30_000)

  it('become a tool error when not a string, and the result serializes on the capped last round', async () => {
    const result = await run([tool('eval', { source: forge("{ type: 'reply', id, ok: true, value: { x: 1n } }") })], {}, { ...fixture, maxTurns: 1 })
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(result.providerError).toBeUndefined()
    expect(toolResults(result)[0].error.name).toBe('EvaluatorError')
  }, 30_000)

  it('cap a huge error and a huge result', async () => {
    const hugeError = await run([tool('eval', { source: forge("{ type: 'reply', id, ok: false, error: 'x'.repeat(1e7) }") }), done()])
    expect(hugeError.transcript.find((m) => m.role === 'tool').content.length).toBeLessThan(5000)
    const hugeResult = await run([tool('eval', { source: forge("{ type: 'reply', id, ok: true, value: 'x'.repeat(1e7) }") }), done()])
    expect(toolResults(hugeResult)[0].error.name).toBe('ToolResultTooLarge')
  }, 30_000)

  it('a model error of any size comes back capped', async () => {
    const result = await run([tool('eval', { source: 'module.exports = { main: () => { throw new Error("x".repeat(1e7)) } }' }), done()])
    expect(toolResults(result)[0].error.message.length).toBeLessThan(5000)
  }, 30_000)
})

describe('an executor that model code ends', () => {
  it('is replaced by a fresh one holding the project, and the model goes on to a graded answer', async () => {
    const result = await run([tool('writeModel', { source: EXITS }), tool('writeModel', { source: CUBE }), tool('measure', {}), done()])
    const [crashed, written, measured] = toolResults(result)
    expect(crashed.error.name).toBe('EvaluatorCrashed')
    expect(crashed.error.message).toMatch(/model code ended the evaluator \(code 3/)
    expect(written.ok).toBe(true)
    expect(measured.volume).toBeCloseTo(8000, 0)
    expect(result.report.checkRate).toBe(1)
    expect(result.error).toBeUndefined()
    expect(result.providerError).toBeUndefined()
    expect(result.infraError).toBeUndefined()
  }, 30_000)

  it('keeps the transcript and counts the crash as a failed call', async () => {
    const result = await run([tool('eval', { source: THROWS }), tool('eval', { source: THROWS }), tool('eval', { source: EXITS }), done()])
    expect(result.transcript.filter((m) => m.role === 'tool')).toHaveLength(3)
    expect(result.report.firstAttemptFailures).toBe(3)
    expect(result.metrics.failedCalls).toBe(3)
  }, 30_000)

  it('is restarted at most maxRestarts times, then every call fails and the run records why', async () => {
    const result = await run([tool('eval', { source: EXITS }), tool('eval', { source: EXITS }), tool('eval', { source: CUBE }), done()], { maxRestarts: 1 })
    const results = toolResults(result)
    expect(results.map((r) => r.error?.name)).toEqual(['EvaluatorCrashed', 'EvaluatorCrashed', 'EvaluatorCrashed'])
    expect(results[2].error.message).toMatch(/not restarted again/)
    expect(result.error).toBe('model code ended the evaluator 2 times')
    expect(result.infraError).toBeUndefined()
  }, 30_000)

  it('by running past the call time limit is killed and replaced', async () => {
    const result = await run([tool('eval', { source: SPINS }), tool('eval', { source: CUBE }), done()], { callTimeoutMs: 500 })
    const [spun, evaluated] = toolResults(result)
    expect(spun.error.message).toMatch(/ran past 0.5 s/)
    expect(evaluated.ok).toBe(true)
  }, 30_000)

  it('while grading grades nothing, and the run still scores', async () => {
    const PRIMES = 'globalThis.loads = 1\n' + CUBE
    const FIRST_LOAD_EXITS = 'globalThis.loads = (globalThis.loads ?? 0) + 1\nif (globalThis.loads === 1) process.exit(3)\n' + CUBE
    const result = await run([tool('eval', { source: PRIMES }), tool('writeModel', { source: FIRST_LOAD_EXITS }), done()])
    expect(toolResults(result).map((r) => r.ok)).toEqual([true, true])
    expect(result.report.checkRate).toBe(0)
    expect(result.transcript.filter((m) => m.role === 'tool')).toHaveLength(2)
    expect(result.providerError).toBeUndefined()
    expect(result.infraError).toBeUndefined()
    expect(summarize([result])[0].total).toBe(result.report.total)
  }, 30_000)
})

describe('an evaluator that never starts', () => {
  it('is an infrastructure error, left out of the means', async () => {
    const result = await run([tool('eval', { source: CUBE }), done()], { startExecutor: neverReady })
    expect(result.infraError).toBe(true)
    expect(result.error).toMatch(/the evaluator did not start: executor exited: code 1: Error: Chroot 'jscad-eval' not found/)
    expect(result.metrics.rounds).toBe(0)
    expect(summarize([result])[0].total).toBeNull()
  })

  it('on a restart after a crash is an infrastructure error too', async () => {
    let started = 0
    const start = () => (started++ === 0 ? startChild() : neverReady())
    const result = await run([tool('eval', { source: EXITS }), done()], { startExecutor: start })
    expect(result.infraError).toBe(true)
    expect(result.error).toMatch(/the evaluator did not start/)
  }, 30_000)

  it('for the grade is an infrastructure error', async () => {
    let started = 0
    const start = () => (started++ === 0 ? startChild() : neverReady())
    const result = await run([tool('writeModel', { source: CUBE }), done()], { startExecutor: start })
    expect(result.infraError).toBe(true)
    expect(result.transcript.filter((m) => m.role === 'tool')).toHaveLength(1)
  }, 30_000)
})

describe('the run time limit', () => {
  it('ends the conversation and still grades what was saved', async () => {
    const slow = {
      calls: 0,
      async *send() {
        if (this.calls++ === 0) {
          yield* tool('writeModel', { source: CUBE })
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
        yield* done()
      },
    }
    const result = await runJob({ fixture, run: 1, runs: 1, maxTurns: 8 }, { provider: slow, api: 'fluent', startExecutor: startChild, runTimeoutMs: 800 }, () => {})
    expect(result.error).toBe('run time limit of 0.8 s reached')
    expect(result.report.checkRate).toBe(1)
  }, 30_000)
})

describe('--regrade with a stored model that ends the executor', () => {
  it('grades that run as a failure and the rest as usual', async () => {
    const stored = (source) => ({
      fixture: 'box',
      run: 1,
      maxTurns: 8,
      report: { dimensions: { discipline: 2, recovery: 2, geometry: 2, conservation: 2 }, total: 8, firstAttemptFailures: 0, checkRate: 1 },
      metrics: {},
      transcript: [
        { role: 'user', content: fixture.prompt },
        { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'writeModel', input: { source } }] },
        { role: 'tool', toolCallId: 't1', content: '{"ok":true}' },
        { role: 'assistant', content: 'done', toolCalls: [] },
      ],
    })
    const file = { api: 'fluent', results: [stored(EXITS), stored(CUBE)] }
    const out = await regradeResults(file, new Map([['box', fixture]]), { grader: freshExecutorGrader(startChild) })
    expect(out.results.map((r) => r.report.checkRate)).toEqual([0, 1])
    expect(out.results[0].providerError).toBeUndefined()
  }, 30_000)
})

describe('createSandboxedBackend', () => {
  it('reseeds a restarted executor with the fixture files and every file written so far', async () => {
    const seeds = []
    const start = () => {
      const executor = startChild()
      const reset = executor.reset
      executor.reset = (files) => {
        seeds.push(files)
        return reset(files)
      }
      return executor
    }
    const backend = createSandboxedBackend({ start })
    try {
      await backend.reset({ 'lib.js': 'module.exports = 1' })
      await backend.requestTool('writeModel', { source: EXITS })
      expect(seeds).toEqual([{ 'lib.js': 'module.exports = 1' }, { 'lib.js': 'module.exports = 1', 'main.js': EXITS }])
    } finally {
      backend.close()
    }
  }, 30_000)
})
