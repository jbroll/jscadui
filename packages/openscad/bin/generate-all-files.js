#!/usr/bin/env node

/**
 * Generate ALL.js grid files for directories containing models
 *
 * Manifest-driven approach:
 * - Generates ALL.js for ANY directory containing models (.js or .scad files)
 * - Treats directories with single index.js/index.scad as leaf model files
 * - Parent directories aggregate subdirectory ALL.js files and direct model files
 * - A directory with categories.json gets ALL.<category>.js per category, and
 *   its ALL.js aggregates those
 * - Preserves numeric prefixes for top-level examples and benchmarks (for directory ordering)
 * - Removes numeric prefixes for OpenSCAD examples (not needed)
 *
 * Usage:
 *   npm run generate-all              (from the repo root; passes --no-rename)
 *   node bin/generate-all-files.js [options]
 *
 * Without --no-rename this strips numeric prefixes from the gitignored bosl and
 * bosl2 corpus, which breaks the render baselines.
 *
 * Options:
 *   --dry-run         Show what would be done without making changes
 *   --no-rename       Generate ALL.js but don't rename files (keep numeric prefixes)
 *   --no-clean        Don't remove existing ALL.js files before generating
 *   --examples-dir    Path to examples directory (default: apps/jscad-web/examples)
 *
 * Configuration:
 *   Reads generator.config.json from examples directory for:
 *   - preservePrefixDirs: directories to keep numeric prefixes
 *   - cleanBeforeGenerate: whether to clean old ALL.js files
 *   - gridSettings: spacing and cellSizeRatio for grid layout
 */

import { writeFileSync, readFileSync, readdirSync, renameSync, existsSync, unlinkSync } from 'fs'
import { join, basename, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  dryRun: args.includes('--dry-run'),
  noRename: args.includes('--no-rename'),
  noClean: args.includes('--no-clean'),
  examplesDir: null
}

// Find examples dir argument
const examplesDirIdx = args.indexOf('--examples-dir')
if (examplesDirIdx !== -1 && args[examplesDirIdx + 1]) {
  options.examplesDir = args[examplesDirIdx + 1]
} else {
  options.examplesDir = join(__dirname, '..', '..', '..', 'apps', 'jscad-web', 'examples')
}

/**
 * Load configuration from generator.config.json if it exists
 */
function loadConfig(examplesDir) {
  const configPath = join(examplesDir, 'generator.config.json')
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf8')
      return JSON.parse(content)
    } catch (err) {
      console.warn(`Warning: Could not parse ${configPath}: ${err.message}`)
    }
  }

  // Default configuration
  return {
    preservePrefixDirs: ['', 'benchmarks'],
    cleanBeforeGenerate: true,
    gridSettings: {
      spacing: 60,
      cellSizeRatio: 0.85
    }
  }
}

// Load configuration
const config = loadConfig(options.examplesDir)

/** ALL.js, or a per-category grid such as ALL.printed.js. */
const isGridFile = (name) => /^ALL(\.[^/]+)?\.js$/.test(name)

