#!/usr/bin/env node

/**
 * Generate examples directory from corpus with:
 * - Numbered prefixes for ordering
 * - ALL.scad grid files for each directory
 * - Mapping JSON for tracking corpus -> examples
 *
 * Usage:
 *   node bin/generate-examples.js [options]
 *
 * Options:
 *   --dry-run           Show what would be done without making changes
 *   --category=<name>   Only process specific category (bosl, bosl2, basics, snippet, text)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, cpSync } from 'fs'
import { join, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  dryRun: args.includes('--dry-run'),
  category: args.find(a => a.startsWith('--category='))?.split('=')[1]
}

// Paths
const CORPUS_DIR = join(__dirname, '..', 'test', 'corpus')
const EXAMPLES_DIR = join(__dirname, '..', '..', '..', 'apps', 'jscad-web', 'examples', 'openscad')
const MANIFEST_PATH = join(CORPUS_DIR, 'manifest.json')
const MAPPING_PATH = join(CORPUS_DIR, 'corpus-examples-mapping.json')

// Load manifest
let manifest
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
} catch (err) {
  console.error(`Error loading manifest: ${err.message}`)
  process.exit(1)
}

/**
 * Load skip.txt file and return set of files to skip
 */
function loadSkipList(categoryDir) {
  const skipFile = join(categoryDir, 'skip.txt')
  if (!existsSync(skipFile)) return new Set()

  const content = readFileSync(skipFile, 'utf8')
  return new Set(
    content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
  )
}

/**
 * Find all .scad files in a directory, excluding lib/ and skip list
 */
function findScadFiles(dir, skipList = new Set()) {
  const files = []

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'lib') continue  // Skip lib directory
      if (entry.name.startsWith('.')) continue  // Skip hidden files

      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        files.push(...findScadFiles(fullPath, skipList))
      } else if (entry.name.endsWith('.scad') && !skipList.has(entry.name)) {
        files.push(fullPath)
      }
    }
  } catch (err) {
    console.warn(`Warning: Could not read directory ${dir}: ${err.message}`)
  }

  return files
}

/**
 * Extract number prefix from filename (e.g., "100-move.scad" -> 100)
 */
function extractNumber(filename) {
  const match = filename.match(/^(\d+)-/)
  return match ? parseInt(match[1]) : null
}

/**
 * Determine batch directory based on file number or sequence
 */
function getBatchDir(number, batches) {
  if (!number) return batches[batches.length - 1].name  // Last batch for unnumbered

  for (const batch of batches) {
    if (!batch.fileRange) continue
    const [min, max] = batch.fileRange.split('-').map(Number)
    if (number >= min && number <= max) {
      return batch.name
    }
  }

  return batches[batches.length - 1].name  // Fallback to last batch
}

/**
 * Generate ALL.scad file for a directory
 */
function generateAllFile(examplesDir, files, categoryName) {
  const relativeFiles = files.map(f => basename(f))

  const content = `// Auto-generated ALL file for ${categoryName}
// This file loads all examples in this directory in a grid layout

include <lib/std.scad>

// Grid parameters
grid_spacing = 50;
grid_cols = 4;

// Load all examples
${relativeFiles.map((file, i) => {
  const row = Math.floor(i / 4)
  const col = i % 4
  const x = col * 50
  const y = row * 50
  return `translate([${x}, ${y}, 0]) import("${file}");`
}).join('\n')}
`

  const allPath = join(examplesDir, '__all__.scad')

  if (options.dryRun) {
    console.log(`  [DRY RUN] Would write ${allPath}`)
  } else {
    writeFileSync(allPath, content, 'utf8')
    console.log(`  ✓ Generated ${allPath}`)
  }
}

/**
 * Process a category (bosl, bosl2, basics, etc.)
 */
