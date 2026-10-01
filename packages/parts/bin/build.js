import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { readRecords, CATALOG_DIR } from '../src/records.js'
import { LIBS_DIR } from '../src/load.js'
import { writeShims } from '../src/shims.js'

const THUMBS_DIR = fileURLToPath(new URL('../thumbs/', import.meta.url))
const DERIVED_PATH = fileURLToPath(new URL('../derived.json', import.meta.url))
const AGENT_API_PARTS_PATH = fileURLToPath(new URL('../../agent-loop/api/parts.json', import.meta.url))
const AGENT_PROMPT_PARTS_PATH = fileURLToPath(new URL('../../agent-loop/prompt/parts.md', import.meta.url))

const PARTS_RULES = [
  'Use a catalog part for standard hardware instead of modeling it.',
  'Prefer a permissive license when two parts are equivalent.',
  'Never copy library files into the project.',
]

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

// A size name representative of the family, for the require destructuring. Only
// a sizes.list entry needs one: its names are JS exports, not call arguments.
const repSizeName = (entry) => {
  if (!entry.sizes.list) return null
  const arg = entry.measured[0]?.args[0]
  return typeof arg === 'string' ? arg : null
}

function docsEntry(entry) {
  const call = entry.call
  const sizeName = repSizeName(entry)
  const requireNames = [call, sizeName].filter(Boolean).join(', ')
  const list = Boolean(entry.sizes.list)
  const params = entry.signature.params.map((p) => (p.default != null ? `${p.name} = ${p.default}` : p.name)).join(', ')
  return {
    name: `parts.${entry.library.toLowerCase()}.${call}`,
    pkg: '@jscadui/parts',
    kind: 'part',
    family: entry.family,
    ...(entry.preferred ? { preferred: true } : {}),
    description: entry.summary,
    require: `const { ${requireNames} } = require('${entry.require}')`,
    scad: entry.scadIncludes.map((f) => `include <${f}>`).join('\n'),
    signature: `${call}(${params})`,
    sizes: list ? [...entry.sizeNames] : entry.sizeNames.map((s) => JSON.stringify(s)),
    options: entry.options ?? {},
    license: entry.license,
    measured: entry.measured,
    example: entry.example,
  }
}

// One line per family, from its preferred entry; a family with none yet (not
// every family has settled on a preferred library) is left out.
function partsPromptLines(docs) {
  const byFamily = new Map()
  for (const d of docs) {
    if (d.preferred && !byFamily.has(d.family)) byFamily.set(d.family, d)
  }
  return [...byFamily.keys()].sort().map((family) => {
    const d = byFamily.get(family)
    return `- ${family}: \`${d.require}\` — ${d.example}`
  })
}

// Empty with no admitted entries, so assemblePrompt can tell an unbuilt
// catalog from a built one with nothing yet preferred.
function buildPartsPrompt(docs) {
  if (!docs.length) return ''
  const lines = partsPromptLines(docs)
  return [
    '## Parts',
    ...(lines.length ? ['', ...lines] : []),
    '',
    'Rules:',
    ...PARTS_RULES.map((r) => `- ${r}`),
  ].join('\n') + '\n'
}

export function buildAgentDocs(entries) {
  const json = entries.map(docsEntry)
  return { json, md: buildPartsPrompt(json) }
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
  const agentDocs = buildAgentDocs(catalog.entries)
  writeFileSync(AGENT_API_PARTS_PATH, JSON.stringify(agentDocs.json, null, 2) + '\n')
  writeFileSync(AGENT_PROMPT_PARTS_PATH, agentDocs.md)
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
