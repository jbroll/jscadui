import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { readRecords, CATALOG_DIR } from '../src/records.js'
import { LIBS_DIR } from '../src/load.js'
import { writeShims } from '../src/shims.js'

const THUMBS_DIR = fileURLToPath(new URL('../thumbs/', import.meta.url))
const DERIVED_PATH = fileURLToPath(new URL('../derived.json', import.meta.url))

function compareEntries(a, b) {
  if (a.family !== b.family) return a.family < b.family ? -1 : 1
  if (!!a.preferred !== !!b.preferred) return a.preferred ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function buildCatalog(records, derived) {
  const entries = []
  for (const record of records) {
    const d = derived[record.id]
    if (!d) {
      console.error(`${record.id}: no derived data, skipping (run check.js --write first)`)
      continue
    }
    entries.push({
      ...record,
      signature: d.signature,
      sizeNames: d.sizes,
      measured: d.measured,
      transpileMs: d.transpileMs,
      buildMs: d.buildMs,
      thumb: `thumbs/${record.id}.png`,
      require: record.prelude ? `_catalog/${record.file}` : record.file,
      scadIncludes: [...(record.prelude ?? []), record.file],
    })
  }
  entries.sort(compareEntries)
  return { entries }
}

// readdirSync throws ENOENT before Task 12 adds real catalog entries; an
// empty catalog still builds (an empty entries list) rather than failing
// every app build until that task lands.
function readCatalogRecords(catalogDir) {
  try {
    return readRecords(catalogDir)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return []
  }
}

function readDerived(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return {}
  }
}

export function buildParts(outDir, { catalogDir = CATALOG_DIR, libsDir = LIBS_DIR } = {}) {
  const records = readCatalogRecords(catalogDir)
  writeShims(records, libsDir)
  const catalog = buildCatalog(records, readDerived(DERIVED_PATH))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
  if (existsSync(THUMBS_DIR)) cpSync(THUMBS_DIR, join(outDir, 'thumbs'), { recursive: true })
  return catalog
}

function main() {
  const args = process.argv.slice(2)
  let catalogDir = CATALOG_DIR
  let libsDir = LIBS_DIR
  let outDir
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--out') outDir = args[++i]
    else if (arg === '--catalog') catalogDir = args[++i]
    else if (arg === '--libs') libsDir = args[++i]
  }
  if (!outDir) {
    console.error('usage: build.js --out <dir> [--catalog <dir>] [--libs <dir>]')
    process.exitCode = 1
    return
  }
  buildParts(outDir, { catalogDir, libsDir })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
