import { describe, it, expect } from 'vitest'
import { diffAgainstBaseline, toFailure } from '../e2e/baseline-diff.mjs'

const base = (...failures) => ({ failures })

describe('diffAgainstBaseline', () => {
  it('passes a run that matches the baseline', () => {
    const d = diffAgainstBaseline(base({ rel: 'a.scad', status: 'error' }), [
      { rel: 'a.scad', status: 'error' },
      { rel: 'b.scad', status: 'ok' },
    ])
    expect(d).toEqual({ regressions: [], fixed: [] })
  })

  it('flags a model that newly fails', () => {
    const d = diffAgainstBaseline(base(), [{ rel: 'b.scad', status: 'timeout' }])
    expect(d.regressions).toEqual(['new timeout: b.scad'])
  })

  it('flags a status change such as error to timeout', () => {
    const d = diffAgainstBaseline(base({ rel: 'a.scad', status: 'error' }), [{ rel: 'a.scad', status: 'timeout' }])
    expect(d.regressions).toEqual(['error -> timeout: a.scad'])
  })

  it('flags an empty result that the baseline does not record', () => {
    const d = diffAgainstBaseline(base(), [{ rel: 'a.scad', status: 'empty' }])
    expect(d.regressions).toEqual(['new empty: a.scad'])
  })

  it('reports a fixed model without failing the run', () => {
    const d = diffAgainstBaseline(base({ rel: 'a.scad', status: 'error' }), [{ rel: 'a.scad', status: 'ok' }])
    expect(d).toEqual({ regressions: [], fixed: ['a.scad (was error)'] })
  })

  it('ignores baseline entries the run did not cover', () => {
    const d = diffAgainstBaseline(base({ rel: 'a.scad', status: 'error' }), [])
    expect(d).toEqual({ regressions: [], fixed: [] })
  })

  it('flags a new dead cell in a grid that was already partial', () => {
    const d = diffAgainstBaseline(
      base({ rel: 'x/ALL.js', status: 'partial', cells: ['./a.scad: boom'] }),
      [{ rel: 'x/ALL.js', status: 'partial', cellFailures: ['./a.scad: other message', './b.scad: bang'] }],
    )
    expect(d.regressions).toEqual(['new dead cell in x/ALL.js: ./b.scad'])
  })

  it('reports a recovered cell as fixed', () => {
    const d = diffAgainstBaseline(
      base({ rel: 'x/ALL.js', status: 'partial', cells: ['./a.scad: boom', './b.scad: bang'] }),
      [{ rel: 'x/ALL.js', status: 'partial', cellFailures: ['./a.scad: boom'] }],
    )
    expect(d).toEqual({ regressions: [], fixed: ['x/ALL.js: cell ./b.scad'] })
  })

  it('accepts either outcome for a flaky entry', () => {
    const b = base({ rel: 'a.scad', status: 'timeout', flaky: true })
    expect(diffAgainstBaseline(b, [{ rel: 'a.scad', status: 'ok' }])).toEqual({ regressions: [], fixed: [] })
    expect(diffAgainstBaseline(b, [{ rel: 'a.scad', status: 'timeout' }])).toEqual({ regressions: [], fixed: [] })
  })
})

describe('toFailure', () => {
  it('records cells and the reason only when present', () => {
    expect(toFailure({ rel: 'a', status: 'error', errText: '', cellFailures: [] })).toEqual({ rel: 'a', status: 'error' })
    expect(toFailure({ rel: 'g', status: 'partial', errText: 'why', cellFailures: ['./c: m'] }))
      .toEqual({ rel: 'g', status: 'partial', cells: ['./c: m'], why: 'why' })
  })
})
