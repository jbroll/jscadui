import { describe, expect, it } from 'vitest'
import { formatComparison, formatSummary, summarize } from './report.js'

const run = (fixture, firstAttemptFailures, checkRate, total, error) => ({
  fixture,
  run: 1,
  report: { firstAttemptFailures, checkRate, total, dimensions: {} },
  turns: 3,
  ...(error ? { error } : {}),
})

describe('eval report', () => {
  it('summarizes runs per fixture as means', () => {
    const summary = summarize([run('a', 2, 0.5, 4), run('a', 0, 1, 8, 'status 500'), run('b', 1, 1, 7)])
    expect(summary).toEqual([
      { fixture: 'a', runs: 2, firstAttemptFailures: 1, checkPassRate: 0.75, total: 6, errors: 1 },
      { fixture: 'b', runs: 1, firstAttemptFailures: 1, checkPassRate: 1, total: 7, errors: 0 },
    ])
    expect(formatSummary(summary)).toContain('a  2  1.00  0.75  6.00  1')
  })

  it('compares two result files per fixture', () => {
    const a = { model: 'm', promptSha256: 'aaaaaaaa11', summary: summarize([run('single-sphere', 1, 0.5, 4)]) }
    const b = { model: 'm', promptSha256: 'bbbbbbbb22', summary: summarize([run('single-sphere', 0, 1, 7), run('gear', 0, 1, 7)]) }
    const text = formatComparison(a, b)
    expect(text).toContain('a: m aaaaaaaa  b: m bbbbbbbb')
    expect(text).toContain('single-sphere  1.00 → 0.00  0.50 → 1.00  4.00 → 7.00')
    expect(text).toContain('gear  - → 0.00')
  })
})
