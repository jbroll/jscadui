// Usage: node eval/grader-agreement.js <labels.json> <result files…>
// Compares the complex grader's outcomes with a reviewed label set (docs/user-manual.md, Grader agreement).
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { isMainModule } from '../src/mainModule.js'

const verdictOf = (run) => (run.verdict ? (run.verdict.success ? 'success' : 'failure') : null)

const failedGatesOf = (run) => (run.gates ?? []).filter((g) => !g.pass).map((g) => g.name)

// The grader's outcome: success only when the verdict agreed AND every gate passed (geometry 2, eval/complex.js).
const outcomeOf = (run) => (verdictOf(run) === 'success' && failedGatesOf(run).length === 0 ? 'success' : 'failure')

// Why a run that exists has no verdict yet, in the order the stages run.
const noVerdictReason = (run) => {
  if (run.graderError) return 'no majority (graderError)'
  if (run.renderStale) return 'renderStale'
  if (!(run.render?.views?.length > 0)) return 'not rendered'
  if (typeof run.description?.text !== 'string') return 'not described'
  return 'not judged'
}

// One row per label: the run's verdict and failed gates, its outcome's agreement with `expected`,
// or why it has no verdict yet.
export function graderAgreement(labels, filesByName) {
  const rows = labels.map((label) => {
    const file = filesByName.get(label.file)
    if (!file) return { ...label, verdict: null, failedGates: [], reason: `no result file named ${label.file}`, agree: null }
    const run = file.results?.find((r) => r.fixture === label.fixture && r.run === label.run)
    if (!run) return { ...label, verdict: null, failedGates: [], reason: `run ${label.fixture}#${label.run} not found in ${label.file}`, agree: null }
    const verdict = verdictOf(run)
    if (verdict == null) return { ...label, verdict: null, failedGates: [], reason: noVerdictReason(run), agree: null }
    return { ...label, verdict, failedGates: failedGatesOf(run), reason: null, agree: outcomeOf(run) === label.expected }
  })
  const labelled = rows.length
  const agreeCount = rows.filter((r) => r.agree === true).length
  const disagreements = rows.filter((r) => r.agree === false)
  return { rows, labelled, agreeCount, disagreements }
}

export function formatAgreement({ rows, labelled, agreeCount, disagreements }) {
  const gatesText = (r) => (r.failedGates.length ? `failed gates: ${r.failedGates.join(', ')}` : 'gates ok')
  const lines = rows.map((r) => {
    const where = `${r.file} ${r.fixture}#${r.run}`
    return r.verdict == null
      ? `${where}: expected ${r.expected}, no verdict (${r.reason})`
      : `${where}: expected ${r.expected}, verdict ${r.verdict}, ${gatesText(r)} — ${r.agree ? 'agree' : 'disagree'}`
  })
  lines.push(`${agreeCount}/${labelled} agree`)
  if (disagreements.length) {
    lines.push('Disagreements:')
    for (const d of disagreements) lines.push(`  ${d.file} ${d.fixture}#${d.run}: expected ${d.expected}, verdict ${d.verdict}, ${gatesText(d)}${d.note ? ` (${d.note})` : ''}`)
  }
  return lines.join('\n')
}

const USAGE = 'Usage: node eval/grader-agreement.js <labels.json> <result files…>'

// Exits 0 after reporting (a report, not a gate); 1 only on bad usage (missing arguments).
const main = (argv) => {
  const [labelsPath, ...resultPaths] = argv
  if (!labelsPath || resultPaths.length === 0) {
    console.error(USAGE)
    process.exit(1)
  }
  const labels = JSON.parse(readFileSync(labelsPath, 'utf8'))
  const filesByName = new Map(resultPaths.map((path) => [basename(path), JSON.parse(readFileSync(path, 'utf8'))]))
  console.log(formatAgreement(graderAgreement(labels, filesByName)))
}

if (isMainModule(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2))
}
