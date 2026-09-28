import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { promptHash, runSuite } from './run-eval.js'

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
      checks: (m) => [{ name: 'volume', pass: (m?.volume ?? 0) > 7000 }],
    }
    const results = await runSuite([fixture], { provider, backend })
    expect(results).toHaveLength(1)
    expect(results[0].report.dimensions.discipline).toBe(2)
    expect(results[0].report.total).toBeGreaterThanOrEqual(6)
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
        seen.push(messages)
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
