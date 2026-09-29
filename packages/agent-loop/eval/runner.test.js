import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { modelMaxTurns, promptHash, resultFileName, runSuite, saveResults, selectFixtures } from './run-eval.js'

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
    expect(results[0].metrics.warnings).toBe(0)
    expect(results[0].metrics.docsCalls).toBe(0)
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

  it('measures provider speed per run with an injected clock', async () => {
    const backend = createEvalBackend()
    let t = 0
    const now = () => (t += 100)
    let calls = 0
    const provider = {
      async *send() {
        calls += 1
        if (calls === 1) {
          yield { type: 'text', text: 'thinking' }
          yield { type: 'tool_use', id: 't1', name: 'eval', input: { source: 'x' } }
          yield { type: 'done', stopReason: 'tool_use' }
        } else {
          yield { type: 'usage', outputTokens: 30 }
          yield { type: 'text', text: 'done' }
          yield { type: 'done', stopReason: 'end_turn' }
        }
      },
    }
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 8, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend, now })
    // call 1: start 100, first content 200, end 300 -> providerSeconds 0.2, firstToken 0.1
    // call 2: start 400, first content (usage doesn't count) 500 (text), end 600 -> providerSeconds 0.2, firstToken 0.1
    // outputTokensPerSecond is outputTokens over total providerSeconds (0.4), not just streaming
    // time after first content, so a call that reasons silently before its first token doesn't
    // inflate the rate.
    expect(result.metrics.providerSeconds).toBeCloseTo(0.4)
    expect(result.metrics.firstTokenSeconds).toBeCloseTo(0.1)
    expect(result.metrics.outputTokensPerSecond).toBeCloseTo(30 / 0.4)
  })

  it('reasoningTokens is null when the provider never reports it', async () => {
    const backend = createEvalBackend()
    const provider = {
      async *send() {
        yield { type: 'text', text: 'ok' }
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 8, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend })
    expect(result.metrics.reasoningTokens).toBeNull()
  })

  it('sums reasoningTokens across rounds', async () => {
    const backend = createEvalBackend()
    let calls = 0
    const provider = {
      async *send() {
        calls += 1
        if (calls === 1) {
          yield { type: 'usage', outputTokens: 20, reasoningTokens: 15 }
          yield { type: 'tool_use', id: 't1', name: 'eval', input: { source: 'x' } }
          yield { type: 'done', stopReason: 'tool_use' }
        } else {
          yield { type: 'usage', outputTokens: 5, reasoningTokens: 3 }
          yield { type: 'text', text: 'done' }
          yield { type: 'done', stopReason: 'end_turn' }
        }
      },
    }
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 8, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend })
    expect(result.metrics.reasoningTokens).toBe(18)
  })

  it('nulls firstTokenSeconds and outputTokensPerSecond when there is no content or no tokens', async () => {
    const backend = createEvalBackend()
    let t = 0
    const now = () => (t += 50)
    const provider = {
      async *send() {
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 8, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend, now })
    expect(result.metrics.firstTokenSeconds).toBeNull()
    expect(result.metrics.outputTokensPerSecond).toBeNull()
    expect(typeof result.metrics.providerSeconds).toBe('number')
  })

  it('passes the final check-tool result as solid in the checks context', async () => {
    const backend = createEvalBackend()
    const provider = scripted([
      [
        { type: 'tool_use', id: 't1', name: 'eval', input: { source: 'const jf = require("@jbroll/jscad-fluent")\nfunction main() { return [jf.cube({ size: 20 })] }\nmodule.exports = { main }' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    let seenSolid
    const fixture = {
      name: 'solid-context',
      prompt: 'p',
      requires: ['eval'],
      verifyBeforeWrite: false,
      maxTurns: 8,
      checks: (m, { solid } = {}) => {
        seenSolid = solid
        return []
      },
    }
    await runSuite([fixture], { provider, backend })
    expect(seenSolid.watertight).toBe(true)
  })

  it('solid is null in the checks context when no geometry was produced', async () => {
    const provider = {
      async *send() {
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    let seenSolid = 'unset'
    const fixture = {
      name: 'x',
      prompt: 'p',
      requires: ['eval'],
      verifyBeforeWrite: false,
      maxTurns: 2,
      checks: (m, { solid } = {}) => {
        seenSolid = solid
        return []
      },
    }
    await runSuite([fixture], { provider, backend: createEvalBackend() })
    expect(seenSolid).toBeNull()
  })
})

const FLUENT_CUBE = 'const jf = require("@jbroll/jscad-fluent")\nfunction main() { return [jf.cube({ size: 20 })] }\nmodule.exports = { main }'
const PROBE = 'const jf = require("@jbroll/jscad-fluent")\nfunction main() { return [jf.sphere({ radius: 1 })] }\nmodule.exports = { main }'
const toolRound = (id, name, input) => [{ type: 'tool_use', id, name, input }, { type: 'done', stopReason: 'tool_use' }]
const endRound = [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }]
const saving = {
  name: 'saving',
  prompt: 'make a cube',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m, { solid, source } = {}) => [
    { name: 'volume', pass: (m?.volume ?? 0) > 7000 },
    { name: 'watertight', pass: solid?.watertight === true },
    { name: 'source', pass: source === FLUENT_CUBE },
  ],
}

describe('runSuite grades the saved model', () => {
  it('grades the writeModel source, not a probe evaled after it', async () => {
    const provider = scripted([
      toolRound('t1', 'eval', { source: FLUENT_CUBE }),
      toolRound('t2', 'writeModel', { source: FLUENT_CUBE }),
      toolRound('t3', 'eval', { source: PROBE }),
      endRound,
    ])
    const [result] = await runSuite([saving], { provider, backend: createEvalBackend() })
    expect(result.report.checkRate).toBe(1)
    expect(result.report.dimensions.geometry).toBe(2)
  })

  it('gives no geometry credit to a run that never called writeModel', async () => {
    const provider = scripted([toolRound('t1', 'eval', { source: FLUENT_CUBE }), endRound])
    const [result] = await runSuite([saving], { provider, backend: createEvalBackend() })
    expect(result.report.dimensions.geometry).toBe(0)
    expect(result.report.checkRate).toBe(0)
    expect(result.report.saved).toBe(false)
  })

  it('grades a saved model that fails to evaluate as no geometry', async () => {
    const provider = scripted([
      toolRound('t1', 'eval', { source: FLUENT_CUBE }),
      toolRound('t2', 'writeModel', { source: 'throw new Error("broken")' }),
      endRound,
    ])
    const [result] = await runSuite([saving], { provider, backend: createEvalBackend() })
    expect(result.report.checkRate).toBe(0)
    expect(result.metrics.geometryError).toBeNull()
  })
})

const MAIN_WITH_HELPER = 'const jf = require("@jbroll/jscad-fluent")\nconst { size } = require("./helper.js")\nmodule.exports = { main: () => [jf.cube({ size })] }'
const twoFile = {
  name: 'two-file',
  prompt: 'make a cube',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m, { source } = {}) => [
    { name: 'volume', pass: (m?.volume ?? 0) > 7000 },
    { name: 'source', pass: source.includes('size: 20') && source.includes('./helper.js') },
  ],
}

describe('runSuite grades the whole project', () => {
  it('evaluates main.js with every written file when the last write is the helper', async () => {
    const provider = scripted([
      toolRound('t1', 'writeModel', { source: MAIN_WITH_HELPER }),
      toolRound('t2', 'writeModel', { source: 'module.exports = { size: 20 }', entry: 'helper.js' }),
      endRound,
    ])
    const [result] = await runSuite([twoFile], { provider, backend: createEvalBackend() })
    const helperWrite = JSON.parse(result.transcript.findLast((m) => m.role === 'tool').content)
    expect(helperWrite.ok).toBe(true)
    expect(result.report.checkRate).toBe(1)
  })
})

describe('runSuite error sources', () => {
  const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 8, checks: () => [] }

  it('marks an error thrown by the provider as a provider error', async () => {
    const provider = {
      send: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error('status 429 rate limited') } }) }),
    }
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    expect(result.error).toBe('status 429 rate limited')
    expect(result.providerError).toBe(true)
  })

  it('marks a tool timeout from a hanging model as the model\'s failure, not the provider\'s', async () => {
    const hang = 'module.exports = { main: () => new Promise(() => {}) }'
    const provider = scripted([toolRound('t1', 'eval', { source: hang }), endRound])
    const [result] = await runSuite([{ ...fixture, requires: ['eval', 'writeModel'] }], { provider, backend: createEvalBackend(), toolTimeoutMs: 50 })
    expect(result.error).toMatch(/timed out/)
    expect(result).not.toHaveProperty('providerError')
  })

  it('stops grading a saved model that never finishes', async () => {
    const hang = 'module.exports = { main: () => new Promise(() => {}) }'
    const provider = scripted([toolRound('t1', 'writeModel', { source: hang }), endRound])
    const [result] = await runSuite([{ ...fixture, requires: ['eval', 'writeModel'] }], {
      provider, backend: createEvalBackend(), toolTimeoutMs: 50, gradeTimeoutMs: 50,
    })
    expect(result.report.checkRate).toBe(0)
  })
})

