#!/usr/bin/env node

/**
 * Organize corpus files into batched examples directory
 *
 * Usage:
 *   node bin/organize-corpus.js [options]
 *
 * Options:
 *   --dry-run           Show what would be done without making changes
 *   --category=<name>   Only process specific category (bosl, bosl2, snippet)
 *   --batch-size=<n>    Files per batch (default: 30)
 *   --force            Overwrite existing batch directories
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
  category: args.find(a => a.startsWith('--category='))?.split('=')[1],
  batchSize: parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '30')
}

// Paths
const CORPUS_DIR = join(__dirname, '..', 'test', 'corpus')
const EXAMPLES_DIR = join(__dirname, '..', '..', '..', 'apps', 'jscad-web', 'examples', 'openscad')
const MANIFEST_PATH = join(CORPUS_DIR, 'manifest.json')

// Load manifest
let manifest
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
} catch (err) {
  console.error(`Error loading manifest: ${err.message}`)
  process.exit(1)
}

/**
 * Find all .scad files in a directory, excluding specified patterns
 */
function findScadFiles(dir, excludePatterns = []) {
  const files = []

  function scan(currentDir) {
    const entries = readdirSync(currentDir)

    for (const entry of entries) {
      const fullPath = join(currentDir, entry)
      const stat = statSync(fullPath)

      // Skip if matches exclude pattern
      const relativePath = relative(dir, fullPath)
      if (excludePatterns.some(pattern => relativePath.includes(pattern))) {
        continue
      }

      if (stat.isDirectory()) {
        scan(fullPath)
      } else if (entry.endsWith('.scad')) {
        files.push({
          path: fullPath,
          relativePath,
          name: entry,
          size: stat.size,
          modified: stat.mtime.toISOString()
        })
      }
    }
  }

  scan(dir)
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

/**
 * Organize files into batches based on manifest configuration
 */
function organizeCategoryByNumbering(category, config, files) {
  const batches = {}

  for (const batchConfig of config.batches) {
    batches[batchConfig.name] = {
      ...batchConfig,
      files: []
    }
  }

  // For numbered files (bosl2), use file range
  if (category === 'bosl2') {
    for (const file of files) {
      // Extract number from filename (e.g., "205-sphere.scad" -> 205)
      const match = file.name.match(/^(\d+)/)
      if (!match) continue

      const fileNum = parseInt(match[1])

      // Find which batch this file belongs to
      for (const batchConfig of config.batches) {
        const [start, end] = batchConfig.fileRange.split('-').map(n => parseInt(n))
        if (fileNum >= start && fileNum <= end) {
          batches[batchConfig.name].files.push(file)
          break
        }
      }
    }
  }
  // For other categories, distribute evenly
  else {
    const batchNames = config.batches.map(b => b.name)
    const filesPerBatch = Math.ceil(files.length / batchNames.length)

    files.forEach((file, index) => {
      const batchIndex = Math.floor(index / filesPerBatch)
      const batchName = batchNames[Math.min(batchIndex, batchNames.length - 1)]
      batches[batchName].files.push(file)
    })
  }

  return batches
}

/**
 * Create batch directory and copy files
 */
function createBatch(category, batchName, batch, sourceDir, targetDir) {
  const batchDir = join(targetDir, category, batchName)

  if (existsSync(batchDir) && !options.force) {
    console.log(`  ⚠️  Batch directory already exists: ${batchDir} (use --force to overwrite)`)
    return false
  }

  if (!options.dryRun) {
    mkdirSync(batchDir, { recursive: true })
  }

  console.log(`  📁 Creating batch: ${category}/${batchName} (${batch.files.length} files)`)

  // Copy files
  for (const file of batch.files) {
    const targetPath = join(batchDir, file.name)

    if (options.dryRun) {
      console.log(`     📄 ${file.name}`)
    } else {
      copyFileSync(file.path, targetPath)
    }
  }

  // Create metadata file
  const metadata = {
    batchName,
    category,
    description: batch.description,
    fileRange: batch.fileRange || `1-${batch.files.length}`,
    totalFiles: batch.files.length,
    sourceDir: relative(join(__dirname, '..'), sourceDir),
    generatedAt: new Date().toISOString(),
    files: batch.files.map(f => ({
      name: f.name,
      originalPath: relative(join(__dirname, '..'), f.path),
      size: f.size,
      lastModified: f.modified
    }))
  }

  const metaPath = join(batchDir, '.corpus-meta.json')
  if (!options.dryRun) {
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2))
  }

  return true
}

/**
 * Process a single category
 */
function processCategory(categoryName) {
  console.log(`\n🔄 Processing category: ${categoryName}`)

  const sourceInfo = manifest.sources[categoryName]
  if (!sourceInfo) {
    console.error(`  ❌ Category not found in manifest: ${categoryName}`)
    return
  }

  const categoryConfig = manifest.categories[categoryName]
  if (!categoryConfig) {
    console.error(`  ❌ Category configuration not found: ${categoryName}`)
    return
  }

  const sourceDir = join(CORPUS_DIR, categoryName)
  if (!existsSync(sourceDir)) {
    console.error(`  ❌ Source directory not found: ${sourceDir}`)
    return
  }

  // Find all .scad files (excluding lib/ and other patterns)
  const excludePatterns = sourceInfo.exclude || []
  const files = findScadFiles(sourceDir, excludePatterns)

  console.log(`  Found ${files.length} .scad files (expected: ${sourceInfo.fileCount})`)

  if (files.length === 0) {
    console.log(`  ⚠️  No files found, skipping`)
    return
  }

  // Organize into batches
  const batches = organizeCategoryByNumbering(categoryName, categoryConfig, files)

  // Create batch directories and copy files
  let created = 0
  let skipped = 0

  for (const [batchName, batch] of Object.entries(batches)) {
    if (batch.files.length === 0) {
      console.log(`  ⏭️  Skipping empty batch: ${batchName}`)
      continue
    }

    const success = createBatch(categoryName, batchName, batch, sourceDir, EXAMPLES_DIR)
    if (success) {
      created++
    } else {
      skipped++
    }
  }

  console.log(`  ✅ Created ${created} batches, skipped ${skipped}`)
}

/**
 * Main execution
 */
function main() {
  console.log('📦 OpenSCAD Corpus Organization Tool')
  console.log(`📍 Corpus: ${CORPUS_DIR}`)
  console.log(`📍 Examples: ${EXAMPLES_DIR}`)

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made')
  }

  // Process categories
  if (options.category) {
    processCategory(options.category)
  } else {
    const categories = Object.keys(manifest.categories)
    for (const category of categories) {
      processCategory(category)
    }
  }

  console.log('\n✨ Done!')

  if (options.dryRun) {
    console.log('\nRun without --dry-run to apply changes')
  }
}

main()
