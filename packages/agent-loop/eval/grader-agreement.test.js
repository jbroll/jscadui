import { describe, expect, it } from 'vitest'
import { formatAgreement, graderAgreement } from './grader-agreement.js'

const file = (results) => ({ suite: 'complex', results })
const run = (overrides = {}) => ({ fixture: 'caboose', run: 1, ...overrides })

describe('graderAgreement', () => {
  it('agrees when the verdict matches the label, disagrees when it does not', () => {
    const files = new Map([
      ['a.json', file([run({ verdict: { success: true, votes: [3, 0] } })])],
      ['b.json', file([run({ verdict: { success: false, votes: [0, 3] } })])],
    ])
    const labels = [
      { file: 'a.json', fixture: 'caboose', run: 1, expected: 'success' },
      { file: 'b.json', fixture: 'caboose', run: 1, expected: 'success', note: 'should pass' },
    ]
    const result = graderAgreement(labels, files)
    expect(result.rows).toEqual([
      { ...labels[0], verdict: 'success', reason: null, agree: true },
      { ...labels[1], verdict: 'failure', reason: null, agree: false },
    ])
    expect(result.labelled).toBe(2)
    expect(result.agreeCount).toBe(1)
    expect(result.disagreements).toEqual([result.rows[1]])
  })

  it('reports a label whose result file is missing, without crashing', () => {
    const labels = [{ file: 'missing.json', fixture: 'caboose', run: 1, expected: 'success' }]
    const result = graderAgreement(labels, new Map())
    expect(result.rows[0]).toMatchObject({ verdict: null, agree: null })
    expect(result.rows[0].reason).toMatch(/no result file/)
    expect(result.agreeCount).toBe(0)
  })

  it('reports a label whose run is missing from an existing file', () => {
    const files = new Map([['a.json', file([run({ run: 2, verdict: { success: true, votes: [3, 0] } })])]])
    const labels = [{ file: 'a.json', fixture: 'caboose', run: 1, expected: 'success' }]
    const result = graderAgreement(labels, files)
    expect(result.rows[0].reason).toMatch(/run caboose#1 not found/)
    expect(result.rows[0].verdict).toBeNull()
  })

  it('names why a run has no verdict: not judged, no majority, not described, not rendered', () => {
    const rendered = { render: { views: [{ name: 'iso-front' }] } }
    const files = new Map([
      ['a.json', file([run({ ...rendered, description: { text: 'x' } })])],
      ['b.json', file([run({ ...rendered, description: { text: 'x' }, graderError: true })])],
      ['c.json', file([run({})])],
      ['d.json', file([run({ ...rendered, renderStale: true })])],
    ])
    const labels = [
      { file: 'a.json', fixture: 'caboose', run: 1, expected: 'success' },
      { file: 'b.json', fixture: 'caboose', run: 1, expected: 'success' },
      { file: 'c.json', fixture: 'caboose', run: 1, expected: 'success' },
      { file: 'd.json', fixture: 'caboose', run: 1, expected: 'success' },
    ]
    const result = graderAgreement(labels, files)
    expect(result.rows.map((r) => r.reason)).toEqual(['not judged', 'no majority (graderError)', 'not rendered', 'renderStale'])
  })

  it('formats per-label lines, the agreement count, and the disagreements', () => {
    const files = new Map([
      ['a.json', file([run({ verdict: { success: true, votes: [3, 0] } })])],
      ['b.json', file([run({ verdict: { success: false, votes: [0, 3] } })])],
    ])
    const labels = [
      { file: 'a.json', fixture: 'caboose', run: 1, expected: 'success' },
      { file: 'b.json', fixture: 'caboose', run: 1, expected: 'success', note: 'should pass' },
    ]
    const text = formatAgreement(graderAgreement(labels, files))
    expect(text).toContain('a.json caboose#1: expected success, verdict success — agree')
    expect(text).toContain('b.json caboose#1: expected success, verdict failure — disagree')
    expect(text).toContain('1/2 agree')
    expect(text).toContain('Disagreements:')
    expect(text).toContain('should pass')
  })
})
