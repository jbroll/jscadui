// Grades a saved source as the eval does, for the reference-answer tests.
import { createEvalBackend } from './backend.js'
import { fixtureForApi, loadFixtures } from './run-eval.js'

export const byName = Object.fromEntries((await loadFixtures()).map((f) => [f.name, f]))
const backends = { fluent: createEvalBackend({ api: 'fluent' }), modeling: createEvalBackend({ api: 'modeling' }) }

// The fixture's files with main.js written, then its checks.
export const grade = async (name, source, api) => {
  const fixture = fixtureForApi(byName[name], api)
  const files = { ...fixture.files, 'main.js': source }
  const graded = await backends[api].gradeProject({ files, entry: 'main.js' }, { probe: fixture.probe })
  const context = { params: graded.params, solid: graded.solid, probe: graded.probe, source: Object.values(files).join('\n') }
  return { graded, results: fixture.checks(graded.measure, context) }
}

export const failing = ({ results }) => results.filter((c) => !c.pass).map((c) => c.name)

export const startingFiles = (name, api) => fixtureForApi(byName[name], api).files['main.js']
