import { describe, expect, it } from 'vitest'
import { computeSpeed, formatComparison, formatSummary, summarize } from './report.js'

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
        rounds: null, failedCalls: null, inputTokens: null, outputTokens: null, seconds: null, geometryError: null, warnings: null, docsCalls: null,
        providerSeconds: null, firstTokenSeconds: null, outputTokensPerSecond: null,
      },
      {
        fixture: 'b', runs: 1, firstAttemptFailures: 1, checkPassRate: 1, total: 7, errors: 0,
        rounds: null, failedCalls: null, inputTokens: null, outputTokens: null, seconds: null, geometryError: null, warnings: null, docsCalls: null,
        providerSeconds: null, firstTokenSeconds: null, outputTokensPerSecond: null,
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

  it('means, prints and compares warnings and docsCalls', () => {
    const metrics = { rounds: 4, toolCalls: 3, failedCalls: 1, inputTokens: 100, outputTokens: 20, seconds: 2, geometryError: 0.1, warnings: 2, docsCalls: 1 }
    const summary = summarize([run('a', 0, 1, 8, undefined, metrics), run('a', 0, 1, 8, undefined, { ...metrics, warnings: 0, docsCalls: 3 })])
    expect(summary[0]).toEqual(expect.objectContaining({ warnings: 1, docsCalls: 2 }))
    expect(formatSummary(summary)).toContain('geometryError  warnings  docsCalls')
    expect(formatSummary(summary)).toContain('a  4.00  1.00  100.00  20.00  2.00  0.10  1.00  2.00')
    const text = formatComparison({ model: 'm', summary }, { model: 'm', summary: summarize([run('a', 0, 1, 8)]) })
    expect(text).toContain('warnings a → b  docsCalls a → b')
    expect(text).toContain('0.10 → -  1.00 → -  2.00 → -')
  })

  it('means, prints and compares providerSeconds, firstTokenSeconds and outputTokensPerSecond', () => {
    const metrics = { seconds: 2, providerSeconds: 1.5, firstTokenSeconds: 0.3, outputTokensPerSecond: 50 }
    const summary = summarize([run('a', 0, 1, 8, undefined, metrics), run('a', 0, 1, 8, undefined, { ...metrics, providerSeconds: 2.5, firstTokenSeconds: 0.5, outputTokensPerSecond: 100 })])
    expect(summary[0]).toEqual(expect.objectContaining({ providerSeconds: 2, firstTokenSeconds: 0.4, outputTokensPerSecond: 75 }))
    const text = formatSummary(summary)
    expect(text).toContain('fixture  providerSeconds  firstTokenSeconds  outputTokensPerSecond')
    expect(text).toContain('a  2.00  0.40  75.00')
    const noMetricsSummary = summarize([run('b', 0, 1, 8)])
    expect(formatSummary(noMetricsSummary)).toContain('b  -  -  -')
    const compared = formatComparison({ model: 'm', summary }, { model: 'm', summary: summarize([run('a', 0, 1, 8)]) })
    expect(compared).toContain('providerSeconds a → b  outputTokensPerSecond a → b')
    expect(compared).toContain('2.00 → -  75.00 → -')
  })

  it('computeSpeed sums wall/provider/tool seconds and medians first-token and throughput over all runs', () => {
    const results = [
      { fixture: 'a', metrics: { seconds: 10, providerSeconds: 8, firstTokenSeconds: 0.2, outputTokensPerSecond: 40 } },
      { fixture: 'a', metrics: { seconds: 6, providerSeconds: 4, firstTokenSeconds: 0.6, outputTokensPerSecond: 80 } },
      { fixture: 'b', metrics: { seconds: 4, providerSeconds: 3, firstTokenSeconds: null, outputTokensPerSecond: null } },
    ]
    expect(computeSpeed(results)).toEqual({
      wallSeconds: 20,
      providerSeconds: 15,
      toolSeconds: 5,
      medianFirstTokenSeconds: 0.4,
      medianOutputTokensPerSecond: 60,
      runs: 3,
    })
  })

  it('computeSpeed returns nulls and zeros when no runs carry speed metrics', () => {
    expect(computeSpeed([{ fixture: 'a', metrics: {} }])).toEqual({
      wallSeconds: 0, providerSeconds: 0, toolSeconds: 0, medianFirstTokenSeconds: null, medianOutputTokensPerSecond: null, runs: 1,
    })
  })

  it('formatSummary prints the speed totals line when a speed object with model/provider is given', () => {
    const speed = { wallSeconds: 812, providerSeconds: 640, toolSeconds: 172, medianFirstTokenSeconds: 1.8, medianOutputTokensPerSecond: 94, runs: 6, model: 'muse-spark-1.3', provider: 'meta' }
    const text = formatSummary(summarize([run('a', 0, 1, 8)]), speed)
    expect(text).toContain('speed: model muse-spark-1.3 via meta  wall 812s  provider 640s  tools 172s  first token 1.8s (median)  94 tok/s (median)')
  })

  it('formatSummary omits the speed line when no speed object is given', () => {
    expect(formatSummary(summarize([run('a', 0, 1, 8)]))).not.toContain('speed:')
  })

  it('formatComparison prints both files\' speed lines, "-" when a file predates speed', () => {
    const a = { model: 'm', provider: 'meta', summary: summarize([run('a', 0, 1, 8)]), speed: { wallSeconds: 10, providerSeconds: 8, toolSeconds: 2, medianFirstTokenSeconds: 0.5, medianOutputTokensPerSecond: 20, runs: 1 } }
    const b = { model: 'm', provider: 'meta', summary: summarize([run('a', 0, 1, 8)]) }
    const text = formatComparison(a, b)
    expect(text).toContain('speed: model m via meta  wall 10s  provider 8s  tools 2s  first token 0.5s (median)  20 tok/s (median)')
    expect(text).toContain('speed: model m via meta  -')
  })
})