function processCategory(categoryName) {
  console.log(`\n=== Processing category: ${categoryName} ===`)

  const corpusPath = join(CORPUS_DIR, categoryName)
  if (!existsSync(corpusPath)) {
    console.warn(`  ⚠ Corpus directory not found: ${corpusPath}`)
    return null
  }

  // Load skip list
  const skipList = loadSkipList(corpusPath)
  console.log(`  Skip list: ${skipList.size} files`)

  // Find all corpus files
  const corpusFiles = findScadFiles(corpusPath, skipList)
    .map(f => f.replace(corpusPath + '/', ''))
    .sort()

  console.log(`  Found ${corpusFiles.length} corpus files`)

  // Get category config from manifest
  const categoryConfig = manifest.categories[categoryName]
  if (!categoryConfig) {
    console.warn(`  ⚠ Category ${categoryName} not in manifest`)
    return null
  }

  const batches = categoryConfig.batches || []
  const mapping = {
    category: categoryName,
    corpusDir: `test/corpus/${categoryName}`,
    examplesDir: `examples/openscad/${categoryName}`,
    batches: {}
  }

  // Group files by batch
  const batchedFiles = {}
  for (const batch of batches) {
    batchedFiles[batch.name] = []
  }

  // Assign files to batches and add numbering
  let counter = 100  // Start numbering at 100
  const step = 1

  for (const corpusFile of corpusFiles) {
    const filename = basename(corpusFile)
    const existingNumber = extractNumber(filename)
    const number = existingNumber || counter

    if (!existingNumber) {
      counter += step
    }

    const batchDir = getBatchDir(number, batches)
    const exampleFile = `${String(number).padStart(3, '0')}-${filename}`

    batchedFiles[batchDir].push({
      corpus: corpusFile,
      example: exampleFile,
      number
    })
  }

  // Create batch directories and copy files
  for (const batch of batches) {
    const batchFiles = batchedFiles[batch.name] || []
    if (batchFiles.length === 0) continue

    const examplesBatchDir = join(EXAMPLES_DIR, categoryName, batch.name)

    console.log(`\n  Batch: ${batch.name} (${batchFiles.length} files)`)

    if (!options.dryRun) {
      mkdirSync(examplesBatchDir, { recursive: true })
    }

    // Copy files with numbering
    for (const { corpus, example } of batchFiles) {
      const srcPath = join(corpusPath, corpus)
      const dstPath = join(examplesBatchDir, example)

      if (options.dryRun) {
        console.log(`    ${corpus} -> ${example}`)
      } else {
        cpSync(srcPath, dstPath)
      }
    }

    // Generate ALL.scad file
    const exampleFiles = batchFiles.map(f => f.example)
    if (!options.dryRun) {
      generateAllFile(examplesBatchDir, exampleFiles, `${categoryName}/${batch.name}`)
    }

    // Add to mapping
    mapping.batches[batch.name] = {
      description: batch.description,
      fileCount: batchFiles.length,
      files: batchFiles.map(({ corpus, example, number }) => ({
        corpus,
        example,
        number
      }))
    }
  }

  return mapping
}

/**
 * Main execution
 */
function main() {
  console.log('OpenSCAD Examples Generator')
  console.log('===========================')

  if (options.dryRun) {
    console.log('\n*** DRY RUN MODE - No files will be modified ***\n')
  }

  // Determine categories to process
  const categories = options.category
    ? [options.category]
    : Object.keys(manifest.categories)

  const fullMapping = {
    generated: new Date().toISOString(),
    categories: {}
  }

  // Process each category
  for (const category of categories) {
    const mapping = processCategory(category)
    if (mapping) {
      fullMapping.categories[category] = mapping
    }
  }

  // Write mapping JSON
  if (!options.dryRun) {
    writeFileSync(MAPPING_PATH, JSON.stringify(fullMapping, null, 2), 'utf8')
    console.log(`\n✓ Wrote mapping to ${MAPPING_PATH}`)
  }

  console.log('\n✓ Done!')
}

main()
