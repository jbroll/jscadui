import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { settleRun } from './complex.js'
import { compareSuites, regradeResults, resultFileName, runSuite, saveResults, selectFixtures } from './run-eval.js'
import { VIEWS } from './views.js'

const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'
const BROKEN = 'module.exports = { main: () => { throw new Error("nope") } }'

const fixture = {
  name: 'cube',
  group: 'complex',
  prompt: 'a cube please',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  gates: (m) => [{ name: 'about 20 mm', pass: Math.abs((m?.dimensions?.[0] ?? 0) - 20) < 1 }],
}

const writes = (content) => {
  const rounds = [
    [{ type: 'tool_use', id: 't1', name: 'write', input: { path: 'main.js', content } }, { type: 'done', stopReason: 'tool_use' }],
    [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
  ]
  return {
    async *send() {
      for (const event of rounds.shift() ?? []) yield event
    },
  }
}

const fakeRender = () => {
  const calls = []
  return {
    calls,
    render: async (parts, where) => {
      calls.push({ parts, where })
      return VIEWS.map((v) => ({ name: v.name, path: `r.renders/${where.fixture}-${where.run}/${v.name}.png`, sha256: 'f'.repeat(64) }))
    },
  }
}

const judged = (run, meshSha256 = run.render.meshSha256) =>
  settleRun({
    ...run,
    render: { ...run.render, meshSha256 },
    description: { text: 'side view: a grey cube', views: [] },
    votes: [{ success: true, reason: 'a cube', ms: 1 }],
    verdict: { success: true, votes: [3, 0] },
  })

describe('a complex run', () => {
  it('stores gates, renders and a pending verdict', async () => {
    const renders = fakeRender()
    const [result] = await runSuite([fixture], { provider: writes(CUBE), backend: createEvalBackend(), render: renders.render })
    expect(result.gates).toEqual([
      { name: 'builds', pass: true },
      { name: 'watertight', pass: true },
      { name: 'connected', pass: true, groups: 1 },
      { name: 'about 20 mm', pass: true },
    ])
    expect(result.userMessages).toEqual(['a cube please'])
    expect(result.render.facts).toEqual({ dimensions: [20, 20, 20], bodies: 1 })
    expect(result.render.meshSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.render.views.map((v) => v.name)).toEqual(VIEWS.map((v) => v.name))
    expect(renders.calls[0].where).toEqual({ fixture: 'cube', run: 1 })
    expect(renders.calls[0].parts[0].positions.length).toBe(12 * 9)
    expect(result.verdictPending).toBe(true)
    expect(result.description).toBeNull()
    expect(result.verdict).toBeNull()
    expect(result.report.dimensions.geometry).toBe(0)
    expect(result.report.checkRate).toBeCloseTo(4 / 5)
  })

  it('renders nothing and settles at geometry 0 when the project does not build', async () => {
    const renders = fakeRender()
    const [result] = await runSuite([fixture], { provider: writes(BROKEN), backend: createEvalBackend(), render: renders.render })
    expect(result.gates[0]).toEqual({ name: 'builds', pass: false })
    expect(renders.calls).toEqual([])
    expect(result.verdictPending).toBeUndefined()
    expect(result.report.dimensions.geometry).toBe(0)
  })

  it('records a failed render as renderError', async () => {
    const render = async () => {
      throw new Error('no chromium')
    }
    const [result] = await runSuite([fixture], { provider: writes(CUBE), backend: createEvalBackend(), render })
    expect(result.renderError).toBe('render failed: no chromium')
    expect(result.verdictPending).toBeUndefined()
  })

  // gradeInFreshExecutor asks for the mesh only after a measure, so a failed measure brings no `mesh` key.
  const gradedAs = (change) => {
    const backend = createEvalBackend()
    return {
      ...backend,
      gradeProject: async (model, options) => {
        const { mesh: _mesh, ...graded } = await backend.gradeProject(model, options)
        return change(graded)
      },
    }
  }

  it('fails the builds gate, not the render, when the measure failed', async () => {
    const renders = fakeRender()
    const backend = gradedAs((graded) => ({ ...graded, measure: null }))
    const [result] = await runSuite([fixture], { provider: writes(CUBE), backend, render: renders.render })
    expect(result.gates[0]).toEqual({ name: 'builds', pass: false })
    expect(renders.calls).toEqual([])
    expect(result).not.toHaveProperty('renderError')
    expect(result.verdictPending).toBeUndefined()
    expect(result.report.dimensions.geometry).toBe(0)
  })

  it('records a measured grade that brought no mesh as renderError', async () => {
    const renders = fakeRender()
    const [result] = await runSuite([fixture], { provider: writes(CUBE), backend: gradedAs((graded) => graded), render: renders.render })
    expect(result.gates[0]).toEqual({ name: 'builds', pass: true })
    expect(renders.calls).toEqual([])
    expect(result.renderError).toBe('no mesh came back with the grade')
    expect(result.verdictPending).toBeUndefined()
  })
})

describe('--regrade of a complex run', () => {
  const regrade = (run, backend) => regradeResults({ model: 'm', api: 'fluent', suite: 'complex', results: [run] }, new Map([[fixture.name, fixture]]), { grader: backend })

  it('keeps the verdict while the rebuilt mesh is the one that was judged', async () => {
    const backend = createEvalBackend()
    const [stored] = await runSuite([fixture], { provider: writes(CUBE), backend, render: fakeRender().render })
    const run = judged(stored)
    expect(run.report.dimensions.geometry).toBe(2)
    const {
      results: [out],
    } = await regrade(run, backend)
    expect(out.verdict).toEqual({ success: true, votes: [3, 0] })
    expect(out.votes).toHaveLength(1)
    expect(out.report.dimensions.geometry).toBe(2)
    expect(out.verdictPending).toBeUndefined()
    expect(out.regradeNote).toBeUndefined()
  })

  it('clears the verdict and marks the renders stale when the mesh changed', async () => {
    const backend = createEvalBackend()
    const [stored] = await runSuite([fixture], { provider: writes(CUBE), backend, render: fakeRender().render })
    const {
      results: [out],
    } = await regrade(judged(stored, '0'.repeat(64)), backend)
    expect(out.verdict).toBeNull()
    expect(out.description).toBeNull()
    expect(out).not.toHaveProperty('votes')
    expect(out.renderStale).toBe(true)
    expect(out.verdictPending).toBe(true)
    expect(out.regradeNote).toMatch(/mesh changed/)
    expect(out.render.meshSha256).toBe(stored.render.meshSha256)
    expect(out.render.views).toEqual(stored.render.views)
    expect(out.report.dimensions.geometry).toBe(0)
  })

  it('keeps the renders stale through a second regrade', async () => {
    const backend = createEvalBackend()
    const [stored] = await runSuite([fixture], { provider: writes(CUBE), backend, render: fakeRender().render })
    const {
      results: [once],
    } = await regrade(judged(stored, '0'.repeat(64)), backend)
    const {
      results: [twice],
    } = await regrade(once, backend)
    expect(twice.renderStale).toBe(true)
    expect(twice.verdictPending).toBe(true)
    expect(twice.regradeNote).toMatch(/mesh changed/)
    expect(twice.render).toEqual(once.render)
  })

  it('marks a run that was never rendered, and keeps it marked', async () => {
    const backend = createEvalBackend()
    const failing = async () => {
      throw new Error('no chromium')
    }
    const [stored] = await runSuite([fixture], { provider: writes(CUBE), backend, render: failing })
    const {
      results: [once],
    } = await regrade(stored, backend)
    expect(once).not.toHaveProperty('renderError')
    expect(once.renderStale).toBe(true)
    expect(once.verdictPending).toBe(true)
    expect(once.regradeNote).toMatch(/never rendered/)
    expect(once.render.views).toEqual([])
    const {
      results: [twice],
    } = await regrade(once, backend)
    expect(twice.renderStale).toBe(true)
    expect(twice.regradeNote).toMatch(/never rendered/)
  })

  const regradeAgainst = (run, changed, backend) =>
    regradeResults({ model: 'm', api: 'fluent', suite: 'complex', results: [run] }, new Map([[changed.name, changed]]), { grader: backend })

  it('keeps both notes when the prompt changed and the project no longer builds', async () => {
    const backend = createEvalBackend()
    const [stored] = await runSuite([fixture], { provider: writes(CUBE), backend, render: fakeRender().render })
    const unsaved = { ...stored, transcript: stored.transcript.filter((m) => m.role === 'user') }
    const {
      results: [out],
    } = await regradeAgainst(unsaved, { ...fixture, prompt: 'a sphere please' }, backend)
    expect(out.regradeNote).toMatch(/no longer builds/)
    expect(out.regradeNote).toMatch(/prompt differs/)
  })

  it('reads a changed follow-up as a different prompt', async () => {
    const backend = createEvalBackend()
    const [stored] = await runSuite([fixture], { provider: writes(CUBE), backend, render: fakeRender().render })
    const {
      results: [out],
    } = await regradeAgainst(judged(stored), { ...fixture, followUps: [{ message: 'make it red' }] }, backend)
    expect(out.regradeNote).toMatch(/prompt differs/)
  })
})

describe('complex result files', () => {
  it('runs the complex group only when named', () => {
    const fixtures = [{ name: 'a' }, { name: 'c', group: 'complex', gates: () => [] }]
    expect(selectFixtures(fixtures, null).map((f) => f.name)).toEqual(['a'])
    expect(selectFixtures(fixtures, ['all']).map((f) => f.name)).toEqual(['a'])
    expect(selectFixtures(fixtures, ['complex']).map((f) => f.name)).toEqual(['c'])
  })

  it('names a complex pass apart from a single-shot one', () => {
    const now = new Date('2026-10-01T12:00:00.123Z')
    expect(resultFileName('m', 'fluent', 'abcdef1234', now)).toBe('2026-10-01T120000Z-m-fluent-abcdef12.json')
    expect(resultFileName('m', 'fluent', 'abcdef1234', now, 'complex')).toBe('2026-10-01T120000Z-m-fluent-complex-abcdef12.json')
  })

  it('writes suite only for a complex pass', () => {
    const written = []
    const write = (_path, text) => written.push(JSON.parse(text))
    const base = { model: 'm', provider: 'p', api: 'fluent', runs: 1, promptSha256: 'x', results: [] }
    saveResults(write, 'a.json', { ...base, suite: 'complex' })
    saveResults(write, 'b.json', base)
    expect(written[0].suite).toBe('complex')
    expect(written[1]).not.toHaveProperty('suite')
  })

  it('compares complex files only with the same describer and judge', () => {
    const file = { suite: 'complex', describer: { model: 'md', promptSha256: 'a' }, judge: { model: 'ds', promptSha256: 'b' } }
    expect(compareSuites({}, {})).toEqual({})
    expect(compareSuites(file, file)).toEqual({})
    expect(compareSuites(file, {}).error).toMatch(/complex result with a single-shot/)
    expect(compareSuites(file, { ...file, judge: { model: 'ds', promptSha256: 'c' } }).error).toMatch(/judge/)
    expect(compareSuites(file, { ...file, describer: { model: 'other', promptSha256: 'a' } }).error).toMatch(/describer/)
  })
})
