#!/usr/bin/env node

/**
 * OpenSCAD Translator Test Harness
 *
 * Tests the fidelity of the OpenSCAD to JSCAD translator by:
 * 1. Running OpenSCAD to generate reference STL (using Manifold backend)
 * 2. Translating to JSCAD and running with Manifold backend
 * 3. Comparing the two outputs using Jaccard similarity
 *
 * Usage:
 *   test-harness dir1 dir2 ...           Test all .scad files in directories
 *   test-harness --skip-file skip.txt    Skip files listed in skip.txt
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { resolve, basename, dirname, join, relative } from 'node:path'
import { execSync, exec } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { homedir, cpus } from 'node:os'

const execAsync = promisify(exec)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const VERSION = '0.2.0'
const DEFAULT_CONCURRENCY = Math.max(1, cpus().length - 1)

/**
 * Check if a path matches any skip pattern.
 * Patterns: exact match, filename only, or glob with * wildcards.
 */
function matchesSkipPattern(relativePath, patterns) {
  for (const pattern of patterns) {
    // Simple glob: convert * to regex .*
    const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
    if (regex.test(relativePath) || regex.test(basename(relativePath))) {
      return true
    }
  }
  return false
}

function parseArgs(args) {
  const options = {
    dirs: [],
    skipPatterns: [],  // Patterns to match against relative paths
    matchPatterns: [],  // --match: only include files matching these patterns
    threshold: 0.99,
    openscad: 'openscad',
    keepTemp: false,
    verbose: false,
    json: false,
    fn: 0,
    concurrency: DEFAULT_CONCURRENCY,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-h' || arg === '--help') {
      console.log(`
test-harness - OpenSCAD translator fidelity testing (v${VERSION})

Usage:
  test-harness <dir1> [dir2] ... [options]

  Directories are scanned recursively for .scad files.

Options:
  --skip-file <path>      File containing filenames/patterns to skip (one per line)
  --match <glob>          Only run files matching this glob pattern (repeatable)
                          Examples: --match "*/01-basics/*"
                                    --match "*/bosl/*" --match "*/bosl2/*"
  --threshold <n>         Minimum Jaccard for pass (default: 0.99)
  --fn <n>                Set global $fn for both OpenSCAD and transpiler
  --openscad <path>       Path to OpenSCAD binary (default: openscad)
  --concurrency <n>       Number of parallel tests (default: ${DEFAULT_CONCURRENCY})
  --keep-temp             Keep temporary files for debugging
  --verbose               Print detailed output
  --json                  Output results as JSON
  -h, --help              Show this help
`)
      process.exit(0)
    } else if (arg === '--verbose') {
      options.verbose = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--keep-temp') {
      options.keepTemp = true
    } else if (arg === '--threshold') {
      options.threshold = parseFloat(args[++i])
    } else if (arg === '--openscad') {
      options.openscad = args[++i]
    } else if (arg === '--fn') {
      options.fn = parseInt(args[++i], 10)
    } else if (arg === '--concurrency') {
      options.concurrency = parseInt(args[++i], 10)
    } else if (arg === '--skip-file') {
      try {
        const content = readFileSync(args[++i], 'utf8')
        for (const line of content.split('\n')) {
          const pattern = line.trim()
          if (pattern && !pattern.startsWith('#')) {
            options.skipPatterns.push(pattern)
          }
        }
      } catch (_err) {
        console.error(`Warning: Could not read skip file: ${args[i]}`)
      }
    } else if (arg === '--match') {
      options.matchPatterns.push(args[++i])
    } else if (!arg.startsWith('-')) {
      options.dirs.push(arg)
    } else {
      console.error(`Unknown option: ${arg}`)
      process.exit(1)
    }
    i++
  }

  return options
}

function checkOpenscad(openscadPath) {
  try {
    const version = execSync(`${openscadPath} --version 2>&1`, { encoding: 'utf8' })
    return { available: true, version: version.trim() }
  } catch {
    return { available: false }
  }
}

