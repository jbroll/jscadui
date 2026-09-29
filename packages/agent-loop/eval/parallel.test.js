import { describe, expect, it } from 'vitest'
import { concurrencyFrom, runPool, runSuiteParallel } from './parallel.js'
import { createSandboxedGrader, runInChild } from './sandbox.js'

const FAKE_PROVIDER = new URL('./fake-provider.js', import.meta.url).href

const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const fixture = (name) => ({ name, prompt: `make ${name}`, requires: ['eval'], verifyBeforeWrite: false, maxTurns: 4, checks: () => [] })

const fakeResult = ({ fixture: f, run }) => ({
  fixture: f.name,
  run,
  report: { dimensions: { discipline: 2, recovery: 2, geometry: 2, conservation: 2 }, total: 8, firstAttemptFailures: 0, checkRate: 1 },
  metrics: {},
})

describe('concurrencyFrom', () => {
  it('defaults to 6', () => {
    expect(concurrencyFrom({})).toBe(6)
  })

  it('reads EVAL_CONCURRENCY', () => {
    expect(concurrencyFrom({ EVAL_CONCURRENCY: '2' })).toBe(2)
  })

  it('falls back to the default on a value that is not a positive integer', () => {
    expect(concurrencyFrom({ EVAL_CONCURRENCY: '0' })).toBe(6)
    expect(concurrencyFrom({ EVAL_CONCURRENCY: 'x' })).toBe(6)
  })
})