/** categories.json in dir: { category: [model base names] }, or null. */
function loadCategories(dir) {
  const file = join(dir, 'categories.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

function loadPatternFile(dir, name) {
  const file = join(dir, name)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
}

/**
 * Build an exclusion scope for a directory from its exclude.txt (non-model
 * files/dirs) and skip.txt (problematic models). Patterns are relative to dir.
 */
function makeScope(dir) {
  const exclude = loadPatternFile(dir, 'exclude.txt')
  const skip = loadPatternFile(dir, 'skip.txt')
  return (exclude.length || skip.length) ? { baseDir: dir, exclude, skip } : null
}

// exclude.txt: trailing '/' = directory subtree, leading '/' = root-anchored,
// '*' does not cross '/'. Always anchored to the scope baseDir.
function matchesExclude(relPath, patterns) {
  for (const raw of patterns) {
    let p = raw.startsWith('/') ? raw.slice(1) : raw
    const dirOnly = p.endsWith('/')
    if (dirOnly) p = p.slice(0, -1)
    const rx = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + (dirOnly ? '(/.*)?$' : '$'))
    if (rx.test(relPath)) return true
  }
  return false
}

// skip.txt: matched against the relative path or basename (mirrors test-harness).
function matchesSkip(relPath, patterns) {
  const base = basename(relPath)
  for (const raw of patterns) {
    const rx = new RegExp('^' + raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
    if (rx.test(relPath) || rx.test(base)) return true
  }
  return false
}

/**
 * Find all model files in a directory (non-recursive)
 * Includes .scad, .js (but not ALL.js, index.js in certain cases)
 * Excludes files listed in skip.txt
 */
function findModelFiles(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(f => {
        if (f.startsWith('.')) return false
        if (isGridFile(f) || f === 'ALL.scad' || f === '__all__.scad') return false
        return f.endsWith('.scad') || f.endsWith('.js')
      })
      .sort()
  } catch (err) {
    console.warn(`Warning: Could not read ${dir}: ${err.message}`)
    return []
  }
}

/**
 * Check if directory is index-only (single index.js or index.scad, no subdirs)
 */
function isIndexOnlyDirectory(dir) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'lib')
    const files = entries.filter(e => e.isFile() && (e.name === 'index.js' || e.name === 'index.scad'))

    return subdirs.length === 0 && files.length === 1
  } catch {
    return false
  }
}

/**
 * Remove numeric prefix from filename
 * "200-cuboid.scad" -> "cuboid.scad"
 */
function removePrefix(filename) {
  return filename.replace(/^\d+-/, '')
}

/**
 * Calculate relative path to lib/grid-utils.js based on directory depth from examples root
 */
function getLibPath(dir, examplesRoot) {
  const rel = relative(examplesRoot, dir)
  const depth = rel === '' ? 0 : rel.split('/').filter(Boolean).length
  return depth === 0 ? './lib/grid-utils.js' : '../'.repeat(depth) + 'lib/grid-utils.js'
}

/**
 * Generate ALL.js file for a directory
 * @param {string} dir - Directory path
 * @param {string[]} items - Array of relative paths to load (files or subdirs)
 * @param {string} examplesRoot - Root examples directory
 */
function generateAllFile(dir, items, examplesRoot, fileName = 'ALL.js') {
  const libPath = getLibPath(dir, examplesRoot)
  const spacing = config.gridSettings.spacing
  const cellSize = spacing * config.gridSettings.cellSizeRatio

  const itemsJson = JSON.stringify(items, null, 2)

  const content = `"use strict"
// ⚠️  DO NOT EDIT THIS FILE - IT IS AUTO-GENERATED ⚠️
// This file is generated by bin/generate-all-files.js
// Any manual changes will be overwritten when the script runs.
//
// Auto-generated ALL script: runs each model under its own params namespace in
// one cell of a grid. See gridModule in lib/grid-utils.js.
const { gridModule } = require('${libPath}')

const items = ${itemsJson}

module.exports = gridModule(items, { spacing: ${spacing}, cellSize: ${cellSize} }, require)
`

  const allPath = join(dir, fileName)

  if (options.dryRun) {
    console.log(`  [DRY RUN] Would write ${allPath} (${items.length} items)`)
  } else {
    // Remove old __all__.scad if it exists
    const oldAllPath = join(dir, '__all__.scad')
    if (existsSync(oldAllPath)) {
      unlinkSync(oldAllPath)
    }
    writeFileSync(allPath, content, 'utf8')
    console.log(`  ✓ Generated ${allPath} (${items.length} items)`)
  }

  return items.length
}

/**
 * Check if a directory should preserve numeric prefixes
 */
function shouldPreservePrefix(dir, examplesRoot) {
  const relPath = relative(examplesRoot, dir)
  return config.preservePrefixDirs.includes(relPath)
}

/**
 * Rename files to remove numeric prefixes (only if not in preserve list)
 */
function renameFilesInDirectory(dir, files, examplesRoot) {
  // Don't rename files in directories where we want to preserve ordering
  if (shouldPreservePrefix(dir, examplesRoot)) {
    return 0
  }

  let renamed = 0
  for (const file of files) {
    const newName = removePrefix(file)
    if (newName !== file) {
      const oldPath = join(dir, file)
      const newPath = join(dir, newName)

      if (options.dryRun) {
        console.log(`    [DRY RUN] Would rename ${file} -> ${newName}`)
      } else {
        renameSync(oldPath, newPath)
        console.log(`    Renamed: ${file} -> ${newName}`)
      }
      renamed++
    }
  }
  return renamed
}