describe('runSuite empty provider replies', () => {
  it('records a round with no reply and no usage as a run error', async () => {
    const provider = {
      async *send() {
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 8, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    expect(result.error).toBe('empty provider reply')
    expect(result.providerError).toBe(true)
  })

  it('counts a round with only reasoning and usage as empty, and records each round\'s stop reason', async () => {
    const provider = scripted([
      toolRound('t1', 'params', {}),
      [{ type: 'usage', inputTokens: 10, outputTokens: 4000, reasoningTokens: 4000 }, { type: 'done', stopReason: 'length' }],
    ])
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 8, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    expect(result.error).toBe('empty provider reply')
    expect(result.providerError).toBe(true)
    expect(result.stopReasons).toEqual(['tool_use', 'length'])
    expect(result.transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool'])
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

describe('resultFileName', () => {
  it('names the file with a sortable UTC date and time so same-day reruns do not collide', () => {
    const now = new Date('2026-09-28T14:05:07.123Z')
    expect(resultFileName('muse-spark-1.3', 'fluent', 'abcd1234ef567890', now)).toBe(
      '2026-09-28T140507Z-muse-spark-1.3-fluent-abcd1234.json',
    )
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

describe('selectFixtures', () => {
  const ungrouped = { name: 'cube-hole' }
  const grouped = { name: 'gear', group: 'profiles' }
  const otherGrouped = { name: 'gear-module', group: 'profiles' }
  const all = [ungrouped, grouped, otherGrouped]

  it('with no EVAL_FIXTURES, runs only fixtures without a group', () => {
    expect(selectFixtures(all, null)).toEqual([ungrouped])
  })

  it('EVAL_FIXTURES names a fixture regardless of group', () => {
    expect(selectFixtures(all, ['gear'])).toEqual([grouped])
  })

  it('EVAL_FIXTURES names a group, selecting every fixture in it', () => {
    expect(selectFixtures(all, ['profiles'])).toEqual([grouped, otherGrouped])
  })

  it('EVAL_FIXTURES accepts a mix of fixture names and group names', () => {
    expect(selectFixtures(all, ['cube-hole', 'profiles'])).toEqual(all)
  })

  it('EVAL_FIXTURES=all runs everything', () => {
    expect(selectFixtures(all, ['all'])).toEqual(all)
  })
})

describe('saveResults', () => {
  it('writes the accumulated results and a recomputed summary via the injected writer', () => {
    const writes = []
    const writeFile = (path, content) => writes.push({ path, content })
    const resultA = {
      fixture: 'x', run: 1, report: { firstAttemptFailures: 0, checkRate: 1, total: 8 },
      metrics: { seconds: 4, providerSeconds: 3, firstTokenSeconds: 0.4, outputTokensPerSecond: 50 },
    }
    saveResults(writeFile, '/fake/path.json', { model: 'm', provider: 'p', runs: 2, promptSha256: 'sha', results: [resultA] })
    expect(writes).toHaveLength(1)
    const parsed = JSON.parse(writes[0].content)
    expect(parsed.model).toBe('m')
    expect(parsed.results).toHaveLength(1)
    expect(parsed.summary[0].fixture).toBe('x')
    expect(parsed.speed).toEqual({ wallSeconds: 4, providerSeconds: 3, toolSeconds: 1, medianFirstTokenSeconds: 0.4, medianOutputTokensPerSecond: 50, runs: 1 })

    const resultB = { fixture: 'x', run: 2, report: { firstAttemptFailures: 1, checkRate: 0, total: 4 } }
    saveResults(writeFile, '/fake/path.json', { model: 'm', provider: 'p', runs: 2, promptSha256: 'sha', results: [resultA, resultB] })
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[1].content).results).toHaveLength(2)
  })

  it('writes the elapsed suite time as speed.wallSeconds when given', () => {
    const writes = []
    const result = { fixture: 'x', run: 1, report: { firstAttemptFailures: 0, checkRate: 1, total: 8 }, metrics: { seconds: 40, providerSeconds: 30 } }
    const { speed } = saveResults((_path, content) => writes.push(content), '/fake/path.json', {
      model: 'm', provider: 'p', runs: 2, promptSha256: 'sha', results: [result, { ...result, run: 2 }], wallSeconds: 45,
    })
    expect(speed.wallSeconds).toBe(45)
    expect(speed.providerSeconds).toBe(60)
    expect(JSON.parse(writes[0]).speed.wallSeconds).toBe(45)
  })

  it('writes the model turn cap in the header, null when each fixture keeps its own', () => {
    const writes = []
    const write = (_path, content) => writes.push(JSON.parse(content))
    const base = { model: 'm', provider: 'p', runs: 1, promptSha256: 'sha', results: [] }
    saveResults(write, '/fake/path.json', { ...base, maxTurns: 8 })
    saveResults(write, '/fake/path.json', base)
    expect(writes[0].maxTurns).toBe(8)
    expect(writes[1].maxTurns).toBeNull()
  })
})

describe('modelMaxTurns', () => {
  const models = { 'slow-model': { maxTurns: 8 } }

  it('ships a cap of 8 for muse-spark-1.3-contributor and deepseek-v4.1-flash', () => {
    expect(modelMaxTurns({}, 'muse-spark-1.3-contributor')).toBe(8)
    expect(modelMaxTurns({}, 'deepseek-v4.1-flash')).toBe(8)
  })

  it('reads the model entry from models.json', () => {
    expect(modelMaxTurns({}, 'slow-model', models)).toBe(8)
  })

  it('is null for a model with no entry, so each fixture keeps its own cap', () => {
    expect(modelMaxTurns({}, 'other', models)).toBeNull()
  })

  it('EVAL_MAX_TURNS overrides models.json', () => {
    expect(modelMaxTurns({ EVAL_MAX_TURNS: '3' }, 'slow-model', models)).toBe(3)
    expect(modelMaxTurns({ EVAL_MAX_TURNS: '3' }, 'other', models)).toBe(3)
  })

  it('ignores an EVAL_MAX_TURNS that is not a positive integer', () => {
    expect(modelMaxTurns({ EVAL_MAX_TURNS: 'x' }, 'slow-model', models)).toBe(8)
  })
})

describe('runSuite turn cap', () => {
  let id = 0
  const endless = {
    async *send() {
      id += 1
      yield { type: 'tool_use', id: `t${id}`, name: 'params', input: {} }
      yield { type: 'done', stopReason: 'tool_use' }
    },
  }
  const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 4, checks: () => [] }

  it('caps rounds at the fixture maxTurns and records it, without calling the cap an empty reply', async () => {
    const [result] = await runSuite([fixture], { provider: endless, backend: createEvalBackend() })
    expect(result.maxTurns).toBe(4)
    expect(result.metrics.rounds).toBe(5)
    expect(result.error).toBeUndefined()
    expect(result).not.toHaveProperty('providerError')
    expect(result.stopReasons).toEqual(['tool_use', 'tool_use', 'tool_use', 'tool_use'])
    expect(result.transcript.at(-1).role).toBe('tool')
  })

  it('scores no recovery penalty for a failure in the capped last round', async () => {
    const failing = scripted([toolRound('t1', 'params', {}), toolRound('t2', 'eval', { source: 'nope(' })])
    const [result] = await runSuite([fixture], { provider: failing, backend: createEvalBackend(), maxTurns: 2 })
    expect(result.report.dimensions.recovery).toBe(2)
  })

  it('a maxTurns option overrides the fixture cap', async () => {
    const [result] = await runSuite([fixture], { provider: endless, backend: createEvalBackend(), maxTurns: 2 })
    expect(result.maxTurns).toBe(2)
    expect(result.metrics.rounds).toBe(3)
  })
})
