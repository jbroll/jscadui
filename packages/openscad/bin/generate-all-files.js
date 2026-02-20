#!/usr/bin/env node

/**
 * Generate ALL.js grid files for directories containing models
 *
 * Manifest-driven approach:
 * - Generates ALL.js for ANY directory containing models (.js or .scad files)
 * - Treats directories with single index.js/index.scad as leaf model files
 * - Parent directories aggregate subdirectory ALL.js files and direct model files
 *
 * Usage:
 *   node bin/generate-all-files.js [options]
 *
 * Options:
 *   --dry-run         Show what would be done without making changes
 *   --no-rename       Generate ALL.js but don't rename files (keep numeric prefixes)
 *   --examples-dir    Path to examples directory (default: apps/jscad-web/examples)
 */

import { writeFileSync, readdirSync, renameSync, existsSync, unlinkSync } from 'fs'
import { join, basename, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  dryRun: args.includes('--dry-run'),
  noRename: args.includes('--no-rename'),
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
 * Find all model files in a directory (non-recursive)
 * Includes .scad, .js (but not ALL.js, index.js in certain cases)
 */
function findModelFiles(dir) {
  if (!existsSync(dir)) return []

  try {
    return readdirSync(dir)
      .filter(f => {
        if (f.startsWith('.')) return false
        if (f === 'ALL.js' || f === 'ALL.scad' || f === '__all__.scad') return false
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
function generateAllFile(dir, items, examplesRoot) {
  const libPath = getLibPath(dir, examplesRoot)
  const spacing = 60
  const cellSize = spacing * 0.85

  const itemsJson = JSON.stringify(items, null, 2)

  const content = `"use strict"
// Auto-generated ALL script – loads each model under its own params namespace,
// normalises it to the grid cell size, and positions it in a grid.
const { gridPosition, normalizeAndPlace, urlToPartName } = require('${libPath}')

const items = ${itemsJson}
const spacing = ${spacing}
const cellSize = ${cellSize}

const main = (params) => {
  const all = []
  const nameSeen = {}

  items.forEach((url, i) => {
    try {
      // Calculate grid position dynamically
      const [x, y] = gridPosition(i, items.length, spacing)

      // Derive unique part name from URL
      let name = urlToPartName(url)
      // Deduplicate: if the same name appears twice, append _2, _3, …
      if (nameSeen[name]) {
        nameSeen[name]++
        name = \`\${name}_\${nameSeen[name]}\`
      } else {
        nameSeen[name] = 1
      }

      // Give each sub-model its own params sub-object so inline param
      // definitions (params.foo = {type:'slider',...}) don't collide.
      params[name] = params[name] ?? {}
      const mod = require(url)
      const fn = (mod && mod.main) || (typeof mod === 'function' ? mod : null)
      if (typeof fn === 'function') {
        const geoms = [].concat(fn(params[name]))
        all.push(...normalizeAndPlace(geoms, x, y, cellSize))
      }
    } catch (err) {
      console.error('ALL: failed to load', url, err.message)
      throw new Error(\`Failed to load \${url}: \${err.message}\`)
    }
  })
  return all
}

module.exports = { main }
`

  const allPath = join(dir, 'ALL.js')

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
 * Rename files to remove numeric prefixes
 */
function renameFilesInDirectory(dir, files) {
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

/**
 * Process directory manifest-driven: generate ALL.js for any directory with models
 */
function processDirectory(dir, examplesRoot, depth = 0) {
  if (!existsSync(dir)) {
    console.warn(`Warning: Directory not found: ${dir}`)
    return { dirs: 0, files: 0, renamed: 0, hasModels: false }
  }

  const indent = '  '.repeat(depth)
  const stats = { dirs: 0, files: 0, renamed: 0, hasModels: false }

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'lib')
    const modelFiles = findModelFiles(dir)

    console.log(`${indent}${basename(dir)}/`)

    // Process subdirectories first
    const subdirResults = []
    for (const subdir of subdirs) {
      const subdirPath = join(dir, subdir.name)
      const result = processDirectory(subdirPath, examplesRoot, depth + 1)
      subdirResults.push({ name: subdir.name, path: subdirPath, ...result })
      stats.dirs += result.dirs
      stats.files += result.files
      stats.renamed += result.renamed
    }

    // Collect items for this directory's ALL.js
    const items = []

    // Add direct model files (excluding index-only directories' content)
    for (const file of modelFiles) {
      // Skip index.js if this is an index-only directory (will be handled by parent)
      if ((file === 'index.js' || file === 'index.scad') && isIndexOnlyDirectory(dir)) {
        continue
      }
      items.push('./' + (options.noRename ? file : removePrefix(file)))
    }

    // Add subdirectories that have models
    for (const subdir of subdirResults) {
      if (subdir.hasModels) {
        // Check if subdirectory is index-only
        if (isIndexOnlyDirectory(subdir.path)) {
          // Add direct reference to index file
          const indexFile = existsSync(join(subdir.path, 'index.js')) ? 'index.js' : 'index.scad'
          items.push(`./${subdir.name}/${indexFile}`)
        } else {
          // Add reference to subdirectory's ALL.js
          items.push(`./${subdir.name}/ALL.js`)
        }
      }
    }

    // Generate ALL.js if this directory has any items
    if (items.length > 0) {
      stats.hasModels = true
      stats.dirs++

      // Rename direct model files first (before generating ALL.js)
      if (!options.noRename && modelFiles.length > 0) {
        const renamed = renameFilesInDirectory(dir, modelFiles)
        stats.renamed += renamed
      }

      // Regenerate items list after potential rename
      const finalItems = []
      for (const file of modelFiles) {
        if ((file === 'index.js' || file === 'index.scad') && isIndexOnlyDirectory(dir)) {
          continue
        }
        const finalName = options.noRename ? file : removePrefix(file)
        finalItems.push('./' + finalName)
      }
      for (const subdir of subdirResults) {
        if (subdir.hasModels) {
          if (isIndexOnlyDirectory(subdir.path)) {
            const indexFile = existsSync(join(subdir.path, 'index.js')) ? 'index.js' : 'index.scad'
            finalItems.push(`./${subdir.name}/${indexFile}`)
          } else {
            finalItems.push(`./${subdir.name}/ALL.js`)
          }
        }
      }

      const count = generateAllFile(dir, finalItems, examplesRoot)
      stats.files += count
    }
  } catch (err) {
    console.error(`Error processing ${dir}: ${err.message}`)
  }

  return stats
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

  if (!existsSync(options.examplesDir)) {
    console.error(`Error: Examples directory not found: ${options.examplesDir}`)
    process.exit(1)
  }

  console.log(`Scanning: ${options.examplesDir}\n`)

  const stats = processDirectory(options.examplesDir, options.examplesDir)

  console.log(`\n✓ Done!`)
  console.log(`  Generated ALL.js for ${stats.dirs} directories (${stats.files} total items)`)
  if (!options.noRename) {
    console.log(`  Renamed ${stats.renamed} files (removed numeric prefixes)`)
  }
}

main()