/** Items for the subdirectories that have models: an index file, or the grid that stands for the subdir. */
function subdirItems(subdirResults) {
  return subdirResults.filter(subdir => subdir.hasModels).map(subdir => {
    if (isIndexOnlyDirectory(subdir.path)) {
      const indexFile = existsSync(join(subdir.path, 'index.js')) ? 'index.js' : 'index.scad'
      return `./${subdir.name}/${indexFile}`
    }
    return `./${subdir.name}/${subdir.gridRef}`
  })
}

/**
 * Write ALL.<category>.js per category beside the models, so its items stay
 * ./name.scad. Returns the directory's own grid items: the category grids, then
 * whatever no category claims.
 */
function categoryGridItems(dir, categories, items, examplesRoot, stats) {
  const isOwnFile = (item) => !item.slice(2).includes('/')
  const claimed = new Set()
  const grids = []
  for (const [category, models] of Object.entries(categories)) {
    const members = items.filter(item => isOwnFile(item) && models.includes(basename(item).replace(/\.(scad|js)$/, '')))
    if (!members.length) continue
    members.forEach(m => claimed.add(m))
    const fileName = `ALL.${category}.js`
    stats.files += generateAllFile(dir, members, examplesRoot, fileName)
    grids.push('./' + fileName)
  }
  const rest = items.filter(item => !claimed.has(item))
  const unlisted = rest.filter(isOwnFile)
  if (unlisted.length) console.warn(`Warning: ${join(dir, 'categories.json')} lists none of ${unlisted.join(' ')}`)
  return [...grids, ...rest]
}

/**
 * Process directory manifest-driven: generate ALL.js for any directory with models
 */
function processDirectory(dir, examplesRoot, depth = 0, scopes = []) {
  if (!existsSync(dir)) {
    console.warn(`Warning: Directory not found: ${dir}`)
    return { dirs: 0, files: 0, renamed: 0, hasModels: false }
  }

  // exclude.txt / skip.txt at this dir add a scope applied to its whole subtree.
  const own = makeScope(dir)
  if (own) scopes = [...scopes, own]
  const excluded = (p) => scopes.some(s => {
    const rel = relative(s.baseDir, p)
    return matchesExclude(rel, s.exclude) || matchesSkip(rel, s.skip)
  })

  const indent = '  '.repeat(depth)
  const stats = { dirs: 0, files: 0, renamed: 0, hasModels: false, gridRef: 'ALL.js' }

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const subdirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'lib' && !excluded(join(dir, e.name)))
      .sort((a, b) => a.name.localeCompare(b.name))
    const modelFiles = findModelFiles(dir).filter(f => !excluded(join(dir, f)))

    console.log(`${indent}${basename(dir)}/`)

    // Process subdirectories first
    const subdirResults = []
    for (const subdir of subdirs) {
      const subdirPath = join(dir, subdir.name)
      const result = processDirectory(subdirPath, examplesRoot, depth + 1, scopes)
      subdirResults.push({ name: subdir.name, path: subdirPath, ...result })
      stats.dirs += result.dirs
      stats.files += result.files
      stats.renamed += result.renamed
    }

    // Collect items for this directory's ALL.js
    const items = []
    const preservePrefix = shouldPreservePrefix(dir, examplesRoot)

    // Add direct model files (excluding index-only directories' content)
    for (const file of modelFiles) {
      // Skip index.js if this is an index-only directory (will be handled by parent)
      if ((file === 'index.js' || file === 'index.scad') && isIndexOnlyDirectory(dir)) {
        continue
      }
      // Preserve prefix if in preserve list, otherwise remove it
      const filename = (options.noRename || preservePrefix) ? file : removePrefix(file)
      items.push('./' + filename)
    }

    items.push(...subdirItems(subdirResults))

    // Generate ALL.js if this directory has any items
    if (items.length > 0) {
      stats.hasModels = true
      stats.dirs++

      // Rename direct model files first (before generating ALL.js)
      // Only rename if not in preserve list
      if (!options.noRename && modelFiles.length > 0) {
        const renamed = renameFilesInDirectory(dir, modelFiles, examplesRoot)
        stats.renamed += renamed
      }

      // Regenerate items list after potential rename
      let finalItems = []
      const preservePrefix = shouldPreservePrefix(dir, examplesRoot)
      for (const file of modelFiles) {
        if ((file === 'index.js' || file === 'index.scad') && isIndexOnlyDirectory(dir)) {
          continue
        }
        const finalName = (options.noRename || preservePrefix) ? file : removePrefix(file)
        finalItems.push('./' + finalName)
      }
      finalItems.push(...subdirItems(subdirResults))
      const categories = loadCategories(dir)
      if (categories) finalItems = categoryGridItems(dir, categories, finalItems, examplesRoot, stats)

      // A grid of one sub-grid draws the same thing one level up, so the parent loads the child directly
      const onlyGrid = finalItems.length === 1 && finalItems[0].endsWith('/ALL.js') ? finalItems[0] : null
      if (onlyGrid) {
        stats.gridRef = onlyGrid.slice(2)
        stats.dirs--
        console.log(`${indent}  → ${relative(examplesRoot, join(dir, stats.gridRef))} (single sub-grid, no ALL.js here)`)
      } else {
        stats.files += generateAllFile(dir, finalItems, examplesRoot)
      }
    }
  } catch (err) {
    console.error(`Error processing ${dir}: ${err.message}`)
  }

  return stats
}

