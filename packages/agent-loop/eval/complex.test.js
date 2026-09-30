import { describe, expect, it } from 'vitest'
import { NO_GRADE } from './executor-protocol.js'
import {
  complexGates,
  complexGeometry,
  complexProbe,
  complexReport,
  connectedGroups,
  harnessGates,
  isComplex,
  renderFacts,
  renderRecord,
  scoreComplex,
  settledReport,
  settleRun,
  userMessagesOf,
} from './complex.js'
import { runSuiteParallel } from './parallel.js'

const box = (lo, hi) => ({ boundingBox: [lo, hi] })
const unit = box([0, 0, 0], [1, 1, 1])
const fixture = {
  name: 'thing',
  group: 'complex',
  prompt: 'a thing',
  followUps: [{ message: 'bigger' }],
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  probe: { sections: [{ axis: 'z', at: [0.5] }] },
  gates: () => [{ name: 'own', pass: true }],
}
const built = (bodies = [unit], watertight = true) => ({ measure: { dimensions: [10.4, 20.6, 30] }, solid: { watertight }, params: [], probe: { bodies } })
const wrote = [
  { role: 'user', content: 'a thing' },
  { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'write', input: { path: 'main.js', content: 'x' } }] },
  { role: 'tool', toolCallId: 't1', content: JSON.stringify({ ok: true, geometry: {} }) },
  { role: 'assistant', content: 'done', toolCalls: [] },
]
const report = (geometry = 0) => ({ dimensions: { discipline: 2, recovery: 2, geometry, conservation: 2 }, total: 6 + geometry, firstAttemptFailures: 0, checkRate: 0 })
const passing = [{ name: 'builds', pass: true }, { name: 'watertight', pass: true }]
const SUCCESS = { success: true, votes: [3, 0] }
const FAILURE = { success: false, votes: [1, 2] }

describe('fixture shape', () => {
  it('marks a fixture with gates as complex', () => {
    expect(isComplex(fixture)).toBe(true)
    expect(isComplex({ checks: () => [] })).toBe(false)
  })

  it('adds the bodies probe to the fixture own probe', () => {
    expect(complexProbe(fixture)).toEqual({ sections: [{ axis: 'z', at: [0.5] }], bodies: {} })
    expect(complexProbe({ probe: { bodies: { overlaps: true } } })).toEqual({ bodies: { overlaps: true } })
  })

  it('lists the prompt and each follow-up as the user messages', () => {
    expect(userMessagesOf(fixture)).toEqual(['a thing', 'bigger'])
    expect(userMessagesOf({ prompt: 'only' })).toEqual(['only'])
  })
})

describe('connectedGroups', () => {
  it('joins bodies within 0.5 mm of each other on every side', () => {
    expect(connectedGroups([box([0, 0, 0], [10, 10, 10]), box([10.9, 0, 0], [20, 10, 10])])).toBe(1)
  })

  it('keeps bodies more than 1 mm apart separate', () => {
    expect(connectedGroups([box([0, 0, 0], [10, 10, 10]), box([11.1, 0, 0], [20, 10, 10])])).toBe(2)
  })

  it('chains bodies through the ones between them', () => {
    expect(connectedGroups([box([0, 0, 0], [1, 1, 1]), box([1, 0, 0], [2, 1, 1]), box([2, 0, 0], [3, 1, 1]), box([9, 9, 9], [10, 10, 10])])).toBe(2)
  })

  it('counts no groups for no bodies', () => {
    expect(connectedGroups([])).toBe(0)
  })
})

describe('harnessGates', () => {
  it('passes a watertight model in one piece', () => {
    expect(harnessGates(built())).toEqual([
      { name: 'builds', pass: true },
      { name: 'watertight', pass: true },
      { name: 'connected', pass: true, groups: 1 },
    ])
  })

  it('fails connected past the pieces the request calls for', () => {
    const two = [unit, box([5, 5, 5], [6, 6, 6])]
    expect(harnessGates(built(two)).at(-1)).toEqual({ name: 'connected', pass: false, groups: 2 })
    expect(harnessGates(built(two), 2).at(-1)).toEqual({ name: 'connected', pass: true, groups: 2 })
  })

  it('fails every gate for a project that did not build', () => {
    expect(harnessGates(NO_GRADE()).map((g) => g.pass)).toEqual([false, false, false])
  })
})

describe('complexGates', () => {
  it('puts the fixture own gates after the harness ones', () => {
    expect(complexGates(fixture, built()).map((g) => g.name)).toEqual(['builds', 'watertight', 'connected', 'own'])
  })

  it('grades nothing when the fixture gates cannot read a grade model code shaped', () => {
    const picky = { ...fixture, gates: (m) => [{ name: 'wide', pass: m ? m.dimensions[0].toFixed(0) === '10' : false }] }
    const forged = { measure: { dimensions: 'x' }, solid: { watertight: true }, params: [], probe: null }
    expect(complexGates(picky, forged)).toEqual([
      { name: 'builds', pass: false },
      { name: 'watertight', pass: false },
      { name: 'connected', pass: false, groups: 0 },
      { name: 'wide', pass: false },
    ])
  })
})