async function runOpenscad(scadPath, stlPath, openscadPath, fn = 0, originalPath = null) {
  const args = ['--backend=manifold', '-o', stlPath]
  if (fn > 0) args.push('-D', `"\\$fn=${fn}"`)
  args.push(scadPath)

  // Set OPENSCADPATH to the library directory if detected
  // Use originalPath if provided (for temp files that were copied)
  const pathForLibDetection = originalPath || scadPath
  const libDir = detectLibraryDir(pathForLibDetection)
  const env = libDir ? { ...process.env, OPENSCADPATH: resolve(libDir) } : process.env

  try {
    await execAsync(`${openscadPath} ${args.join(' ')}`, { timeout: 60000, env })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Detect library directory from file path
 * Examples:
 *   examples/openscad/bosl2/01-core/file.scad → examples/openscad/bosl2
 *   test/corpus/bosl2/file.scad → test/corpus/bosl2
 *   test/corpus/bosl2/lib/examples/file.scad → test/corpus/bosl2
 */
function detectLibraryDir(scadPath) {
  // Try examples/openscad/{library}/ pattern first
  let match = scadPath.match(/(.*\/openscad\/[^/]+)(?:\/|$)/)
  if (match) return match[1]

  // Try test/corpus/{library}/ pattern (handles files in subdirs like lib/examples/)
  match = scadPath.match(/(.*\/corpus\/[^/]+)(?:\/|$)/)
  if (match) return match[1]

  // Check if parent or ancestor directory contains lib/
  let dir = dirname(scadPath)
  for (let i = 0; i < 3; i++) {  // Check up to 3 levels up
    if (existsSync(join(dir, 'lib'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break  // Reached root
    dir = parent
  }

  return null
}

async function runJscad(scadPath, stlPath, fn = 0) {
  const runJscadPath = join(__dirname, 'run-jscad.js')
  const fnArg = fn > 0 ? ` --fn ${fn}` : ''

  // Auto-detect library directory (for OPENSCADPATH-like behavior)
  const libDir = detectLibraryDir(scadPath)
  const libPathArg = libDir ? ` --lib-path "${resolve(libDir)}"` : ''

  try {
    await execAsync(`node ${runJscadPath} "${scadPath}" -o "${stlPath}"${fnArg}${libPathArg}`, { timeout: 60000 })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

async function compareStl(refStl, genStl) {
  const compareStlPath = join(__dirname, 'compare-stl.js')

  try {
    const { stdout } = await execAsync(`node ${compareStlPath} "${refStl}" "${genStl}"`, { timeout: 120000 })
    const match = stdout.match(/Jaccard:\s*([\d.]+)/)
    if (match) return { success: true, jaccard: parseFloat(match[1]) }
    return { success: false, error: 'Could not parse Jaccard' }
  } catch (err) {
    const match = err.stdout?.match(/Jaccard:\s*([\d.]+)/)
    if (match) return { success: true, jaccard: parseFloat(match[1]) }
    return { success: false, error: err.message }
  }
}

function copyDependencies(scadPath, tempDir, visited = new Set(), tempRelativeDir = '') {
  const resolvedPath = resolve(scadPath)
  if (visited.has(resolvedPath)) return
  visited.add(resolvedPath)

  const sourceDir = dirname(scadPath)
  const content = readFileSync(scadPath, 'utf8')
  const useRegex = /(?:use|include)\s*<([^>]+)>/g
  let match

  while ((match = useRegex.exec(content)) !== null) {
    const depPath = match[1]
    const sourcePath = join(sourceDir, depPath)
    const destPath = join(tempDir, tempRelativeDir, depPath)

    if (existsSync(sourcePath)) {
      mkdirSync(dirname(destPath), { recursive: true })
      copyFileSync(sourcePath, destPath)
      const newRelativeDir = join(tempRelativeDir, dirname(depPath))
      copyDependencies(sourcePath, tempDir, visited, newRelativeDir)
    }
  }
}

async function testFile(scadPath, options) {
  const name = basename(scadPath)
  const tempDir = join(homedir(), '.cache', 'scad-test', `${Date.now()}-${Math.random().toString(36).slice(2)}`)

  mkdirSync(tempDir, { recursive: true })

  const tempScad = join(tempDir, 'input.scad')
  copyFileSync(scadPath, tempScad)
  copyDependencies(scadPath, tempDir)

  const refStl = join(tempDir, 'reference.stl')
  const genStl = join(tempDir, 'generated.stl')

  const result = { name, path: scadPath, jaccard: null, pass: false, error: null }

  try {
    // Pass original scadPath for library detection (tempScad is in temp dir)
    const openscadResult = await runOpenscad(tempScad, refStl, options.openscad, options.fn, scadPath)
    if (!openscadResult.success) {
      result.error = `OpenSCAD: ${openscadResult.error}`
      return result
    }

    const jscadResult = await runJscad(scadPath, genStl, options.fn)
    if (!jscadResult.success) {
      result.error = `JSCAD: ${jscadResult.error}`
      return result
    }

    const compareResult = await compareStl(refStl, genStl)
    if (!compareResult.success) {
      result.error = `Compare: ${compareResult.error}`
      return result
    }

    result.jaccard = compareResult.jaccard
    result.pass = result.jaccard >= options.threshold
  } finally {
    if (!options.keepTemp) {
      try { rmSync(tempDir, { recursive: true }) } catch { /* ignore cleanup errors */ }
    }
  }

  return result
}

/**
 * Convert a glob pattern (supporting * and **) to a RegExp.
 * * matches any path segment characters except /
 * ** matches any sequence of characters including /
 */
function globToRegex(pattern) {
  // Split on ** first, then handle * within each segment
  const parts = pattern.split('**')
  const regexStr = parts
    .map(part =>
      part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
    )
    .join('.*')
  return new RegExp(regexStr)
}

function matchesPatterns(filePath, patterns) {
  if (patterns.length === 0) return true
  // Normalise to forward slashes for consistent matching
  const normalised = filePath.replace(/\\/g, '/')
  return patterns.some(p => {
    const rx = globToRegex(p)
    return rx.test(normalised) || rx.test(basename(normalised))
  })
}

function collectScadFiles(dirPath, files) {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const full = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      // Skip hidden dirs and known non-test dirs (images, build artifacts)
      if (!entry.name.startsWith('.') && entry.name !== 'Image') {
        collectScadFiles(full, files)
      }
    } else if (entry.name.endsWith('.scad')) {
      files.push(full)
    }
  }
}

function getTestFiles(dirs, matchPatterns = []) {
  const files = []
  for (const dir of dirs) {
    const dirPath = resolve(dir)
    if (!existsSync(dirPath)) {
      console.error(`Warning: Directory not found: ${dirPath}`)
      continue
    }
    collectScadFiles(dirPath, files)
  }
  if (matchPatterns.length > 0) {
    return files.filter(f => matchesPatterns(f, matchPatterns))
  }
  return files
}

async function runWithConcurrency(tasks, concurrency) {
  const results = []
  let index = 0

  async function worker() {
    while (index < tasks.length) {
      const currentIndex = index++
      results[currentIndex] = await tasks[currentIndex]()
    }
  }

  await Promise.all(Array(Math.min(concurrency, tasks.length)).fill(null).map(worker))
  return results
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.dirs.length === 0) {
    console.error('Usage: test-harness <dir1> [dir2] ... [options]')
    console.error('Use -h for help.')
    process.exit(1)
  }

  const openscadInfo = checkOpenscad(options.openscad)
  if (!openscadInfo.available) {
    console.error(`Error: OpenSCAD not found at '${options.openscad}'`)
    process.exit(1)
  }

  const files = getTestFiles(options.dirs, options.matchPatterns)
  if (files.length === 0) {
    console.error('No .scad files found in specified directories.')
    if (options.matchPatterns.length > 0) {
      console.error(`  (--match filters active: ${options.matchPatterns.join(', ')})`)
    }
    process.exit(1)
  }

  // Filter out skipped files (match against relative path from cwd)
  const cwd = process.cwd()
  const filesToTest = files.filter(f => !matchesSkipPattern(relative(cwd, f), options.skipPatterns))
  const skipped = files.length - filesToTest.length

  if (options.verbose) {
    console.error(`Testing ${filesToTest.length} files with ${options.concurrency} workers...`)
  }

  // Create tasks
  const tasks = filesToTest.map(file => () => testFile(file, options))

  // Run with concurrency
  const results = await runWithConcurrency(tasks, options.concurrency)

  // Tally results
  let passed = 0, failed = 0, translatorErrors = 0, openscadErrors = 0

  for (const result of results) {
    if (result.error) {
      if (result.error.startsWith('OpenSCAD:')) {
        openscadErrors++
      } else {
        translatorErrors++
        if (!options.json) console.log(`${result.name}: ERROR - ${result.error}`)
      }
    } else if (result.pass) {
      passed++
      if (options.verbose && !options.json) {
        console.log(`${result.name}: PASS (${result.jaccard.toFixed(4)})`)
      }
    } else {
      failed++
      if (!options.json) console.log(`${result.name}: FAIL (${result.jaccard.toFixed(4)})`)
    }
  }

  const tested = filesToTest.length - openscadErrors
  const passRate = tested > 0 ? ((passed / tested) * 100).toFixed(1) : '0.0'

  if (options.json) {
    console.log(JSON.stringify({
      summary: { total: files.length, tested, passed, failed, translatorErrors, openscadErrors, skipped },
      threshold: options.threshold,
      passRate: `${passRate}%`,
      results
    }, null, 2))
  } else {
    console.log(`\nSummary: ${passed} passed, ${failed} failed, ${translatorErrors} errors out of ${tested} tested (${passRate}%)`)
    if (openscadErrors > 0 || skipped > 0) {
      const reasons = []
      if (openscadErrors > 0) reasons.push(`${openscadErrors} OpenSCAD failures`)
      if (skipped > 0) reasons.push(`${skipped} in skip list`)
      console.log(`Skipped: ${reasons.join(', ')}`)
    }
    console.log(`Threshold: ${options.threshold}`)
  }

  process.exit(failed + translatorErrors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
