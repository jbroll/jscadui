// Usage: node eval/regrade-diff.js <original result file> <regraded copy>
// Compares a result file's runs with a regraded copy of it (ci/regrade), field by field.
import { readFileSync } from 'node:fs'
import { isMainModule } from '../src/mainModule.js'

// Fields a regrade may change; everything else (regradedAt, summary, speed, regradeNote) is left out.
const FIELDS = ['report', 'metrics.geometryError', 'error', 'providerError', 'gates', 'verdict', 'verdictPending', 'renderStale']

const get = (run, path) => path.split('.').reduce((value, key) => value?.[key], run)

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const runKey = (run) => `${run.fixture}#${run.run}`

// One entry per run present in both files whose compared fields differ, matched by fixture + run.
export function regradeDiff(original, regraded) {
  const after = new Map(regraded.results.map((run) => [runKey(run), run]))
  const changes = []
  for (const before of original.results) {
    const next = after.get(runKey(before))
    if (!next) continue
    const fields = FIELDS.map((field) => ({ field, before: get(before, field), after: get(next, field) })).filter((f) => !same(f.before, f.after))
    if (fields.length) changes.push({ run: runKey(before), fields })
  }
  return changes
}

export function formatRegradeDiff(changes) {
  const lines = changes.map((c) => `${c.run}: ${c.fields.map((f) => `${f.field} ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join(', ')}`)
  lines.push(`${changes.length} run${changes.length === 1 ? '' : 's'} changed`)
  return lines.join('\n')
}

const main = (argv) => {
  const [originalPath, regradedPath] = argv
  if (!originalPath || !regradedPath) {
    console.error('Usage: node eval/regrade-diff.js <original result file> <regraded copy>')
    process.exit(1)
  }
  const changes = regradeDiff(JSON.parse(readFileSync(originalPath, 'utf8')), JSON.parse(readFileSync(regradedPath, 'utf8')))
  console.log(formatRegradeDiff(changes))
  if (changes.length) process.exit(1)
}

if (isMainModule(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2))
}
