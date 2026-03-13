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

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { resolve, basename, dirname, join, relative } from 'node:path'
import { execSync, exec } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { homedir, cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { runScadToStl } from './run-jscad.js'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ── OpenSCAD STL cache ────────────────────────────────────────────────────
// Caches reference STLs in .deps-cache/openscad-stl/ to skip flatpak re-renders.
// Cache validity is per-library: invalidated when the library's lib/ dir changes.

const REPO_ROOT = join(__dirname, '..', '..', '..')
const STL_CACHE_ROOT = join(REPO_ROOT, '.deps-cache', 'openscad-stl')

/** Hash all .scad files in a directory tree (sorted, deterministic). */
function hashDirectory(dir) {
  const hash = createHash('sha256')
  function walk(d) {
    const entries = readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.scad')) hash.update(readFileSync(full))
    }
  }
  walk(dir)
  return hash.digest('hex').slice(0, 16)
}

/** Extract library name from a scad path (.../examples/openscad/<lib>/...). */
function getLibraryName(scadPath) {
  const m = scadPath.match(/[/\\]examples[/\\]openscad[/\\]([^/\\]+)/)
  return m ? m[1] : null
}

/** Stable cache path for a given source file and $fn value. */
function stlCachePath(originalScadPath, fn, libName) {
  const marker = `examples/openscad/${libName}/`
  const idx = originalScadPath.replace(/\\/g, '/').indexOf(marker)
  if (idx < 0) return null
  const rel = originalScadPath.slice(idx + marker.length)
  const suffix = fn > 0 ? `.fn${fn}.stl` : '.stl'
  return join(STL_CACHE_ROOT, libName, rel + suffix)
}

function failedCachePath(originalScadPath, fn, libName) {
  const p = stlCachePath(originalScadPath, fn, libName)
  return p ? p.replace(/\.stl$/, '.failed') : null
}

/**
 * Manages the OpenSCAD STL cache for a single test run.
 * Libraries are validated lazily on first access.
 *
 * Each library gets its own hash file (.deps-cache/openscad-stl/<lib>/.hash)
 * so parallel test runners don't race on a shared meta file.
 */
class StlCache {
  constructor() {
    this._validated = {}     // libName → boolean
    this._hits = 0
    this._misses = 0
    this._failedHits = 0
    this._dirtyLibs = new Set()  // libs whose hash file needs writing
    this._hashes = {}        // libName → computed hash
  }

  _hashFilePath(libName) {
    return join(STL_CACHE_ROOT, libName, '.hash')
  }

  _readStoredHash(libName) {
    const p = this._hashFilePath(libName)
    return existsSync(p) ? readFileSync(p, 'utf8').trim() : null
  }

  /** Validate a library's cache (compute hash, compare, invalidate if changed). */
  _validate(libName, originalScadPath) {
    if (libName in this._validated) return this._validated[libName]

    // Find the library root from the scad path
    const marker = `examples/openscad/${libName}`
    const norm = originalScadPath.replace(/\\/g, '/')
    const idx = norm.indexOf(marker)
    if (idx < 0) { this._validated[libName] = false; return false }
    const libRoot = originalScadPath.slice(0, idx + marker.length)

    // Hash lib/ dir if it exists, else hash the library root itself
    const libDir = join(libRoot, 'lib')
    const hashTarget = existsSync(libDir) ? libDir : libRoot
    const hash = hashDirectory(hashTarget)
    this._hashes[libName] = hash
    this._dirtyLibs.add(libName)

    const stored = this._readStoredHash(libName)
    if (stored !== hash) {
      // Library changed — purge its cached STLs (but keep the dir for new cache)
      const libCacheDir = join(STL_CACHE_ROOT, libName)
      if (existsSync(libCacheDir)) {
        rmSync(libCacheDir, { recursive: true })
        process.stderr.write(`[stl-cache] invalidated ${libName} (lib changed)\n`)
      }
    }
    this._validated[libName] = true
    return true
  }

  /**
   * Check the cache for a source file.
   * Returns null (miss), { failed: true } (known failure), or { stlPath } (hit).
   */
  check(originalScadPath, fn) {
    const libName = getLibraryName(originalScadPath)
    if (!libName || !this._validate(libName, originalScadPath)) return null

    const failed = failedCachePath(originalScadPath, fn, libName)
    if (failed && existsSync(failed)) { this._failedHits++; return { failed: true } }

    const cached = stlCachePath(originalScadPath, fn, libName)
    if (cached && existsSync(cached)) { this._hits++; return { stlPath: cached } }

    this._misses++
    return null
  }

