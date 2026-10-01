import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const CATALOG_DIR = fileURLToPath(new URL('../catalog/', import.meta.url))

const REQUIRED_FIELDS = ['id', 'family', 'library', 'license', 'file', 'call', 'summary', 'sizes', 'example', 'checks']

function readRecord(path) {
  const record = JSON.parse(readFileSync(path, 'utf8'))
  for (const field of REQUIRED_FIELDS) {
    if (!(field in record)) throw new Error(`${path}: missing required field "${field}"`)
  }
  return record
}

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
