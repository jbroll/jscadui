import { describe, expect, it } from 'vitest'
import { concurrencyFrom, runPool, runSuiteParallel } from './parallel.js'

const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const fixture = (name) => ({ name, prompt: `make ${name}`, requires: ['write'], verifyBeforeWrite: false, maxTurns: 4, checks: () => [] })

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

  it('names a crashed run as such and records its api', async () => {
    const [result] = await runSuiteParallel([fixture('a')], {
      runs: 1,
      concurrency: 1,
      api: 'modeling',
      runJob: async () => {
        throw new Error('boom')
      },
    })
    expect(result.error).toBe('run crashed: boom')
    expect(result.api).toBe('modeling')
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
