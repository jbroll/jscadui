import { describe, expect, it } from 'vitest'
import { formatComparison, formatSummary, summarize } from './report.js'

const run = (fixture, firstAttemptFailures, checkRate, total, error, metrics) => ({
  fixture,
  run: 1,
  report: { firstAttemptFailures, checkRate, total, dimensions: {} },
  turns: 3,
  ...(metrics ? { metrics } : {}),
  ...(error ? { error } : {}),
})

describe('eval report', () => {
  it('summarizes runs per fixture as means', () => {
    const summary = summarize([run('a', 2, 0.5, 4), run('a', 0, 1, 8, 'status 500'), run('b', 1, 1, 7)])
    expect(summary).toEqual([
      {
        fixture: 'a', runs: 2, firstAttemptFailures: 1, checkPassRate: 0.75, total: 6, errors: 1,
        rounds: null, failedCalls: null, inputTokens: null, outputTokens: null, seconds: null, geometryError: null,
      },
      {
        fixture: 'b', runs: 1, firstAttemptFailures: 1, checkPassRate: 1, total: 7, errors: 0,
        rounds: null, failedCalls: null, inputTokens: null, outputTokens: null, seconds: null, geometryError: null,
      },
    ])
    expect(formatSummary(summary)).toContain('a  2  1.00  0.75  6.00  1')
  })

  it('means the new metrics, tolerating results with no metrics', () => {
    const withMetrics = run('a', 0, 1, 8, undefined, {
      rounds: 4, toolCalls: 3, failedCalls: 1, inputTokens: 100, outputTokens: 20, seconds: 2, geometryError: 0.1,
    })
    const noMetrics = run('a', 0, 1, 8)
    const summary = summarize([withMetrics, noMetrics])
    expect(summary[0]).toEqual(
      expect.objectContaining({
        rounds: 4,
        failedCalls: 1,
        inputTokens: 100,
        outputTokens: 20,
        seconds: 2,
        geometryError: 0.1,
      }),
    )
    const noMetricsOnly = summarize([noMetrics])
    expect(noMetricsOnly[0]).toEqual(
      expect.objectContaining({ rounds: null, failedCalls: null, inputTokens: null, outputTokens: null, seconds: null, geometryError: null }),
    )
  })

  it('formatSummary shows a second table for the new metrics, "-" for missing', () => {
    const summary = summarize([run('a', 0, 1, 8, undefined, { rounds: 4, toolCalls: 3, failedCalls: 1, inputTokens: 100, outputTokens: 20, seconds: 2, geometryError: 0.1 })])
    const text = formatSummary(summary)
    expect(text).toContain('rounds')
    expect(text).toContain('a  4.00  1.00  100.00  20.00  2.00  0.10')
    const noMetricsSummary = summarize([run('b', 0, 1, 8)])
    expect(formatSummary(noMetricsSummary)).toContain('b  -  -  -  -  -  -')
  })

  it('compares two result files per fixture', () => {
    const a = { model: 'm', promptSha256: 'aaaaaaaa11', summary: summarize([run('single-sphere', 1, 0.5, 4)]) }
    const b = { model: 'm', promptSha256: 'bbbbbbbb22', summary: summarize([run('single-sphere', 0, 1, 7), run('gear', 0, 1, 7)]) }
    const text = formatComparison(a, b)
    expect(text).toContain('a: m aaaaaaaa  b: m bbbbbbbb')
    expect(text).toContain('single-sphere  1.00 → 0.00  0.50 → 1.00  4.00 → 7.00')
    expect(text).toContain('gear  - → 0.00')
  })

  it('compares the new metrics too, "-" on either side when missing', () => {
    const metrics = { rounds: 4, toolCalls: 3, failedCalls: 1, inputTokens: 100, outputTokens: 20, seconds: 2, geometryError: 0.2 }
    const a = { model: 'm', promptSha256: 'aaaaaaaa11', summary: summarize([run('single-sphere', 1, 0.5, 4, undefined, metrics)]) }
    const b = { model: 'm', promptSha256: 'bbbbbbbb22', summary: summarize([run('single-sphere', 0, 1, 7)]) }
    const text = formatComparison(a, b)
    expect(text).toContain('single-sphere  4.00 → -  1.00 → -')
  })
})
