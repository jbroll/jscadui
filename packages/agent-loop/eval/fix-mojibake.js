// Usage: node eval/fix-mojibake.js PATH...
// Repairs eval result files whose UTF-8 was decoded as latin1 and encoded again
// (simple-ci's artifact endpoint did this before it pinned its encoding to UTF-8).
// A directory argument covers its *.json files. Files that are not double-encoded
// are left untouched.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMainModule } from '../src/mainModule.js'

const UTF8_PAIR_AS_LATIN1 = /[Â-ô][\u0080-¿]/
const ABOVE_LATIN1 = /[Ā-￿]/

export const isDoubleEncoded = (text) => {
  if (ABOVE_LATIN1.test(text) || !UTF8_PAIR_AS_LATIN1.test(text)) return false
  return !Buffer.from(text, 'latin1').toString('utf8').includes('�')
}

export const repair = (text) => (isDoubleEncoded(text) ? Buffer.from(text, 'latin1').toString('utf8') : text)

export const fixFile = (path) => {
  const text = readFileSync(path, 'utf8')
  if (!isDoubleEncoded(text)) return false
  writeFileSync(path, repair(text))
  return true
}

const expand = (path) =>
  statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => join(path, name))
    : [path]

export const fixPaths = (paths, log = () => {}) => {
  const fixed = []
  for (const file of paths.flatMap(expand)) {
    if (fixFile(file)) {
      fixed.push(file)
      log(`fix-mojibake: repaired ${file}`)
    }
  }
  return fixed
}

if (isMainModule(process.argv[1], import.meta.url)) {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    console.error('Usage: node eval/fix-mojibake.js PATH...')
    process.exit(1)
  }
  const fixed = fixPaths(paths, console.log)
  console.log(`fix-mojibake: ${fixed.length} file(s) repaired`)
}
