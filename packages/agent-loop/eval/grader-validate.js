// Usage: npm run grader-validate -w @jscadui/agent-loop [-- --until render]
// Builds and renders each case in eval/grader-validation/cases.js in the crt sandbox (docs/user-manual.md, Grader validation).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isMainModule } from '../src/mainModule.js'
import { harnessGates, renderRecord, settleRun } from './complex.js'
import { CASES } from './grader-validation/cases.js'
import { createRunRenderer } from './render.js'
import { fileStamp, GRADE_LIFETIME_S, requireSandbox } from './run-eval.js'
import { gradeInFreshExecutor } from './sandboxed-backend.js'
import { startExecutor } from './sandbox.js'

export const STAGES = ['render']
const DEFAULT_DIR = join(homedir(), '.local', 'state', 'jscad-chat', 'grader-validation')

export const validationRun = async (c, graded, render) => {
  const gates = harnessGates(graded, c.pieces ?? 1)
  const run = { fixture: c.name, run: 1, expected: c.expected, userMessages: c.messages, gates, description: null, verdict: null }
  if (!graded.mesh?.parts) return settleRun({ ...run, renderError: graded.mesh?.error ?? 'the case did not build' })
  return settleRun({ ...run, render: renderRecord(graded, await render(graded.mesh.parts, { fixture: c.name, run: 1 })) })
}

export const expectedMatch = (run) => {
  if (run.expected === 'known-miss') return null
  if (run.expected === 'gate') return run.gates.find((g) => g.name === 'connected')?.pass === false
  if (!run.verdict) return false
  return run.verdict.success === (run.expected === 'pass')
}

const verdictText = (run) => (run.verdict ? (run.verdict.success ? 'SUCCESS' : 'FAILURE') : run.graderError ? 'split' : '-')

const matchText = (run, judged) => {
  if (!judged && run.expected !== 'gate') return '-'
  const match = expectedMatch(run)
  return match === null ? 'not scored' : match ? 'yes' : 'NO'
}

export const formatValidation = (runs, { judged = true } = {}) => {
  const lines = ['case  expected  failed gates  verdict  votes  match']
  for (const run of runs) {
    const failed = run.gates.filter((g) => !g.pass).map((g) => g.name).join(',') || '-'
    lines.push(`${run.fixture}  ${run.expected}  ${failed}  ${verdictText(run)}  ${run.verdict?.votes?.join('-') ?? '-'}  ${matchText(run, judged)}`)
  }
  for (const run of runs) {
    if (run.description?.text) lines.push('', `${run.fixture}:`, run.description.text)
    else if (run.render?.views?.length) lines.push('', `${run.fixture}: ${dirname(run.render.views[0].path)}`)
    else if (run.renderError) lines.push('', `${run.fixture}: ${run.renderError}`)
  }
  return lines.join('\n')
}

const modelOf = (c) => (c.files ? { files: c.files, entry: c.entry } : { files: { 'main.js': c.source }, entry: 'main.js' })

const main = async (argv, env) => {
  const at = argv.indexOf('--until')
  const until = at === -1 ? STAGES.at(-1) : argv[at + 1]
  if (!STAGES.includes(until)) {
    console.error(`grader-validate: --until takes ${STAGES.join(', ')}`)
    process.exit(1)
  }
  const sandbox = await requireSandbox(env)
  const dir = env.GRADER_VALIDATION_DIR || DEFAULT_DIR
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${fileStamp()}-grader-validation.json`)
  const renderer = createRunRenderer(path)
  const results = []
  try {
    for (const c of CASES) {
      const api = c.api ?? 'fluent'
      const graded = await gradeInFreshExecutor(() => startExecutor({ api, sandbox, lifetimeS: GRADE_LIFETIME_S }), modelOf(c), { probe: { bodies: {} }, mesh: true })
      results.push(await validationRun(c, graded, renderer.render))
    }
  } finally {
    await renderer.close()
  }
  writeFileSync(path, JSON.stringify({ suite: 'complex', validation: true, date: new Date().toISOString(), results }, null, 2))
  console.log(`grader-validate: wrote ${path}`)
  const final = JSON.parse(readFileSync(path, 'utf8')).results
  const judged = until === 'judge'
  console.log(formatValidation(final, { judged }))
  if (final.some((run) => (judged || run.expected === 'gate') && expectedMatch(run) === false)) process.exitCode = 1
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
