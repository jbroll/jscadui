#!/usr/bin/env node

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const CORPUS_BASE = join(__dirname, '..', 'test', 'corpus')
const EXAMPLES_BASE = join(__dirname, '..', '..', '..', 'apps', 'jscad-web', 'examples', 'openscad')

// Map corpus structure to examples structure
const CATEGORY_MAP = {
  'basics': { corpus: join(CORPUS_BASE, 'basics'), examples: join(EXAMPLES_BASE, '01-basics'), name: 'basics' },
  'bosl': { corpus: join(CORPUS_BASE, 'bosl'), examples: join(EXAMPLES_BASE, 'bosl'), name: 'bosl' },
  'bosl2': { corpus: join(CORPUS_BASE, 'bosl2'), examples: join(EXAMPLES_BASE, 'bosl2'), name: 'bosl2' },
  'snippet': { corpus: join(CORPUS_BASE, 'snippet'), examples: join(EXAMPLES_BASE, 'snippet'), name: 'snippet' },
  'text': { corpus: join(CORPUS_BASE, 'text'), examples: join(EXAMPLES_BASE, 'text'), name: 'text' }
}

function readSkipList(dir) {
  const skipFile = join(dir, 'skip.txt')
  const skipList = new Set()
  
  if (existsSync(skipFile)) {
    const content = readFileSync(skipFile, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        skipList.add(trimmed)
      }
    }
  }
  
  return skipList
}

function scanFiles(dir, excludeDirs = [], onlyRoot = false) {
  const files = []
  
  if (!existsSync(dir)) return files
  
  if (onlyRoot) {
    // Only scan root level, not subdirectories
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.scad')) {
        files.push(entry.name)
      }
    }
  } else {
    // Recursive scan
    function scan(currentDir) {
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            scan(join(currentDir, entry.name))
          }
        } else if (entry.name.endsWith('.scad')) {
          files.push(entry.name)
        }
      }
    }
    scan(dir)
  }
  
  return files
}

function normalizeFilename(filename) {
  return filename.replace(/^\d+-/, '')
}

function verifyCategory(key, info) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Category: ${info.name.toUpperCase()}`)
  console.log('='.repeat(60))

  const skipList = readSkipList(info.corpus)
  const corpusFiles = scanFiles(info.corpus, ['lib'], false)
  const exampleFiles = scanFiles(info.examples, ['lib'], false)
  
  const exampleSet = new Set(exampleFiles.map(normalizeFilename))
  
  console.log(`Corpus files: ${corpusFiles.length}`)
  console.log(`Skip list: ${skipList.size}`)
  console.log(`Example files: ${exampleFiles.length}`)
  console.log(`Expected in examples: ${corpusFiles.length - skipList.size}`)
  
  const missing = []
  for (const file of corpusFiles) {
    if (skipList.has(file)) continue
    if (!exampleSet.has(normalizeFilename(file))) {
      missing.push(file)
    }
  }
  
  if (missing.length === 0) {
    console.log('\n✅ All corpus files are present in examples!')
  } else {
    console.log(`\n❌ Missing from examples: ${missing.length}`)
    if (missing.length <= 20) {
      console.log('\nMissing files:')
      missing.forEach(f => console.log(`  ${f}`))
    } else {
      console.log('\nFirst 20 missing files:')
      missing.slice(0, 20).forEach(f => console.log(`  ${f}`))
      console.log(`  ... and ${missing.length - 20} more`)
    }
  }
  
  const corpusSet = new Set(corpusFiles.map(normalizeFilename))
  const extra = exampleFiles.filter(f => !corpusSet.has(normalizeFilename(f)))
  
  if (extra.length > 0) {
    console.log(`\n⚠️  Extra files in examples: ${extra.length}`)
  }
  
  return {
    category: info.name,
    corpusCount: corpusFiles.length,
    skipCount: skipList.size,
    exampleCount: exampleFiles.length,
    expectedCount: corpusFiles.length - skipList.size,
    missingCount: missing.length,
    extraCount: extra.length
  }
}

const results = []
for (const [key, info] of Object.entries(CATEGORY_MAP)) {
  results.push(verifyCategory(key, info))
}

console.log(`\n${'='.repeat(60)}`)
console.log('SUMMARY')
console.log('='.repeat(60))

const totals = results.reduce((acc, r) => ({
  corpusCount: acc.corpusCount + r.corpusCount,
  skipCount: acc.skipCount + r.skipCount,
  exampleCount: acc.exampleCount + r.exampleCount,
  expectedCount: acc.expectedCount + r.expectedCount,
  missingCount: acc.missingCount + r.missingCount,
  extraCount: acc.extraCount + r.extraCount
}), { corpusCount: 0, skipCount: 0, exampleCount: 0, expectedCount: 0, missingCount: 0, extraCount: 0 })

console.log(`Total corpus files: ${totals.corpusCount}`)
console.log(`Total skip list: ${totals.skipCount}`)
console.log(`Total example files: ${totals.exampleCount}`)
console.log(`Expected in examples: ${totals.expectedCount}`)
console.log(`Missing: ${totals.missingCount}`)
console.log(`Extra: ${totals.extraCount}`)

if (totals.missingCount === 0 && totals.extraCount === 0) {
  console.log('\n✅ All categories verified - corpus and examples are in sync!')
  process.exit(0)
} else {
  console.log('\n❌ Verification failed - corpus and examples are out of sync')
  process.exit(1)
}
