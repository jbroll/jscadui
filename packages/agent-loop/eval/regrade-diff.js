// Usage: node eval/regrade-diff.js <original result file> <regraded copy>
// Compares a result file's runs with a regraded copy of it (ci/regrade), field by field.
import { readFileSync } from 'node:fs'
import { isMainModule } from '../src/mainModule.js'

// Fields a regrade may change; everything else (regradedAt, summary, speed, regradeNote) is left out.
const FIELDS = ['report', 'metrics.geometryError', 'error', 'providerError', 'gates', 'verdict', 'verdictPending', 'renderStale', 'renderError', 'description.text']

const get = (run, path) => path.split('.').reduce((value, key) => value?.[key], run)

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const runKey = (run) => `${run.fixture}#${run.run}`

// One entry per run present in both files whose compared fields differ, then one per run present in only one file.
export function regradeDiff(original, regraded) {
  const before = new Map(original.results.map((run) => [runKey(run), run]))
  const after = new Map(regraded.results.map((run) => [runKey(run), run]))
  const changes = []
  for (const key of before.keys()) if (!after.has(key)) changes.push({ run: key, only: 'original' })
  for (const key of after.keys()) if (!before.has(key)) changes.push({ run: key, only: 'regraded' })
  for (const [key, run] of before) {
    const next = after.get(key)
    if (!next) continue
    const fields = FIELDS.map((field) => ({ field, before: get(run, field), after: get(next, field) })).filter((f) => !same(f.before, f.after))
    if (fields.length) changes.push({ run: key, fields })
  }
  return changes
}

export function formatRegradeDiff(changes) {
  const lines = changes.map((c) => (c.only ? `${c.run}: only in the ${c.only} file` : `${c.run}: ${c.fields.map((f) => `${f.field} ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join(', ')}`))
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