  /** Save a successful render to cache. */
  saveHit(originalScadPath, generatedStlPath, fn) {
    const libName = getLibraryName(originalScadPath)
    if (!libName) return
    const dest = stlCachePath(originalScadPath, fn, libName)
    if (!dest) return
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(generatedStlPath, dest)
  }

  /** Save a failed render sentinel to cache. */
  saveFailed(originalScadPath, fn, errorMsg) {
    const libName = getLibraryName(originalScadPath)
    if (!libName) return
    const dest = failedCachePath(originalScadPath, fn, libName)
    if (!dest) return
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, errorMsg || 'failed')
  }

  /** Persist per-library hash files. Safe to call from parallel processes. */
  flush() {
    for (const libName of this._dirtyLibs) {
      const hashFile = this._hashFilePath(libName)
      mkdirSync(dirname(hashFile), { recursive: true })
      writeFileSync(hashFile, this._hashes[libName])
    }
  }

  stats() {
    return { hits: this._hits, misses: this._misses, failedHits: this._failedHits }
  }
}

// Shared transpiler cache — persists across all test files in this run.
// After the first BOSL2 file fully transpiles std.scad and its 30+ deps,
// subsequent files use the fast-path (paramLists lookup only, no re-fetching).

// Mutex for in-process JSCAD execution.
// The openscad runtime uses a module-level scope stack (specialVars.js).
// Concurrent in-process executions corrupt each other's scope state.
// We serialize JSCAD runs with a simple promise-based queue.
let _jscadMutexQueue = Promise.resolve()
function withJscadMutex(fn) {
  const result = _jscadMutexQueue.then(fn)
  // Advance the queue even if fn rejects (so subsequent callers aren't blocked)
  _jscadMutexQueue = result.catch(() => {})
  return result
}
const sharedTranspilerCache = new Map()

