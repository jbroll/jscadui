import { describe, expect, it } from 'vitest'
import { regradeResults } from './run-eval.js'

const toolMsg = (id, name) => ({ role: 'assistant', content: null, toolCalls: [{ id, name, input: {} }] })
const resultMsg = (id, content) => ({ role: 'tool', toolCallId: id, content })

const fixture = {
  name: 'cube-hole',
  requires: ['eval', 'measure', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 8,
  checks: () => [],
}

describe('regradeResults', () => {
  it('recomputes transcript-based dimensions and totals, keeping geometry and checkRate', () => {
    const transcript = [toolMsg('t1', 'eval'), resultMsg('t1', JSON.stringify({ ok: true }))]
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
    const out = regradeResults(file, new Map([['cube-hole', fixture]]))
    expect(out.results[0].report.dimensions).toEqual({ discipline: 2, recovery: 2, geometry: 2, conservation: 2 })
    expect(out.results[0].report.total).toBe(8)
    expect(out.results[0].report.checkRate).toBe(1)
    expect(out.summary[0].total).toBe(8)
  })

  it('recomputes toolCalls and failedCalls from the transcript, filling metrics when absent', () => {
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
    const out = regradeResults(file, new Map([['cube-hole', fixture]]))
    expect(out.results[0].metrics).toEqual({ toolCalls: 2, failedCalls: 1, warnings: 0, docsCalls: 0 })
  })

  it('keeps other stored metrics fields untouched while refreshing toolCalls/failedCalls', () => {
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
    const out = regradeResults(file, new Map([['cube-hole', fixture]]))
    expect(out.results[0].metrics).toEqual({
      rounds: 5, toolCalls: 1, failedCalls: 0, warnings: 0, docsCalls: 0, inputTokens: 100, outputTokens: 20, seconds: 3.5, geometryError: 0.1,
    })
  })

  it('leaves a result untouched when its fixture no longer exists', () => {
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
    const out = regradeResults(file, new Map())
    expect(out.results[0].report.total).toBe(1)
    expect(out.results[0].report.dimensions.recovery).toBe(1)
  })
})
