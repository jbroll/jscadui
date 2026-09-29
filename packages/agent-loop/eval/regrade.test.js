import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { regradeResults } from './run-eval.js'

const toolMsg = (id, name, input = {}) => ({ role: 'assistant', content: null, toolCalls: [{ id, name, input }] })
const resultMsg = (id, content) => ({ role: 'tool', toolCallId: id, content })

const backend = createEvalBackend()

const fixture = {
  name: 'cube-hole',
  requires: ['eval', 'measure', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 8,
  checks: () => [],
}

describe('regradeResults', () => {
  it('recomputes transcript dimensions and keeps stored geometry for a run whose prompt differs from the fixture', async () => {
    const transcript = [
      { role: 'user', content: 'an older, spec-like prompt' },
      toolMsg('t1', 'eval'), resultMsg('t1', JSON.stringify({ ok: true })),
      toolMsg('t2', 'writeModel'), resultMsg('t2', JSON.stringify({ ok: true })),
      { role: 'assistant', content: 'done', toolCalls: [] },
    ]
    const file = {
      model: 'm',
      results: [
        {
          fixture: 'cube-hole',
          run: 1,
          transcript,
          report: {
            dimensions: { discipline: 2, recovery: 1, geometry: 2, conservation: 2 },
            total: 7,
            firstAttemptFailures: 0,
            checkRate: 1,
          },
        },
      ],
    }
    const out = await regradeResults(file, new Map([['cube-hole', fixture]]), { backend })
    expect(out.results[0].report.dimensions).toEqual({ discipline: 1, recovery: 2, geometry: 2, conservation: 2 })
    expect(out.results[0].report.total).toBe(7)
    expect(out.results[0].report.checkRate).toBe(1)
    expect(out.results[0].regradeNote).toBe('prompt differs from the current fixture; kept stored geometry')
    expect(out.summary[0].total).toBe(7)
  })

  it('recomputes toolCalls and failedCalls from the transcript, filling metrics when absent', async () => {
    const transcript = [
      toolMsg('t1', 'eval'), resultMsg('t1', JSON.stringify({ ok: false })),
      toolMsg('t2', 'eval'), resultMsg('t2', JSON.stringify({ ok: true })),
    ]
    const file = {
      model: 'm',
      results: [
        {
          fixture: 'cube-hole',
          run: 1,
          transcript,
          report: { dimensions: { discipline: 2, recovery: 2, geometry: 2, conservation: 2 }, total: 8, firstAttemptFailures: 1, checkRate: 1 },
        },
      ],
    }
    const out = await regradeResults(file, new Map([['cube-hole', fixture]]), { backend })
    expect(out.results[0].metrics).toEqual({ toolCalls: 2, failedCalls: 1, warnings: 0, docsCalls: 0, geometryError: null })
  })

  it('keeps other stored metrics fields untouched while refreshing toolCalls/failedCalls and geometryError', async () => {
    const transcript = [toolMsg('t1', 'eval'), resultMsg('t1', JSON.stringify({ ok: true }))]
    const file = {
      model: 'm',
      results: [
        {
          fixture: 'cube-hole',
          run: 1,
          transcript,
          report: { dimensions: { discipline: 2, recovery: 2, geometry: 2, conservation: 2 }, total: 8, firstAttemptFailures: 0, checkRate: 1 },
          metrics: { rounds: 5, toolCalls: 99, failedCalls: 99, inputTokens: 100, outputTokens: 20, seconds: 3.5, geometryError: 0.1 },
        },
      ],
    }
    const out = await regradeResults(file, new Map([['cube-hole', fixture]]), { backend })
    expect(out.results[0].metrics).toEqual({
      rounds: 5, toolCalls: 1, failedCalls: 0, warnings: 0, docsCalls: 0, inputTokens: 100, outputTokens: 20, seconds: 3.5, geometryError: null,
    })
  })

  it('keeps stored speed metrics as-is and recomputes the top-level speed from them', async () => {
    const transcript = [toolMsg('t1', 'eval'), resultMsg('t1', JSON.stringify({ ok: true }))]
    const file = {
      model: 'm',
      results: [
        {
          fixture: 'cube-hole',
          run: 1,
          transcript,
          report: { dimensions: { discipline: 2, recovery: 2, geometry: 2, conservation: 2 }, total: 8, firstAttemptFailures: 0, checkRate: 1 },
          metrics: { seconds: 4, providerSeconds: 3, firstTokenSeconds: 0.4, outputTokensPerSecond: 50 },
        },
      ],
    }
    const out = await regradeResults(file, new Map([['cube-hole', fixture]]), { backend })
    expect(out.results[0].metrics).toEqual(
      expect.objectContaining({ seconds: 4, providerSeconds: 3, firstTokenSeconds: 0.4, outputTokensPerSecond: 50 }),
    )
    expect(out.speed).toEqual({ wallSeconds: 4, providerSeconds: 3, toolSeconds: 1, medianFirstTokenSeconds: 0.4, medianOutputTokensPerSecond: 50, runs: 1 })
  })

  it('keeps a stored suite wallSeconds, which a parallel run measures as elapsed time', async () => {
    const file = {
      model: 'm',
      speed: { wallSeconds: 5 },
      results: [1, 2].map((run) => ({
        fixture: 'cube-hole',
        run,
        transcript: [],
        report: { dimensions: { discipline: 2, recovery: 2, geometry: 2, conservation: 2 }, total: 8, firstAttemptFailures: 0, checkRate: 1 },
        metrics: { seconds: 4, providerSeconds: 3 },
      })),
    }
    const out = await regradeResults(file, new Map([['cube-hole', fixture]]), { backend })
    expect(out.speed.wallSeconds).toBe(5)
    expect(out.speed.providerSeconds).toBe(6)
  })

  it('leaves a result untouched when its fixture no longer exists, and notes it', async () => {
    const file = {
      results: [
        {
          fixture: 'gone',
          run: 1,
          transcript: [],
          report: { dimensions: { discipline: 0, recovery: 1, geometry: 0, conservation: 0 }, total: 1, firstAttemptFailures: 0, checkRate: 0 },
        },
      ],
    }
    const out = await regradeResults(file, new Map(), { backend })
    expect(out.results[0].report.total).toBe(1)
    expect(out.results[0].report.dimensions.recovery).toBe(1)
    expect(out.results[0].regradeNote).toBe('fixture no longer exists; kept stored grading')
  })
})

const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'
const PROBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.sphere({ radius: 1 })] }'
const saving = {
  name: 'saving',
  prompt: 'make a cube',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  target: { volume: 8000 },
  checks: (m, { solid, source, params } = {}) => [
    { name: 'volume', pass: (m?.volume ?? 0) > 7000 },
    { name: 'watertight', pass: solid?.watertight === true },
    { name: 'source', pass: source === CUBE },
    { name: 'params', pass: Array.isArray(params) },
  ],
}
const stored = { dimensions: { discipline: 2, recovery: 2, geometry: 0, conservation: 2 }, total: 6, firstAttemptFailures: 0, checkRate: 0 }
const fileOf = (transcript, extra = {}) => ({
  model: 'm',
  results: [{ fixture: 'saving', run: 1, transcript, report: stored, metrics: { rounds: 4, seconds: 9, geometryError: 0.9 }, ...extra }],
})
const regrade = (file) => regradeResults(file, new Map([['saving', saving]]), { backend })
const prompt = { role: 'user', content: 'make a cube' }
const done = { role: 'assistant', content: 'done', toolCalls: [] }