const VERSION = '0.2.0'
const DEFAULT_CONCURRENCY = Math.min(4, Math.max(1, cpus().length - 1))

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
    noStlCache: false,
    stlCache: null,    // populated in main() after parsing
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
  --concurrency <n>       Number of parallel tests (default: ${DEFAULT_CONCURRENCY}, max 4)
  --no-stl-cache          Disable OpenSCAD STL cache (always re-render)
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
    } else if (arg === '--no-stl-cache') {
      options.noStlCache = true
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

async function runOpenscad(scadPath, stlPath, openscadPath, fn = 0, originalPath = null, stlCache = null) {
  const pathForLibDetection = originalPath || scadPath

  // Check STL cache before invoking flatpak
  if (stlCache) {
    const cached = stlCache.check(pathForLibDetection, fn)
    if (cached) {
      if (cached.failed) return { success: false, error: 'OpenSCAD render failed (cached)', cached: true }
      copyFileSync(cached.stlPath, stlPath)
      return { success: true, cached: true }
    }
  }

  const args = ['--backend=manifold', '-o', stlPath]
  if (fn > 0) args.push('-D', `"\\$fn=${fn}"`)
  args.push(scadPath)

  const libDir = detectLibraryDir(pathForLibDetection)
  const env = libDir ? { ...process.env, OPENSCADPATH: resolve(libDir) } : process.env

  try {
    await execAsync(`${openscadPath} ${args.join(' ')}`, { timeout: 60000, env })
    stlCache?.saveHit(pathForLibDetection, stlPath, fn)
    return { success: true }
  } catch (err) {
    stlCache?.saveFailed(pathForLibDetection, fn, err.message)
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
  // Try test/corpus/{library}/ pattern first (more specific — must come before openscad pattern
  // since corpus paths contain "openscad" in the package dir and would match incorrectly)
  let match = scadPath.match(/(.*\/corpus\/[^/]+)(?:\/|$)/)
  if (match) return match[1]

  // Try examples/openscad/{library}/ pattern
  match = scadPath.match(/(.*\/examples\/openscad\/[^/]+)(?:\/|$)/)
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
  const libDir = detectLibraryDir(scadPath)
  const libPaths = libDir ? [resolve(libDir)] : []

  try {
    // Serialize JSCAD execution to prevent scope stack corruption.
    // The openscad runtime uses module-level mutable state; concurrent runs corrupt it.
    await withJscadMutex(() => runScadToStl(scadPath, stlPath, fn, libPaths, sharedTranspilerCache))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

async function compareStl(refStl, genStl) {
  // Run each comparison in a subprocess to give each test a fresh WASM instance.
  // This prevents WASM heap exhaustion when many large meshes are processed sequentially.
  const compareScript = join(__dirname, 'compare-stl.js')
  try {
    const { stdout } = await execAsync(
      `node ${compareScript} ${refStl} ${genStl}`,
      { maxBuffer: 1024 * 1024 }
    )
    // compare-stl.js outputs "Jaccard: X.XXXXXX" to stdout
    const match = stdout.match(/Jaccard:\s*([\d.]+)/)
    if (!match) throw new Error(`Unexpected output: ${stdout}`)
    const jaccard = parseFloat(match[1])
    return { success: true, jaccard }
  } catch (err) {
    // exec rejects on non-zero exit (fail = exit 1), but stdout still has Jaccard
    const stdout = err.stdout || ''
    const match = stdout.match(/Jaccard:\s*([\d.]+)/)
    if (match) return { success: true, jaccard: parseFloat(match[1]) }
    return { success: false, error: err.message || String(err) }
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
    const openscadResult = await runOpenscad(tempScad, refStl, options.openscad, options.fn, scadPath, options.stlCache)
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
      // Skip hidden dirs and lib/ directories (library source, not runnable examples)
      if (!entry.name.startsWith('.') && entry.name !== 'lib') {
        collectScadFiles(full, files)
      }
    } else if (entry.name.endsWith('.scad')) {
      files.push(full)
    }
  }
}

/**
 * Auto-discover skip.txt files within the given directories and their subdirectories.
 * Each skip.txt in a directory adds its patterns scoped to that directory
 * (patterns match against the basename of files under that directory).
 */
function discoverSkipPatterns(dirs) {
  const dirSkips = []  // [{dir, patterns}]

  function walk(dirPath) {
    const skipFile = join(dirPath, 'skip.txt')
    if (existsSync(skipFile)) {
      try {
        const content = readFileSync(skipFile, 'utf8')
        const patterns = []
        for (const line of content.split('\n')) {
          const pattern = line.trim()
          if (pattern && !pattern.startsWith('#')) {
            patterns.push(pattern)
          }
        }
        if (patterns.length > 0) {
          dirSkips.push({ dir: resolve(dirPath), patterns })
        }
      } catch { /* ignore unreadable skip files */ }
    }
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(join(dirPath, entry.name))
      }
    }
  }

  for (const dir of dirs) {
    if (existsSync(resolve(dir))) walk(resolve(dir))
  }
  return dirSkips
}

/**
 * Check if a file should be skipped based on directory-scoped skip patterns.
 */
function isSkippedByDirPatterns(filePath, dirSkips) {
  const resolvedFile = resolve(filePath)
  for (const { dir, patterns } of dirSkips) {
    // Only apply patterns from a skip.txt to files under that directory
    if (!resolvedFile.startsWith(dir + '/') && resolvedFile !== dir) continue
    for (const pattern of patterns) {
      const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
      if (regex.test(basename(resolvedFile)) || regex.test(relative(dir, resolvedFile))) {
        return true
      }
    }
  }
  return false
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

  // Init STL cache (skip if disabled or running with custom $fn)
  if (!options.noStlCache) {
    options.stlCache = new StlCache()
  }

  const files = getTestFiles(options.dirs, options.matchPatterns)
  if (files.length === 0) {
    console.error('No .scad files found in specified directories.')
    if (options.matchPatterns.length > 0) {
      console.error(`  (--match filters active: ${options.matchPatterns.join(', ')})`)
    }
    process.exit(1)
  }

  // Auto-discover skip.txt files from the tested directories (directory-scoped patterns)
  const dirSkips = discoverSkipPatterns(options.dirs)

  // Filter out skipped files: explicit --skip-file patterns OR auto-discovered skip.txt patterns
  const cwd = process.cwd()
  const filesToTest = files.filter(f =>
    !matchesSkipPattern(relative(cwd, f), options.skipPatterns) &&
    !isSkippedByDirPatterns(f, dirSkips)
  )
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

  // Flush STL cache and report stats
  if (options.stlCache) {
    options.stlCache.flush()
    const { hits, misses, failedHits } = options.stlCache.stats()
    if (!options.json && (hits + misses + failedHits > 0)) {
      const total = hits + misses + failedHits
      console.log(`STL cache: ${hits} hits, ${misses} misses, ${failedHits} known failures (${Math.round(hits / total * 100)}% hit rate)`)
    }
  }

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
