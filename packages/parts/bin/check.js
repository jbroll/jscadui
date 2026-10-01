import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readRecords, CATALOG_DIR } from '../src/records.js'
import { loadEntry, buildPart, LIBS_DIR } from '../src/load.js'
import { signature, sizeNames } from '../src/derive.js'
import { boundingSize, isEmpty } from '../src/measure.js'

const DERIVED_PATH = fileURLToPath(new URL('../derived.json', import.meta.url))
const AXES = ['x', 'y', 'z']
const round3 = (n) => Math.round(n * 1000) / 1000

function compareAxis(record, args, axis, measured, expected, tol, source, failures) {
  if (expected == null) return
  if (Math.abs(measured - expected) > tol) {
    failures.push(`${record.id} ${JSON.stringify(args)} ${axis}: measured ${round3(measured)}, expected ${round3(expected)} (${source})`)
  }
}

export async function checkRecord(record, opts = {}) {
  const loaded = await loadEntry(record, { libsDir: opts.libsDir })
  const failures = []
  const measured = []
  const buildTimes = []

  for (const check of record.checks) {
    const { geometry, buildMs } = await buildPart(loaded, record, check.args)
    buildTimes.push(buildMs)
    const size = boundingSize(geometry, loaded.ctx)
    measured.push({ args: check.args, size })
    AXES.forEach((axis, i) => compareAxis(record, check.args, axis, size[i], check.size[i], check.tol, check.source, failures))
  }

  const sizes = sizeNames(loaded.exports, record.sizes)
  for (const name of sizes) {
    try {
      // A size name that isn't an exported value is a stale or misspelled
      // catalog entry; the library call would otherwise run on the literal
      // name string, which some modules build without erroring.
      if (!(name in loaded.exports.vars)) throw new Error(`${name} is not an exported value`)
      const { geometry, buildMs } = await buildPart(loaded, record, [name])
      buildTimes.push(buildMs)
      if (isEmpty(geometry, loaded.ctx)) failures.push(`${record.id} ${name}: empty geometry`)
    } catch (err) {
      failures.push(`${record.id} ${name}: ${err.message}`)
    }
  }

  return {
    id: record.id,
    ok: failures.length === 0,
    failures,
    measured,
    sizes,
    signature: signature(loaded.exports, record.call),
    transpileMs: loaded.transpileMs,
    buildMs: { max: Math.max(...buildTimes), mean: buildTimes.reduce((a, b) => a + b, 0) / buildTimes.length },
  }
}

function writeDerived(results) {
  let existing = {}
  try {
    existing = JSON.parse(readFileSync(DERIVED_PATH, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  for (const result of results) existing[result.id] = result
  const sorted = Object.fromEntries(Object.keys(existing).sort().map((id) => [id, existing[id]]))
  writeFileSync(DERIVED_PATH, JSON.stringify(sorted, null, 2) + '\n')
}

async function main() {
  const args = process.argv.slice(2)
  let catalogDir = CATALOG_DIR
  let libsDir = LIBS_DIR
  let all = false
  let write = false
  const ids = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--all') all = true
    else if (arg === '--write') write = true
    else if (arg === '--catalog') catalogDir = args[++i]
    else if (arg === '--libs') libsDir = args[++i]
    else ids.push(arg)
  }

  const records = readRecords(catalogDir)
  if (!all && ids.length === 0) {
    console.error('usage: check.js <id>... | --all [--catalog <dir>] [--libs <dir>] [--write]')
    process.exitCode = 1
    return
  }
  const selected = all ? records : records.filter((r) => ids.includes(r.id))
  const missing = all ? [] : ids.filter((id) => !records.some((r) => r.id === id))
  if (missing.length > 0) {
    console.error(`unknown record id(s): ${missing.join(', ')}`)
    process.exitCode = 1
    return
  }

  const results = []
  for (const record of selected) {
    const result = await checkRecord(record, { libsDir })
    results.push(result)
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.id}`)
    for (const failure of result.failures) console.log(`  ${failure}`)
  }

  if (write) writeDerived(results)

  if (results.some((r) => !r.ok)) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
