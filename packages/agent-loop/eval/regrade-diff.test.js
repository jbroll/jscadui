import { describe, expect, it } from 'vitest'
import { formatRegradeDiff, regradeDiff } from './regrade-diff.js'

const report = (overrides = {}) => ({ dimensions: { discipline: 2, recovery: 2, geometry: 2, conservation: 2 }, total: 8, firstAttemptFailures: 0, checkRate: 1, ...overrides })

const run = (overrides = {}) => ({ fixture: 'cube-hole', run: 1, report: report(), metrics: { geometryError: 0.1 }, ...overrides })

const file = (results, extra = {}) => ({ results, ...extra })

describe('regradeDiff', () => {
  it('is empty when nothing changed', () => {
    expect(regradeDiff(file([run()]), file([run()]))).toEqual([])
  })

  it('reports a changed report field', () => {
    const changes = regradeDiff(file([run()]), file([run({ report: report({ total: 7 }) })]))
    expect(changes).toEqual([{ run: 'cube-hole#1', fields: [{ field: 'report', before: report(), after: report({ total: 7 }) }] }])
  })

  it('reports a changed metrics.geometryError', () => {
    const changes = regradeDiff(file([run()]), file([run({ metrics: { geometryError: 0.2 } })]))
    expect(changes).toEqual([{ run: 'cube-hole#1', fields: [{ field: 'metrics.geometryError', before: 0.1, after: 0.2 }] }])
  })

  it('reports error and providerError appearing or disappearing', () => {
    const changes = regradeDiff(file([run()]), file([run({ error: 'empty provider reply', providerError: true })]))
    expect(changes).toEqual([
      {
        run: 'cube-hole#1',
        fields: [
          { field: 'error', before: undefined, after: 'empty provider reply' },
          { field: 'providerError', before: undefined, after: true },
        ],
      },
    ])
  })

  it('reports gates, verdict, verdictPending and renderStale for a complex run', () => {
    const before = run({ gates: [{ name: 'connected', pass: true }], verdict: { success: true, votes: [2, 1] }, verdictPending: undefined })
    const after = run({ gates: [{ name: 'connected', pass: false }], verdict: null, verdictPending: true, renderStale: true })
    const changes = regradeDiff(file([before]), file([after]))
    expect(changes).toEqual([
      {
        run: 'cube-hole#1',
        fields: [
          { field: 'gates', before: [{ name: 'connected', pass: true }], after: [{ name: 'connected', pass: false }] },
          { field: 'verdict', before: { success: true, votes: [2, 1] }, after: null },
          { field: 'verdictPending', before: undefined, after: true },
          { field: 'renderStale', before: undefined, after: true },
        ],
      },
    ])
  })

  it('ignores regradedAt, summary, speed and regradeNote', () => {
    const before = file([run()], { summary: [{ fixture: 'cube-hole', total: 8 }], speed: { wallSeconds: 1 } })
    const after = file([run({ regradeNote: 'stale' })], { regradedAt: '2026-01-01T00:00:00Z', summary: [{ fixture: 'cube-hole', total: 1 }], speed: { wallSeconds: 99 } })
    expect(regradeDiff(before, after)).toEqual([])
  })

  it('reports a run present only in the original file', () => {
    const changes = regradeDiff(file([run(), run({ fixture: 'other' })]), file([run()]))
    expect(changes).toEqual([{ run: 'other#1', only: 'original' }])
  })

  it('reports a run present only in the regraded file', () => {
    const changes = regradeDiff(file([run()]), file([run(), run({ fixture: 'other' })]))
    expect(changes).toEqual([{ run: 'other#1', only: 'regraded' }])
  })

  it('reports a changed renderError or description text for a complex run', () => {
    const before = run({ description: { text: 'a cube', views: [] } })
    const after = run({ renderError: 'render failed: no chromium', description: null })
    const changes = regradeDiff(file([before]), file([after]))
    expect(changes).toEqual([
      {
        run: 'cube-hole#1',
        fields: [
          { field: 'renderError', before: undefined, after: 'render failed: no chromium' },
          { field: 'description.text', before: 'a cube', after: undefined },
        ],
      },
    ])
  })

  it('matches runs by fixture and run number, not array position', () => {
    const before = file([run({ fixture: 'a' }), run({ fixture: 'b' })])
    const after = file([run({ fixture: 'b', report: report({ total: 1 }) }), run({ fixture: 'a' })])
    const changes = regradeDiff(before, after)
    expect(changes).toEqual([{ run: 'b#1', fields: [{ field: 'report', before: report(), after: report({ total: 1 }) }] }])
  })
})

describe('formatRegradeDiff', () => {
  it('prints one line per changed run, old to new, with a final count', () => {
    const changes = [
      { run: 'cube-hole#1', fields: [{ field: 'report', before: report(), after: report({ total: 7 }) }] },
      { run: 'other#2', fields: [{ field: 'error', before: undefined, after: 'x' }] },
    ]
    const text = formatRegradeDiff(changes)
    expect(text).toContain('cube-hole#1: report')
    expect(text).toContain('other#2: error')
    expect(text.split('\n').at(-1)).toBe('2 runs changed')
  })

  it('reports zero runs changed', () => {
    expect(formatRegradeDiff([])).toBe('0 runs changed')
  })

  it('prints which file a one-sided run is only in', () => {
    const text = formatRegradeDiff([{ run: 'other#1', only: 'original' }])
    expect(text).toContain('other#1: only in the original file')
  })
})
