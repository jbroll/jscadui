import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { summarize } from './report.js'
import { needsRerender, rerenderedCount, rerenderFile } from './rerender.js'
import { VIEWS } from './views.js'

const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 })] }'
const BROKEN = 'module.exports = { main: () => { throw new Error("nope") } }'
const fixture = { name: 'cube', group: 'complex', prompt: 'a cube please', requires: ['write'], verifyBeforeWrite: false, maxTurns: 8, gates: () => [] }
const transcript = [
  { role: 'user', content: 'a cube please' },
  { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'write', input: { path: 'main.js', content: CUBE } }] },
  { role: 'tool', toolCallId: 't1', content: JSON.stringify({ ok: true }) },
  { role: 'assistant', content: 'done', toolCalls: [] },
]
const stale = {
  fixture: 'cube',
  run: 1,
  transcript,
  gates: [{ name: 'builds', pass: true }],
  report: { dimensions: { discipline: 2, recovery: 2, geometry: 0, conservation: 2 }, total: 6, firstAttemptFailures: 0, checkRate: 0.5 },
  render: { meshSha256: 'new', facts: { dimensions: [20, 20, 20], bodies: 1 }, views: [] },
  renderStale: true,
  regradeNote: 'the mesh changed; its renders and verdict are stale',
  description: null,
  verdict: null,
  verdictPending: true,
}
const renderer = () => {
  const calls = []
  return {
    calls,
    render: async (_parts, where) => {
      calls.push(where)
      return VIEWS.map((v) => ({ name: v.name, path: `r.renders/${where.fixture}-${where.run}/${v.name}.png`, sha256: 'c'.repeat(64) }))
    },
  }
}

describe('rerenderFile', () => {
  it('renders a stale run again and leaves it waiting for a description', async () => {
    const r = renderer()
    const file = { suite: 'complex', api: 'fluent', results: [stale, { ...stale, run: 2, renderStale: undefined }] }
    const out = await rerenderFile(file, { grader: createEvalBackend(), renderer: r, fixturesByName: new Map([['cube', fixture]]) })
    expect(r.calls).toEqual([{ fixture: 'cube', run: 1 }])
    const [run, untouched] = out.results
    expect(run.render.views).toHaveLength(VIEWS.length)
    expect(run.render.meshSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(run.render.facts).toEqual({ dimensions: [20, 20, 20], bodies: 1 })
    expect(run).not.toHaveProperty('renderStale')
    expect(run).not.toHaveProperty('regradeNote')
    expect(run.verdictPending).toBe(true)
    expect(untouched).toBe(file.results[1])
  })

  it('notes a run whose fixture no longer exists', async () => {
    const out = await rerenderFile({ suite: 'complex', results: [stale] }, { grader: createEvalBackend(), renderer: renderer(), fixturesByName: new Map() })
    expect(out.results[0].regradeNote).toMatch(/cannot render again/)
    expect(out.results[0].renderStale).toBe(true)
  })

  it('counts only the runs rendered again and recomputes the summary', async () => {
    const broken = { ...stale, run: 2, transcript: transcript.map((m) => (m.toolCalls?.length ? { ...m, toolCalls: [{ ...m.toolCalls[0], input: { path: 'main.js', content: BROKEN } }] } : m)) }
    const missing = { ...stale, run: 3, fixture: 'gone' }
    const file = { suite: 'complex', api: 'fluent', summary: [], results: [stale, broken, missing] }
    const out = await rerenderFile(file, { grader: createEvalBackend(), renderer: renderer(), fixturesByName: new Map([['cube', fixture]]) })
    expect(out.results[1].renderError).toBeDefined()
    expect(out.results[1].verdictPending).toBeUndefined()
    expect(rerenderedCount(file, out)).toBe(1)
    expect(out.summary).toEqual(summarize(out.results))
  })

  it('leaves an already-rendered run alone by default, and renders it again with all', async () => {
    const good = { ...stale, run: 2, renderStale: undefined, render: { meshSha256: 'old', facts: { dimensions: [20, 20, 20], bodies: 1 }, views: [{ name: 'iso-front', path: 'old.png', sha256: 'd'.repeat(64) }] } }
    expect(needsRerender(good)).toBe(false)
    expect(needsRerender(good, { all: true })).toBe(true)
    const r = renderer()
    const file = { suite: 'complex', api: 'fluent', results: [stale, good] }
    const out = await rerenderFile(file, { grader: createEvalBackend(), renderer: r, fixturesByName: new Map([['cube', fixture]]) }, { all: true })
    expect(r.calls).toEqual([{ fixture: 'cube', run: 1 }, { fixture: 'cube', run: 2 }])
    expect(out.results[1].render.meshSha256).not.toBe('old')
    expect(rerenderedCount(file, out, { all: true })).toBe(2)
    expect(rerenderedCount(file, out)).toBe(1)
  })
})
