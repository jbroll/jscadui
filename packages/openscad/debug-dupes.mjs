import { transpile } from './src/transpiler/transpile.ts'
import { parse } from './src/parser/parse.ts'
import { readFileSync } from 'fs'

const testFile = process.argv[2] || 'test/corpus/bosl2/972-walls-ex.scad'
const source = readFileSync(testFile, 'utf-8')
const { ast } = parse(source)

const fileResolver = (filename, fromFile) => {
  let path = filename
  if (fromFile && !filename.startsWith('/') && !filename.startsWith('lib/')) {
    const dir = fromFile.split('/').slice(0, -1).join('/') + '/'
    path = dir + filename
  }
  path = 'test/corpus/bosl2/' + path
  try {
    return readFileSync(path, 'utf-8')
  } catch (e) {
    return undefined
  }
}

const result = transpile(ast, {
  includeHeader: true,
  fileResolver,
  currentFile: testFile
})

console.log('Testing:', testFile)

// Find duplicate declarations
const lines = result.code.split('\n')
const constDecls = lines.filter(l => l.match(/^const _BOSL2/))
console.log('BOSL2 constant declarations:')
for (const l of constDecls) {
  console.log(l.slice(0, 80))
}
console.log('\nTotal BOSL2 consts:', constDecls.length)

// Find specific duplicates
const seen = new Map()
for (const l of constDecls) {
  const match = l.match(/^const (\w+)/)
  if (match) {
    const name = match[1]
    if (seen.has(name)) {
      console.log('\nDUPLICATE:', name)
    } else {
      seen.set(name, true)
    }
  }
}