/**
 * Recursively clean ALL.js files from directory tree
 */
function cleanAllFiles(dir, depth = 0) {
  if (!existsSync(dir)) return 0

  let cleaned = 0
  try {
    const entries = readdirSync(dir, { withFileTypes: true })

    // Clean ALL.js and per-category grids in current directory
    for (const grid of entries.filter(e => e.isFile() && isGridFile(e.name))) {
      const allPath = join(dir, grid.name)
      if (options.dryRun) {
        console.log(`  [DRY RUN] Would remove ${allPath}`)
      } else {
        unlinkSync(allPath)
        if (depth === 0) console.log(`  Removed old ALL.js files...`)
      }
      cleaned++
    }

    // Recurse into subdirectories
    const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'lib')
    for (const subdir of subdirs) {
      cleaned += cleanAllFiles(join(dir, subdir.name), depth + 1)
    }
  } catch (err) {
    console.warn(`Warning: Could not clean ${dir}: ${err.message}`)
  }

  return cleaned
}

/**
 * Main execution
 */
function main() {
  console.log('Manifest-Driven ALL.js Generator')
  console.log('=================================')

  if (options.dryRun) {
    console.log('\n*** DRY RUN MODE - No files will be modified ***\n')
  }
  if (options.noRename) {
    console.log('\n*** NO RENAME - Files will keep numeric prefixes ***\n')
  }
  if (options.noClean) {
    console.log('\n*** NO CLEAN - Existing ALL.js files will not be removed ***\n')
  }

  if (!existsSync(options.examplesDir)) {
    console.error(`Error: Examples directory not found: ${options.examplesDir}`)
    process.exit(1)
  }

  console.log(`Scanning: ${options.examplesDir}`)
  console.log(`Config: preservePrefixDirs = ${JSON.stringify(config.preservePrefixDirs)}\n`)

  // Clean old ALL.js files before generating new ones
  if (config.cleanBeforeGenerate && !options.noClean) {
    const cleaned = cleanAllFiles(options.examplesDir)
    if (cleaned > 0 && !options.dryRun) {
      console.log(`  Cleaned ${cleaned} old ALL.js files\n`)
    }
  }

  const stats = processDirectory(options.examplesDir, options.examplesDir)

  console.log(`\n✓ Done!`)
  console.log(`  Generated ALL.js for ${stats.dirs} directories (${stats.files} total items)`)
  if (!options.noRename) {
    console.log(`  Renamed ${stats.renamed} files (removed numeric prefixes)`)
  }
}

main()