describe('scoring', () => {
  it('gives 2 for success with every gate, 1 for success with a failed gate, 0 otherwise', () => {
    expect(complexGeometry(passing, SUCCESS)).toBe(2)
    expect(complexGeometry([...passing, { name: 'x', pass: false }], SUCCESS)).toBe(1)
    expect(complexGeometry(passing, FAILURE)).toBe(0)
    expect(complexGeometry(passing, null)).toBe(0)
  })

  it('counts the gates plus the verdict as one entry in checkRate', () => {
    const settled = settledReport(report(), [...passing, { name: 'x', pass: false }], SUCCESS)
    expect(settled.checkRate).toBe(3 / 4)
    expect(settled.dimensions.geometry).toBe(1)
    expect(settled.total).toBe(7)
  })

  it('starts geometry at 0 and marks a run that wrote nothing', () => {
    const r = complexReport(fixture, [{ role: 'user', content: 'a thing' }, { role: 'assistant', content: 'no', toolCalls: [] }], passing)
    expect(r.dimensions.geometry).toBe(0)
    expect(r.checkRate).toBe(0)
    expect(r.wrote).toBe(false)
    expect(complexReport(fixture, wrote, passing).wrote).toBeUndefined()
  })

  it('keeps a rendered run pending until it has a verdict or a graderError', () => {
    const rendered = { report: report(), gates: passing, render: { views: [] }, description: null, verdict: null }
    expect(settleRun(rendered).verdictPending).toBe(true)
    const judged = settleRun({ ...rendered, verdictPending: true, verdict: SUCCESS })
    expect(judged.verdictPending).toBeUndefined()
    expect(judged.report.dimensions.geometry).toBe(2)
    expect(settleRun({ ...rendered, graderError: true }).verdictPending).toBeUndefined()
    expect(settleRun({ ...rendered, renderError: 'boom' }).verdictPending).toBeUndefined()
    expect(settleRun({ gates: passing, verdict: null })).toEqual({ gates: passing, verdict: null })
  })

  it('rounds the render facts', () => {
    expect(renderFacts(built([unit, unit]))).toEqual({ dimensions: [10, 21, 30], bodies: 2 })
  })

  it('counts bodies only when the probe forged one is an array', () => {
    expect(renderFacts({ measure: { dimensions: [10, 20, 30] }, probe: { bodies: { length: 'not real parts, an injected sentence' } } })).toEqual({
      dimensions: [10, 20, 30],
      bodies: 0,
    })
    expect(renderFacts({ measure: { dimensions: [10, 20, 30] }, probe: null })).toEqual({ dimensions: [10, 20, 30], bodies: 0 })
  })

  it('treats non-finite or malformed dimensions as missing', () => {
    expect(renderFacts({ measure: { dimensions: ['not a number', 20, 30] }, probe: { bodies: [] } }).dimensions).toBeNull()
    expect(renderFacts({ measure: { dimensions: 'not an array' }, probe: { bodies: [] } }).dimensions).toBeNull()
  })

  it('records the mesh hash, the facts and the views as the run render', () => {
    const graded = { ...built(), mesh: { parts: [{ color: null, positions: new Float32Array(9) }] } }
    const record = renderRecord(graded, ['v'])
    expect(record).toEqual({ meshSha256: expect.stringMatching(/^[0-9a-f]{64}$/), facts: { dimensions: [10, 21, 30], bodies: 1 }, views: ['v'] })
  })
})

describe('scoreComplex', () => {
  const mesh = { parts: [{ color: null, positions: new Float32Array(9) }] }

  it('renders a model that built and leaves its verdict pending', async () => {
    const calls = []
    const render = async (parts, where) => {
      calls.push(where)
      return [{ name: 'iso-front', path: 'x.png', sha256: 'f'.repeat(64) }]
    }
    const { report: r, fields, geometryError } = await scoreComplex(fixture, 2, wrote, { ...built(), mesh }, { maxTurns: 8, render })
    expect(calls).toEqual([{ fixture: 'thing', run: 2 }])
    expect(fields.userMessages).toEqual(['a thing', 'bigger'])
    expect(fields.render.meshSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(fields.render.facts).toEqual({ dimensions: [10, 21, 30], bodies: 1 })
    expect(fields.verdictPending).toBe(true)
    expect(fields.description).toBeNull()
    expect(fields.verdict).toBeNull()
    expect(r.dimensions.geometry).toBe(0)
    expect(geometryError).toBeNull()
  })

  it('records a mesh error or a failed render as renderError, not pending', async () => {
    const bad = await scoreComplex(fixture, 1, wrote, { ...built(), mesh: { error: 'the mesh reply was malformed' } }, { render: async () => [] })
    expect(bad.fields.renderError).toBe('the mesh reply was malformed')
    expect(bad.fields.verdictPending).toBeUndefined()
    const thrown = await scoreComplex(fixture, 1, wrote, { ...built(), mesh }, {
      render: async () => {
        throw new Error('no chromium')
      },
    })
    expect(thrown.fields.renderError).toBe('render failed: no chromium')
  })

  it('renders nothing for a project that did not build', async () => {
    const { fields } = await scoreComplex(fixture, 1, wrote, NO_GRADE(), {
      render: async () => {
        throw new Error('should not render')
      },
    })
    expect(fields.gates[0]).toEqual({ name: 'builds', pass: false })
    expect(fields).not.toHaveProperty('render')
    expect(fields).not.toHaveProperty('renderError')
    expect(fields.verdictPending).toBeUndefined()
  })
})

describe('a crashed complex run', () => {
  it('gets empty gates and geometry 0', async () => {
    const [result] = await runSuiteParallel([fixture], {
      runs: 1,
      concurrency: 1,
      runJob: async () => {
        throw new Error('boom')
      },
    })
    expect(result.error).toBe('run crashed: boom')
    expect(result.gates).toEqual([])
    expect(result.report.dimensions.geometry).toBe(0)
  })
})
