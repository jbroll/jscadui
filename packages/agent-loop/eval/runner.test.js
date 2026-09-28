import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { promptHash, runSuite, saveResults } from './run-eval.js'

const scripted = (rounds) => ({
  async *send() {
    for (const event of rounds.shift() ?? []) yield event
  },
})

describe('runSuite', () => {
  it('runs a fixture against a scripted provider and grades it', async () => {
    const backend = createEvalBackend()
    const provider = scripted([
      [
        { type: 'tool_use', id: 't1', name: 'eval', input: { source: 'const jf = require("@jbroll/jscad-fluent")\nfunction main() { return [jf.cube({ size: 20 })] }\nmodule.exports = { main }' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'tool_use', id: 't2', name: 'measure', input: {} },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'text', text: 'a 20mm cube' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const fixture = {
      name: 'smoke',
      prompt: 'make a cube',
      requires: ['eval', 'measure'],
      verifyBeforeWrite: false,
      maxTurns: 8,
      target: { volume: 8000 },
      checks: (m) => [{ name: 'volume', pass: (m?.volume ?? 0) > 7000 }],
    }
    const results = await runSuite([fixture], { provider, backend })
    expect(results).toHaveLength(1)
    expect(results[0].report.dimensions.discipline).toBe(2)
    expect(results[0].report.total).toBeGreaterThanOrEqual(6)
    expect(results[0].metrics.rounds).toBe(3)
    expect(results[0].metrics.toolCalls).toBe(2)
    expect(results[0].metrics.failedCalls).toBe(0)
    expect(results[0].metrics.inputTokens).toBeNull()
    expect(results[0].metrics.outputTokens).toBeNull()
    expect(typeof results[0].metrics.seconds).toBe('number')
    expect(results[0].metrics.geometryError).toBeCloseTo(0)
  })

  it('sums usage events across rounds; null when the provider reports none', async () => {
    const backend = createEvalBackend()
    const provider = {
      calls: 0,
      async *send() {
        this.calls += 1
        if (this.calls === 1) {
          yield { type: 'usage', inputTokens: 100, outputTokens: 20 }
          yield { type: 'tool_use', id: 't1', name: 'eval', input: { source: 'x' } }
          yield { type: 'done', stopReason: 'tool_use' }
        } else {
          yield { type: 'usage', inputTokens: 50, outputTokens: 5 }
          yield { type: 'text', text: 'done' }
          yield { type: 'done', stopReason: 'end_turn' }
        }
      },
    }
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 8, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend })
    expect(result.metrics.inputTokens).toBe(150)
    expect(result.metrics.outputTokens).toBe(25)
  })

  it('refuses without a provider', async () => {
    await expect(runSuite([], { provider: null, backend: createEvalBackend() })).rejects.toThrow(/provider/)
  })
})

describe('runSuite runs and context', () => {
  it('runs each fixture `runs` times and sends prior turns and files', async () => {
    const seen = []
    const provider = {
      async *send(messages) {
        seen.push([...messages])
        yield { type: 'text', text: 'ok' }
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const fixture = {
      name: 'follow-up',
      prompt: 'make it taller',
      transcript: [{ role: 'user', content: 'a cube' }, { role: 'assistant', content: 'done' }],
      files: { 'main.js': 'module.exports = {}' },
      requires: ['eval'],
      verifyBeforeWrite: false,
      maxTurns: 2,
      checks: () => [],
    }
    const results = await runSuite([fixture], { provider, backend: createEvalBackend(), runs: 3 })
    expect(results.map((r) => r.run)).toEqual([1, 2, 3])
    expect(seen[0].map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'user'])
    expect(seen[0][3].content).toContain('### main.js')
    expect(seen[0].at(-1).content).toBe('make it taller')
  })

  it('records a provider failure on the run instead of throwing', async () => {
    const provider = {
      send: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error('status 500') } }) }),
    }
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 2, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    expect(result.error).toBe('status 500')
    expect(result.report.firstAttemptFailures).toBe(0)
  })

  it('hashes the prompt with SHA-256', () => {
    expect(promptHash('x')).toBe('2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881')
  })
})