describe('runPool', () => {
  it('never runs more than `concurrency` items at once and returns results in item order', async () => {
    let active = 0
    let peak = 0
    const gates = Array.from({ length: 5 }, deferred)
    const pool = runPool([0, 1, 2, 3, 4], 2, async (item) => {
      active += 1
      peak = Math.max(peak, active)
      await gates[item].promise
      active -= 1
      return `r${item}`
    })
    for (const i of [1, 0, 3, 2, 4]) {
      gates[i].resolve()
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(await pool).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
    expect(peak).toBe(2)
  })

  it('handles fewer items than lanes', async () => {
    expect(await runPool(['a'], 6, async (x) => x.toUpperCase())).toEqual(['A'])
  })
})

describe('runSuiteParallel', () => {
  it('schedules fixture x run jobs and orders results by fixture then run regardless of completion', async () => {
    const delays = { 'a#1': 30, 'a#2': 5, 'b#1': 15, 'b#2': 0 }
    const completedOrders = []
    const results = await runSuiteParallel([fixture('a'), fixture('b')], {
      runs: 2,
      concurrency: 4,
      runJob: async (job) => {
        await new Promise((r) => setTimeout(r, delays[`${job.fixture.name}#${job.run}`]))
        return fakeResult(job)
      },
      onRun: (_result, completed) => completedOrders.push(completed.map((r) => `${r.fixture}#${r.run}`)),
    })
    expect(results.map((r) => `${r.fixture}#${r.run}`)).toEqual(['a#1', 'a#2', 'b#1', 'b#2'])
    expect(completedOrders[0]).toEqual(['b#2'])
    expect(completedOrders[1]).toEqual(['a#2', 'b#2'])
    expect(completedOrders.at(-1)).toEqual(['a#1', 'a#2', 'b#1', 'b#2'])
  })

  it('records a crashed job as that run with an error and keeps the suite going', async () => {
    const results = await runSuiteParallel([fixture('a')], {
      runs: 3,
      concurrency: 2,
      runJob: async (job) => {
        if (job.run === 2) throw new Error('worker exited with code 3')
        return fakeResult(job)
      },
    })
    expect(results.map((r) => r.run)).toEqual([1, 2, 3])
    expect(results[1].fixture).toBe('a')
    expect(results[1].error).toMatch(/worker exited with code 3/)
    expect(results[1].report.total).toBeTypeOf('number')
    expect(results[1].transcript).toEqual([])
    expect(results[0].error).toBeUndefined()
  })

  it('gives every job the model turn cap, or its fixture cap when there is none', async () => {
    const seen = []
    const runJob = async (job) => {
      seen.push(job.maxTurns)
      return fakeResult(job)
    }
    await runSuiteParallel([fixture('a')], { runs: 1, concurrency: 1, runJob, maxTurns: 8 })
    await runSuiteParallel([fixture('a')], { runs: 1, concurrency: 1, runJob, maxTurns: null })
    expect(seen).toEqual([8, 4])
  })

  it('records the turn cap on a crashed run', async () => {
    const [result] = await runSuiteParallel([fixture('a')], {
      runs: 1,
      concurrency: 1,
      maxTurns: 8,
      runJob: async () => {
        throw new Error('boom')
      },
    })
    expect(result.maxTurns).toBe(8)
  })

  it('routes each job log line with its job', async () => {
    const lines = []
    await runSuiteParallel([fixture('a')], {
      runs: 2,
      concurrency: 2,
      runJob: async (job, onLog) => {
        onLog(`hello ${job.run}`)
        return fakeResult(job)
      },
      onLog: (job, text) => lines.push(`${job.fixture.name}#${job.run} ${text}`),
    })
    expect(lines.sort()).toEqual(['a#1 hello 1', 'a#2 hello 2'])
  })
})

describe('runInChild', () => {
  it('runs one conversation in a sandboxed child process and streams its log lines', async () => {
    const lines = []
    const result = await runInChild(
      { fixtureName: 'cube-hole', run: 2, runs: 3, provider: { kind: 'fake', model: 'ok' }, providerModule: FAKE_PROVIDER },
      (text) => lines.push(text),
    )
    expect(result.fixture).toBe('cube-hole')
    expect(result.run).toBe(2)
    expect(result.error).toBeUndefined()
    expect(result.metrics.rounds).toBe(4)
    expect(result.metrics.toolCalls).toBe(3)
    expect(result.report.checkRate).toBeGreaterThan(0)
    expect(lines[0]).toMatch(/^== cube-hole run 2\/3/)
    expect(lines).toContain('assistant: building it')
    expect(lines.some((l) => l.startsWith('→ eval'))).toBe(true)
    expect(lines.at(-1)).toBe('assistant: done')
  }, 30_000)

  it('caps the conversation at the maxTurns it is given', async () => {
    const result = await runInChild(
      { fixtureName: 'cube-hole', run: 1, runs: 1, maxTurns: 1, provider: { kind: 'fake', model: 'ok' }, providerModule: FAKE_PROVIDER },
      () => {},
    )
    expect(result.maxTurns).toBe(1)
    expect(result.metrics.toolCalls).toBe(1)
  }, 30_000)

  it('keeps a provider error on the result', async () => {
    const result = await runInChild(
      { fixtureName: 'cube-hole', run: 1, runs: 1, provider: { kind: 'fake', model: 'fail' }, providerModule: FAKE_PROVIDER },
      () => {},
    )
    expect(result.error).toBe('status 500')
    expect(result.providerError).toBe(true)
  }, 30_000)

  it('runs model code under the permission model, with no way to the home dir, keys, writes, processes or imports', async () => {
    process.env.JSCAD_EVAL_CANARY = '1'
    let result
    try {
      result = await runInChild(
        { fixtureName: 'cube-hole', run: 1, runs: 1, provider: { kind: 'fake', model: 'sandbox-probe', apiKey: 'test-only' }, providerModule: FAKE_PROVIDER },
        () => {},
      )
    } finally {
      delete process.env.JSCAD_EVAL_CANARY
    }
    const probe = JSON.parse(result.transcript.find((m) => m.role === 'tool').content).error.message
    for (const denied of ['config', 'keys', 'write', 'spawn', 'worker']) expect(probe).toContain(`${denied}:ERR_ACCESS_DENIED`)
    expect(probe).toContain('import:failed to load module node:fs')
    expect(probe).not.toContain('JSCAD_EVAL_CANARY')
  }, 30_000)

  it('rejects when the child exits before sending a result', async () => {
    await expect(
      runInChild({ fixtureName: 'cube-hole', run: 1, runs: 1, provider: { kind: 'fake', model: 'exit' }, providerModule: FAKE_PROVIDER }, () => {}),
    ).rejects.toThrow(/code 3/)
  }, 30_000)
})

describe('createSandboxedGrader', () => {
  it('grades a project in a sandboxed child', async () => {
    const grader = createSandboxedGrader()
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
