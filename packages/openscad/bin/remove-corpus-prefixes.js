#!/usr/bin/env node

/**
 * Remove number prefixes from corpus files
 * Number prefixes are only for examples (for ordering), not needed in corpus
 */

import { readdirSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const CORPUS_BASE = join(__dirname, '..', 'test', 'corpus')
const CATEGORIES = ['basics', 'bosl', 'bosl2', 'snippet', 'text']

function removeNumberPrefix(filename) {
  return filename.replace(/^\d+-/, '')
}

function processDirectory(dir, dryRun = false) {
  if (!existsSync(dir)) return { renamed: 0, skipped: 0 }
  
  let renamed = 0
  let skipped = 0
  
  function scan(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== 'lib') {
          scan(join(currentDir, entry.name))
        }
      } else if (entry.name.endsWith('.scad')) {
        const newName = removeNumberPrefix(entry.name)
        if (newName !== entry.name) {
          const oldPath = join(currentDir, entry.name)
          const newPath = join(currentDir, newName)
          
          if (dryRun) {
            console.log(`  ${entry.name} → ${newName}`)
          } else {
            renameSync(oldPath, newPath)
            console.log(`  ✓ ${entry.name} → ${newName}`)
          }
          renamed++
        } else {
          skipped++
        }
      }
    }
  }
  
  scan(dir)
  return { renamed, skipped }
}

const dryRun = process.argv.includes('--dry-run')

if (dryRun) {
  console.log('🔍 DRY RUN - showing what would be renamed:\n')
}

let totalRenamed = 0
let totalSkipped = 0

for (const category of CATEGORIES) {
  const dir = join(CORPUS_BASE, category)
  console.log(`\n📁 ${category}:`)
  const { renamed, skipped } = processDirectory(dir, dryRun)
  console.log(`   Renamed: ${renamed}, Skipped: ${skipped}`)
  totalRenamed += renamed
  totalSkipped += skipped
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Total renamed: ${totalRenamed}`)
console.log(`Total skipped (no prefix): ${totalSkipped}`)

if (dryRun) {
  console.log('\nRun without --dry-run to apply changes')
} else {
  console.log('\n✅ Corpus files renamed!')
}
