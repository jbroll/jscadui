// `npm run describe -- --rerender`: builds again, in the sandbox, and renders each run
// whose mesh changed at --regrade (`renderStale`), before the describe stage describes it.
// With --all, also rebuilds and renders every already-rendered run, for a recalibration pass.
import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_API } from '../src/api.js'
import { complexProbe, renderRecord, settleRun } from './complex.js'
import { gradedModel } from './grade.js'
import { createRunRenderer } from './render.js'
import { summarize } from './report.js'
import { fixtureForApi, freshExecutorGrader, GRADE_LIFETIME_S, loadFixtures, requireSandbox } from './run-eval.js'
import { startExecutor } from './sandbox.js'

// Stale runs always need rendering again; `all` also catches runs already rendered, for a recalibration pass.
export const needsRerender = (run, { all = false } = {}) => Boolean(run.renderStale) || (all && run.render?.views?.length > 0 && !run.renderError)

export async function rerenderFile(file, { grader, renderer, fixturesByName }, { all = false } = {}) {
  const api = file.api ?? DEFAULT_API
  const results = []
  for (const run of file.results) {
    if (!needsRerender(run, { all })) {
      results.push(run)
      continue
    }
    const fixture = fixtureForApi(fixturesByName.get(run.fixture), api)
    if (!fixture || !Array.isArray(run.transcript)) {
      results.push({ ...run, regradeNote: 'cannot render again: the fixture or the transcript is missing' })
      continue
    }
    const graded = await grader.gradeProject(gradedModel(fixture, run.transcript), { probe: complexProbe(fixture), mesh: true })
    const { renderStale: _stale, regradeNote: _note, ...rest } = run
    if (!graded.mesh?.parts) {
      results.push(settleRun({ ...rest, renderError: graded.mesh?.error ?? 'the project no longer builds' }))
      continue
    }
    const views = await renderer.render(graded.mesh.parts, { fixture: run.fixture, run: run.run })
    results.push(settleRun({ ...rest, render: renderRecord(graded, views) }))
  }
  return { ...file, results, ...(file.summary ? { summary: summarize(results) } : {}) }
}

export const rerenderedCount = (before, after, { all = false } = {}) =>
  after.results.filter((r, i) => needsRerender(before.results[i], { all }) && !r.renderStale && !r.renderError).length

export async function rerenderFiles(paths, env, { all = false } = {}) {
  const candidates = paths.filter((path) => JSON.parse(readFileSync(path, 'utf8')).results?.some((r) => needsRerender(r, { all })))
  if (candidates.length === 0) return 0
  const sandbox = await requireSandbox(env)
  const fixturesByName = new Map((await loadFixtures()).map((f) => [f.name, f]))
  let count = 0
  for (const path of candidates) {
    const file = JSON.parse(readFileSync(path, 'utf8'))
    const api = file.api ?? DEFAULT_API
    const grader = freshExecutorGrader(() => startExecutor({ api, sandbox, lifetimeS: GRADE_LIFETIME_S }))
    const renderer = createRunRenderer(path)
    try {
      const next = await rerenderFile(file, { grader, renderer, fixturesByName }, { all })
      writeFileSync(path, JSON.stringify(next, null, 2))
      count += rerenderedCount(file, next, { all })
    } finally {
      await renderer.close()
    }
  }
  return count
}