describe('runSuite transcript', () => {
  it('keeps the run transcript without the system message', async () => {
    const backend = createEvalBackend()
    const provider = scripted([
      [
        { type: 'tool_use', id: 't1', name: 'eval', input: { source: 'x' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const fixture = { name: 'smoke', prompt: 'make a cube', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 8, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend })
    expect(result.transcript.some((m) => m.role === 'system')).toBe(false)
    expect(result.transcript[0]).toEqual({ role: 'user', content: 'make a cube' })
    expect(result.transcript.some((m) => m.toolCalls?.some((c) => c.name === 'eval'))).toBe(true)
    expect(result.transcript.some((m) => m.role === 'tool')).toBe(true)
  })

  it('keeps whatever messages exist on a provider error, minus system', async () => {
    const provider = {
      send: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error('status 500') } }) }),
    }
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 2, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    expect(result.transcript.some((m) => m.role === 'system')).toBe(false)
    expect(result.transcript[0]).toEqual({ role: 'user', content: 'p' })
  })

  it('calls onRun once per run with the result', async () => {
    const provider = {
      async *send() {
        yield { type: 'text', text: 'ok' }
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 2, checks: () => [] }
    const seen = []
    await runSuite([fixture], { provider, backend: createEvalBackend(), runs: 2, onRun: (result) => seen.push(result) })
    expect(seen).toHaveLength(2)
    expect(seen.map((r) => r.run)).toEqual([1, 2])
  })
})

describe('runSuite verbose hooks', () => {
  it('calls onRunStart, onText and the tool hooks in order', async () => {
    const events = []
    let calls = 0
    const scriptedProvider = {
      async *send() {
        calls += 1
        if (calls === 1) {
          yield { type: 'text', text: 'thinking' }
          yield { type: 'tool_use', id: 't1', name: 'eval', input: { source: 'const x=1' } }
          yield { type: 'done', stopReason: 'tool_use' }
        } else {
          yield { type: 'text', text: 'done now' }
          yield { type: 'done', stopReason: 'end_turn' }
        }
      },
    }
    const fixture = { name: 'smoke', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 8, checks: () => [] }
    await runSuite([fixture], {
      provider: scriptedProvider,
      backend: createEvalBackend(),
      runs: 1,
      onRunStart: (fx, run, runs) => events.push(['start', fx.name, run, runs]),
      onToolCall: (name, input) => events.push(['call', name, input]),
      onToolResult: (name, result) => events.push(['result', name, result]),
      onText: (text) => events.push(['text', text]),
    })
    expect(events[0]).toEqual(['start', 'smoke', 1, 1])
    expect(events[1]).toEqual(['text', 'thinking'])
    expect(events[2][0]).toBe('call')
    expect(events[2][1]).toBe('eval')
    expect(events[3][0]).toBe('result')
    expect(events[3][1]).toBe('eval')
    expect(typeof events[3][2]).toBe('string')
    expect(events[4]).toEqual(['text', 'done now'])
  })
})

describe('saveResults', () => {
  it('writes the accumulated results and a recomputed summary via the injected writer', () => {
    const writes = []
    const writeFile = (path, content) => writes.push({ path, content })
    const resultA = { fixture: 'x', run: 1, report: { firstAttemptFailures: 0, checkRate: 1, total: 8 } }
    saveResults(writeFile, '/fake/path.json', { model: 'm', provider: 'p', runs: 2, promptSha256: 'sha', results: [resultA] })
    expect(writes).toHaveLength(1)
    const parsed = JSON.parse(writes[0].content)
    expect(parsed.model).toBe('m')
    expect(parsed.results).toHaveLength(1)
    expect(parsed.summary[0].fixture).toBe('x')

    const resultB = { fixture: 'x', run: 2, report: { firstAttemptFailures: 1, checkRate: 0, total: 4 } }
    saveResults(writeFile, '/fake/path.json', { model: 'm', provider: 'p', runs: 2, promptSha256: 'sha', results: [resultA, resultB] })
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[1].content).results).toHaveLength(2)
  })
})
