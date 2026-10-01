import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const CATALOG_DIR = fileURLToPath(new URL('../catalog/', import.meta.url))

const REQUIRED_FIELDS = ['id', 'family', 'library', 'license', 'file', 'call', 'summary', 'sizes', 'example', 'checks']
const SIZE_FORMS = ['list', 'values', 'names']

const isIdentifier = (s) => typeof s === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)

function checkSizes(path, sizes) {
  const forms = SIZE_FORMS.filter((form) => form in sizes)
  if (forms.length !== 1) throw new Error(`${path}: "sizes" needs exactly one of ${SIZE_FORMS.join(', ')}`)
  if (sizes.list !== undefined && typeof sizes.list !== 'string') throw new Error(`${path}: "sizes.list" must name a list variable`)
  if (sizes.values !== undefined && !Array.isArray(sizes.values)) throw new Error(`${path}: "sizes.values" must be an array`)
  if (sizes.names !== undefined && !(Array.isArray(sizes.names) && sizes.names.every(isIdentifier))) {
    throw new Error(`${path}: "sizes.names" must be an array of identifiers`)
  }
}

export function validateRecord(record, path = record.id) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in record)) throw new Error(`${path}: missing required field "${field}"`)
  }
  checkSizes(path, record.sizes)
  if ('insertArgs' in record && !Array.isArray(record.insertArgs)) throw new Error(`${path}: "insertArgs" must be an array`)
  return record
}

const readRecord = (path) => validateRecord(JSON.parse(readFileSync(path, 'utf8')), path)

export function readRecords(dir = CATALOG_DIR) {
  const records = []
  for (const library of readdirSync(dir, { withFileTypes: true })) {
    if (!library.isDirectory()) continue
    const libraryDir = join(dir, library.name)
    for (const entry of readdirSync(libraryDir)) {
      if (!entry.endsWith('.json')) continue
      records.push(readRecord(join(libraryDir, entry)))
    }
  }
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return records
}