describe('regradeResults on the saved model', () => {
  it('re-evaluates the writeModel source from the transcript, ignoring a later probe', async () => {
    const out = await regrade(fileOf([
      prompt,
      toolMsg('t1', 'writeModel', { source: CUBE }), resultMsg('t1', JSON.stringify({ ok: true })),
      toolMsg('t2', 'eval', { source: PROBE }), resultMsg('t2', JSON.stringify({ ok: true })),
      done,
    ]))
    const [result] = out.results
    expect(result.report.checkRate).toBe(1)
    expect(result.report.dimensions.geometry).toBe(2)
    expect(result.report.total).toBe(8)
    expect(result.metrics.geometryError).toBeCloseTo(0)
    expect(result.metrics.rounds).toBe(4)
    expect(result.metrics.seconds).toBe(9)
    expect(result).not.toHaveProperty('regradeNote')
    expect(out.regradedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('gives no geometry credit to a run with no writeModel, even with a good eval', async () => {
    const out = await regrade(fileOf([
      prompt,
      toolMsg('t1', 'eval', { source: CUBE }), resultMsg('t1', JSON.stringify({ ok: true })),
      done,
    ]))
    const { report } = out.results[0]
    expect(report.dimensions.geometry).toBe(0)
    expect(report.checkRate).toBe(0)
    expect(report.saved).toBe(false)
  })

  it('marks a run whose provider never replied as an errored run', async () => {
    const out = await regrade(fileOf([prompt]))
    expect(out.results[0].error).toBe('empty provider reply')
    expect(out.summary[0].errors).toBe(1)
    expect(out.summary[0].total).toBeNull()
  })

  it('keeps an error the run already recorded', async () => {
    const out = await regrade(fileOf([prompt], { error: 'status 500' }))
    expect(out.results[0].error).toBe('status 500')
  })

  it('keeps the transcript, turns and other run data', async () => {
    const transcript = [prompt, toolMsg('t1', 'writeModel', { source: CUBE }), resultMsg('t1', JSON.stringify({ ok: true, console: ['hi'] })), done]
    const out = await regrade(fileOf(transcript, { turns: 5, maxTurns: 8 }))
    expect(out.results[0].transcript).toEqual(transcript)
    expect(out.results[0].turns).toBe(5)
    expect(out.results[0].maxTurns).toBe(8)
  })

  it('notes and keeps a result with no transcript', async () => {
    const file = { model: 'keyless', results: [{ fixture: 'saving', report: stored, turns: 9 }] }
    const out = await regrade(file)
    expect(out.results[0].report).toEqual(stored)
    expect(out.results[0].regradeNote).toBe('no transcript; kept stored grading')
  })
})
