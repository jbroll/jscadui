// Usage: node eval/grader-agreement.js <labels.json> <result files…>
// Calibration check (docs/superpowers/plans/2026-09-30-grader-calibration.md, Task 4):
// compares the complex grader's verdicts with a reviewed label set.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { isMainModule } from '../src/mainModule.js'

const verdictOf = (run) => (run.verdict ? (run.verdict.success ? 'success' : 'failure') : null)

// Why a run that exists has no verdict yet, in the order the stages run.
const noVerdictReason = (run) => {
  if (run.graderError) return 'no majority (graderError)'
  if (run.renderStale) return 'renderStale'
  if (!(run.render?.views?.length > 0)) return 'not rendered'
  if (typeof run.description?.text !== 'string') return 'not described'
  return 'not judged'
}

// One row per label: the run's verdict (or why it has none) and whether it agrees with `expected`.
export function graderAgreement(labels, filesByName) {
  const rows = labels.map((label) => {
    const file = filesByName.get(label.file)
    if (!file) return { ...label, verdict: null, reason: `no result file named ${label.file}`, agree: null }
    const run = file.results?.find((r) => r.fixture === label.fixture && r.run === label.run)
    if (!run) return { ...label, verdict: null, reason: `run ${label.fixture}#${label.run} not found in ${label.file}`, agree: null }
    const verdict = verdictOf(run)
    if (verdict == null) return { ...label, verdict: null, reason: noVerdictReason(run), agree: null }
    return { ...label, verdict, reason: null, agree: verdict === label.expected }
  })
  const labelled = rows.length
  const agreeCount = rows.filter((r) => r.agree === true).length
  const disagreements = rows.filter((r) => r.agree === false)
  return { rows, labelled, agreeCount, disagreements }
}

export function formatAgreement({ rows, labelled, agreeCount, disagreements }) {
  const lines = rows.map((r) => {
    const where = `${r.file} ${r.fixture}#${r.run}`
    return r.verdict == null ? `${where}: expected ${r.expected}, no verdict (${r.reason})` : `${where}: expected ${r.expected}, verdict ${r.verdict} — ${r.agree ? 'agree' : 'disagree'}`
  })
  lines.push(`${agreeCount}/${labelled} agree`)
  if (disagreements.length) {
    lines.push('Disagreements:')
    for (const d of disagreements) lines.push(`  ${d.file} ${d.fixture}#${d.run}: expected ${d.expected}, verdict ${d.verdict}${d.note ? ` (${d.note})` : ''}`)
  }
  return lines.join('\n')
}

const USAGE = 'Usage: node eval/grader-agreement.js <labels.json> <result files…>'

// Always exits 0: this reports agreement, it does not gate a build.
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
