#!/usr/bin/env node

/**
 * OpenSCAD Translator Test Harness
 *
 * Tests the fidelity of the OpenSCAD to JSCAD translator by:
 * 1. Running OpenSCAD to generate reference STL (using Manifold backend)
 * 2. Translating to JSCAD and running with Manifold backend
 * 3. Comparing the two outputs using Jaccard similarity
 * 4. Comparing their echo() output line for line
 *
 * A model whose OpenSCAD top level is empty (it only echoes) is graded on its
 * echo() output alone, and JSCAD must then produce no geometry either.
 *
 * Usage:
 *   test-harness dir1 dir2 ...           Test all .scad files in directories
 *   test-harness --skip-file skip.txt    Skip files listed in skip.txt
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync, copyFileSync, statSync } from 'node:fs'
import { resolve, basename, dirname, join, relative } from 'node:path'
import { execSync, exec } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir, cpus, totalmem } from 'node:os'
import { fileURLToPath } from 'node:url'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ── OpenSCAD STL cache ────────────────────────────────────────────────────
// Extracted to bin/stl-cache.js so it can be unit-tested. Stored in
// ~/.cache/jscadui/openscad-stl/ so it persists across CI worktrees.
import { StlCache } from './stl-cache.js'
import { parseEchoExport, compareEcho, describeEchoMismatch } from './echo-compare.js'

// OpenSCAD's message when the STL export has nothing to write
const EMPTY_TOP_LEVEL = 'Current top level object is empty.'

const VERSION = '0.2.0'
const OPENSCAD_TIMEOUT = 60_000
// Limit by CPU count AND available memory (each JSCAD subprocess uses ~3GB).
// This prevents OOM on laptops when running the full comparison suite locally.
const MEM_PER_WORKER = 3e9
const JSCAD_TIMEOUT = 120_000
const DEFAULT_CONCURRENCY = Math.min(Math.max(1, cpus().length - 1), Math.max(1, Math.floor(totalmem() / MEM_PER_WORKER)))

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
    preview: false,
    echo: true,
    list: false,
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
  --no-dir-skips          Ignore auto-discovered skip.txt, compare-skip.txt and
                          echo-skip.txt files
  --match <glob>          Only run files matching this glob pattern (repeatable)
                          Examples: --match "*/01-basics/*"
                                    --match "*/bosl/*" --match "*/bosl2/*"
  --threshold <n>         Minimum Jaccard for pass (default: 0.99)
  --fn <n>                Set global $fn for both OpenSCAD and transpiler
  --openscad <path>       Path to OpenSCAD binary (default: openscad)
  --concurrency <n>       Number of parallel tests (default: ${DEFAULT_CONCURRENCY})
  --no-stl-cache          Disable OpenSCAD STL cache (always re-render)
  --preview               Set $preview=true for both OpenSCAD and transpiler
  --no-echo               Grade geometry only: skip the echo() comparison
                          (models that only echo are then NOT GRADED)
  --list                  Print the files that would be graded and exit
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
    } else if (arg === '--preview') {
      options.preview = true
    } else if (arg === '--list') {
      options.list = true
    } else if (arg === '--no-echo') {
      options.echo = false
    } else if (arg === '--no-dir-skips') {
      options.noDirSkips = true
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

/**
 * Render the reference: STL and echo() export from one OpenSCAD run.
 * Returns { success, empty, echoPath, cached } or { success: false, error }.
 * `empty` means the top level is empty (the model only echoes): OpenSCAD
 * fails the STL export but writes the echo export, and no STL is left.
 */
async function runOpenscad(scadPath, stlPath, echoPath, openscadPath, fn = 0, originalPath = null, stlCache = null, preview = false) {
  const pathForLibDetection = originalPath || scadPath

  // Check STL cache before invoking flatpak
  if (stlCache) {
    const cached = stlCache.check(pathForLibDetection, fn, preview)
    if (cached) {
      if (cached.failed) return { success: false, error: `${cached.failed} (cached)`, cached: true }
      if (!cached.empty) copyFileSync(cached.stlPath, stlPath)
      copyFileSync(cached.echoPath, echoPath)
      return { success: true, empty: cached.empty, echoPath, cached: true }
    }
  }

  // Paths go through a shell: quote them (snippet's "Angle Shelf.scad").
  const args = ['--backend=manifold', '-o', JSON.stringify(stlPath), '-o', JSON.stringify(echoPath)]
  if (fn > 0) args.push('-D', `"\\$fn=${fn}"`)
  // Always set: with a second -o, OpenSCAD evaluates the model again for the
  // echo export, and that evaluation defaults to $preview = true.
  args.push('-D', `"\\$preview=${preview}"`)
  args.push(JSON.stringify(scadPath))

  const libDir = detectLibraryDir(pathForLibDetection)
  const env = libDir ? { ...process.env, OPENSCADPATH: resolve(libDir) } : process.env

  try {
    // OpenSCAD writes every echo to stderr too; a model that echoes a lot
    // (issue4172-echo-vector-stack-exhaust) overflows the 1 MB default.
    await execAsync(`${openscadPath} ${args.join(' ')}`, { timeout: OPENSCAD_TIMEOUT, env, maxBuffer: 64 * 1024 * 1024 })
    stlCache?.saveHit(pathForLibDetection, { stlPath, echoPath }, fn, preview)
    return { success: true, empty: false, echoPath }
  } catch (err) {
    // A timeout under load says nothing about the model, so it is not cached
    if (err.killed) return { success: false, error: `timed out after ${OPENSCAD_TIMEOUT} ms` }
    // Nothing to export is the reference for a model that only echoes
    if (err.stderr?.includes(EMPTY_TOP_LEVEL) && existsSync(echoPath)) {
      rmSync(stlPath, { force: true })
      stlCache?.saveHit(pathForLibDetection, { stlPath: null, echoPath }, fn, preview)
      return { success: true, empty: true, echoPath }
    }
    stlCache?.saveFailed(pathForLibDetection, fn, err.message, preview)
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

/**
 * Transpile and run the model. With `echoPath`, run-jscad writes the echo()
 * output there and an empty result is not an error: no STL is written.
 */
async function runJscad(scadPath, stlPath, fn = 0, preview = false, echoPath = null, openscadVersion = null) {
  const libDir = detectLibraryDir(scadPath)
  const runJscadScript = join(__dirname, 'run-jscad.js')
  const args = [runJscadScript, JSON.stringify(scadPath), '-o', JSON.stringify(stlPath)]
  if (echoPath) args.push('--echo', JSON.stringify(echoPath))
  // version() must report the reference's OpenSCAD to echo the same thing
  if (openscadVersion) args.push('--openscad-version', openscadVersion)
  if (fn > 0) args.push('--fn', fn)
  if (preview) args.push('--preview')
  if (libDir) args.push('--lib-path', JSON.stringify(resolve(libDir)))
  args.push('--timeout', '0')  // harness manages timeout via execAsync; disable internal guard
  const cmd = `node --stack-size=65536 ${args.join(' ')}`
  const opts = { timeout: JSCAD_TIMEOUT, maxBuffer: 2 * 1024 * 1024 }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await execAsync(cmd, opts)
      return { success: true }
    } catch (err) {
      // If the process crashed after writing the STL (e.g., WASM cleanup failure),
      // treat it as success so we can still compare the output.
      if (existsSync(stlPath)) {
        try {
          const content = readFileSync(stlPath)
          if (content.length > 0) return { success: true }
        } catch { /* fall through */ }
      }
      // Retry once on process-level failures (OOM, timeout under load)
      if (attempt === 0) continue
      if (err.killed) return { success: false, error: `timed out after ${JSCAD_TIMEOUT} ms` }
      return { success: false, error: jscadErrorLine(err) }
    }
  }
}

/**
 * The line of run-jscad's stderr that says what failed: its own report
 * ("main() threw: ...", "Execution error: ...") rather than the last line,
 * which is usually a stack frame. Falls back to the last line, then the message.
 */
function jscadErrorLine(err) {
  const lines = (err.stderr || '').split('\n').map(l => l.trim()).filter(Boolean)
  return lines.find(l => /^(main\(\) threw|Execution error|run-jscad: timeout)/.test(l)) || lines.pop() || err.message
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


/**
 * Whether run-jscad wrote any triangles: it writes no file for an empty
 * result, and exportStl() writes just the solid/endsolid lines for a mesh
 * without triangles.
 */
function hasGeometry(stlPath) {
  return existsSync(stlPath) && statSync(stlPath).size > 'solid JSCAD\nendsolid JSCAD\n'.length
}

async function testFile(scadPath, options) {
  const name = basename(scadPath)
  const tempDir = join(homedir(), '.cache', 'scad-test', `${Date.now()}-${Math.random().toString(36).slice(2)}`)

  mkdirSync(tempDir, { recursive: true })

  const refStl = join(tempDir, 'reference.stl')
  const genStl = join(tempDir, 'generated.stl')
  const refEcho = join(tempDir, 'reference.echo')
  const genEcho = join(tempDir, 'generated.echo.json')

  // textOnly: graded on echo() alone. echo: compareEcho() result.
  const result = { name, path: scadPath, jaccard: null, textOnly: false, echo: null, pass: false, error: null }

  try {
    // Use the original scadPath directly — OpenSCAD resolves includes relative to the
    // source file's directory, so no temp copy or copyDependencies needed.
    // Passing a temp copy caused a race condition: includes with `..` paths escaped
    // the temp dir into a shared parent, allowing concurrent workers to overwrite
    // the same dependency files while OpenSCAD was reading them.
    const openscadResult = await runOpenscad(scadPath, refStl, refEcho, options.openscad, options.fn, null, options.stlCache, options.preview)
    if (!openscadResult.success) {
      result.error = `OpenSCAD: ${openscadResult.error}`
      return result
    }
    // An empty top level after an evaluation error (failed assert, recursion
    // limit) is OpenSCAD failing, not a model that only echoes.
    const evalError = openscadResult.empty && readFileSync(refEcho, 'utf8').match(/^ERROR: .*/m)?.[0]
    if (evalError) {
      result.error = `OpenSCAD: ${evalError}`
      return result
    }
    const compareText = options.echo && !isSkippedByDirPatterns(scadPath, options.echoSkips)
    if (openscadResult.empty && !compareText) {
      // Nothing left to grade: counted with the models that have no reference
      result.error = `OpenSCAD: ${EMPTY_TOP_LEVEL} (echo not compared)`
      return result
    }
    result.textOnly = openscadResult.empty

    const jscadResult = await runJscad(scadPath, genStl, options.fn, options.preview, compareText ? genEcho : null, options.openscadVersion)
    if (!jscadResult.success) {
      result.error = `JSCAD: ${jscadResult.error}`
      return result
    }

    const genHasGeometry = hasGeometry(genStl)
    if (result.textOnly && genHasGeometry) {
      result.error = 'JSCAD: produced geometry, OpenSCAD\'s top level is empty'
      return result
    }
    if (!result.textOnly && !genHasGeometry) {
      result.error = 'JSCAD: No geometry returned from main()'
      return result
    }

    if (!result.textOnly) {
      const compareResult = await compareStl(refStl, genStl)
      if (!compareResult.success) {
        result.error = `Compare: ${compareResult.error}`
        return result
      }
      result.jaccard = compareResult.jaccard
    }

    if (compareText) {
      let gen
      try {
        gen = JSON.parse(readFileSync(genEcho, 'utf8'))
      } catch (err) {
        result.error = `JSCAD: no echo output (${err.message})`
        return result
      }
      result.echo = compareEcho(parseEchoExport(readFileSync(refEcho, 'utf8')), gen)
    }

    result.pass = (result.textOnly || result.jaccard >= options.threshold) && (result.echo?.match ?? true)
  } finally {
    if (!options.keepTemp) {
      try { rmSync(tempDir, { recursive: true }) } catch { /* ignore cleanup errors */ }
    }
  }

  return result
}

/** Result detail for the report: Jaccard and/or echo line count, or what differed. */
function describeResult(result, threshold) {
  const parts = []
  if (!result.textOnly) parts.push(result.jaccard.toFixed(4) + (result.jaccard < threshold ? ' below threshold' : ''))
  if (result.echo) parts.push(result.echo.match ? `echo ${result.echo.refCount} lines` : describeEchoMismatch(result.echo))
  if (result.textOnly) parts.push('text only')
  return parts.join('; ')
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
  // Accept a single .scad file directly
  if (dirPath.endsWith('.scad')) {
    files.push(dirPath)
    return
  }
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const full = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      // Skip hidden dirs only; lib/ exclusion is handled via skip.txt patterns
      if (!entry.name.startsWith('.')) {
        collectScadFiles(full, files)
      }
    } else if (entry.name.endsWith('.scad')) {
      files.push(full)
    }
  }
}

/**
 * Auto-discover named pattern files (skip.txt or exclude.txt) within directories.
 * Each file adds its patterns scoped to the directory it lives in.
 * Patterns support * wildcards and trailing / as a directory shorthand.
 */
function discoverDirPatterns(dirs, filename) {
  const dirPatterns = []  // [{dir, patterns}]

  function walk(dirPath) {
    const patternFile = join(dirPath, filename)
    if (existsSync(patternFile)) {
      try {
        const content = readFileSync(patternFile, 'utf8')
        const patterns = []
        for (const line of content.split('\n')) {
          const pattern = line.trim()
          if (pattern && !pattern.startsWith('#')) {
            patterns.push(pattern)
          }
        }
        if (patterns.length > 0) {
          dirPatterns.push({ dir: resolve(dirPath), patterns })
        }
      } catch { /* ignore unreadable files */ }
    }
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(join(dirPath, entry.name))
      }
    }
  }

  for (const dir of dirs) {
    const abs = resolve(dir)
    if (existsSync(abs) && !abs.endsWith('.scad')) walk(abs)
  }
  return dirPatterns
}

/** Convenience wrappers */
// skip.txt: does not render, so every sweep skips it. compare-skip.txt: renders,
// but its reference STL cannot grade it, so only this harness skips it.
const discoverSkipPatterns = dirs => [
  ...discoverDirPatterns(dirs, 'skip.txt'),
  ...discoverDirPatterns(dirs, 'compare-skip.txt'),
]
const discoverExcludePatterns = dirs => discoverDirPatterns(dirs, 'exclude.txt')
// echo-skip.txt: the geometry is graded, the echo() output is not compared.
const discoverEchoSkipPatterns = dirs => discoverDirPatterns(dirs, 'echo-skip.txt')

/**
 * Check if a file should be skipped based on directory-scoped skip patterns.
 */
function isSkippedByDirPatterns(filePath, dirSkips) {
  const resolvedFile = resolve(filePath)
  for (const { dir, patterns } of dirSkips) {
    // Only apply patterns from a skip.txt to files under that directory
    if (!resolvedFile.startsWith(dir + '/') && resolvedFile !== dir) continue
    const relPath = relative(dir, resolvedFile)
    for (const p of patterns) {
      // Leading / means "anchored to this directory": match only against relative path,
      // and * does not cross directory boundaries (matches [^/]* not .*)
      const anchored = p.startsWith('/')
      const rawPattern = anchored ? p.slice(1) : p
      // Trailing slash is a directory shorthand: "lib/" skips all files under lib/
      const pattern = rawPattern.endsWith('/') ? rawPattern + '*' : rawPattern
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      const regexStr = anchored
        ? escaped.replace(/\*\*/g, '.*').replace(/(?<!\*)\*(?!\*)/g, '[^/]*')
        : escaped.replace(/\*/g, '.*')
      const regex = new RegExp('^' + regexStr + '$')
      if (anchored ? regex.test(relPath) : (regex.test(basename(resolvedFile)) || regex.test(relPath))) {
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

  // Apply exclude.txt patterns — silently remove structural/library files before any counting
  const dirExcludes = discoverExcludePatterns(dirs)
  const included = dirExcludes.length > 0
    ? files.filter(f => !isSkippedByDirPatterns(f, dirExcludes))
    : files

  if (matchPatterns.length > 0) {
    return included.filter(f => matchesPatterns(f, matchPatterns))
  }
  return included
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

/**
 * Load per-library config.json from the test directory (first dir arg).
 * Returns parsed config or {} if not found.
 */
function loadDirConfig(dirs) {
  const firstDir = dirs[0]
  if (!firstDir) return {}
  const configPath = join(resolve(firstDir), 'config.json')
  if (!existsSync(configPath)) return {}
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return {}
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const dirConfig = loadDirConfig(options.dirs)

  // Apply per-directory config defaults (CLI args override config)
  if (dirConfig.preview && !process.argv.includes('--preview')) options.preview = true
  if (dirConfig.threshold !== undefined && !process.argv.includes('--threshold')) options.threshold = dirConfig.threshold

  if (options.dirs.length === 0) {
    console.error('Usage: test-harness <dir1> [dir2] ... [options]')
    console.error('Use -h for help.')
    process.exit(1)
  }

  if (options.list) {
    const dirSkips = options.noDirSkips ? [] : discoverSkipPatterns(options.dirs)
    const cwd = process.cwd()
    for (const f of getTestFiles(options.dirs, options.matchPatterns)) {
      if (!matchesSkipPattern(relative(cwd, f), options.skipPatterns) && !isSkippedByDirPatterns(f, dirSkips)) {
        console.log(relative(cwd, f))
      }
    }
    process.exit(0)
  }

  const openscadInfo = checkOpenscad(options.openscad)
  if (!openscadInfo.available) {
    console.error(`Error: OpenSCAD not found at '${options.openscad}'`)
    process.exit(1)
  }

  // "OpenSCAD version 2026.09.23" -> "2026.09.23", for the transpiled version()
  options.openscadVersion = openscadInfo.version.match(/version\s+(\S+)/)?.[1] ?? null

  // Init STL cache (skip if disabled or running with custom $fn)
  if (!options.noStlCache) {
    options.stlCache = new StlCache(openscadInfo.version)
  }

  const files = getTestFiles(options.dirs, options.matchPatterns)
  if (files.length === 0) {
    console.error('No .scad files found in specified directories.')
    if (options.matchPatterns.length > 0) {
      console.error(`  (--match filters active: ${options.matchPatterns.join(', ')})`)
    }
    process.exit(1)
  }

  // Auto-discover skip.txt and compare-skip.txt from the tested directories (directory-scoped patterns)
  const dirSkips = options.noDirSkips ? [] : discoverSkipPatterns(options.dirs)
  options.echoSkips = options.noDirSkips ? [] : discoverEchoSkipPatterns(options.dirs)

  // Filter out skipped files: explicit --skip-file patterns OR auto-discovered skip.txt patterns
  const cwd = process.cwd()
  const filesToTest = files.filter(f =>
    !matchesSkipPattern(relative(cwd, f), options.skipPatterns) &&
    !isSkippedByDirPatterns(f, dirSkips)
  )
  const skipped = files.length - filesToTest.length

  // Guard: refuse multi-file runs outside CI — they lock up the dev machine.
  // Single-model runs (1 file) are always OK for local debugging.
  // CI is detected ONLY by JSCADUI_CI=1 (set explicitly by ci/test).
  // Do NOT use path heuristics or generic CI env vars — they can be accidentally true
  // when running interactively on the GPU inside a worktree directory.
  const isCI = process.env.JSCADUI_CI === '1'
  if (filesToTest.length > 1 && !isCI) {
    console.error(`\nError: refusing to run ${filesToTest.length} models locally.`)
    console.error('Multi-model runs lock up the dev machine — use CI instead.')
    console.error('\n  Single model:  node bin/test-harness.js path/to/model.scad')
    console.error('  Full suite:    cd packages/openscad && npm test\n')
    process.exit(1)
  }

  if (options.verbose) {
    console.error(`Testing ${filesToTest.length} files with ${options.concurrency} workers...`)
  }

  // Create tasks
  const tasks = filesToTest.map(file => () => testFile(file, options))

  // Run with concurrency
  const results = await runWithConcurrency(tasks, options.concurrency)

  // Tally results
  let passed = 0, failed = 0, translatorErrors = 0, openscadErrors = 0
  let textOnly = 0  // graded on echo() output alone (included in passed/failed)

  for (const result of results) {
    if (result.error) {
      if (result.error.startsWith('OpenSCAD:')) {
        openscadErrors++
        if (!options.json) console.log(`${result.name}: NOT GRADED - reference ${result.error}`)
      } else {
        translatorErrors++
        if (!options.json) console.log(`${result.name}: ERROR - ${result.error}`)
      }
    } else if (result.pass) {
      passed++
      if (result.textOnly) textOnly++
      if (options.verbose && !options.json) {
        console.log(`${result.name}: PASS (${describeResult(result, options.threshold)})`)
      }
    } else {
      failed++
      if (result.textOnly) textOnly++
      if (!options.json) console.log(`${result.name}: FAIL (${describeResult(result, options.threshold)})`)
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
      summary: { total: files.length, tested, passed, failed, translatorErrors, openscadErrors, skipped, textOnly },
      threshold: options.threshold,
      passRate: `${passRate}%`,
      results
    }, null, 2))
  } else {
    console.log(`\nSummary: ${passed} passed, ${failed} failed, ${translatorErrors} errors out of ${tested} tested (${passRate}%)`)
    if (textOnly > 0) console.log(`Text only: ${textOnly} of the graded models only echo (graded on echo() output)`)
    if (openscadErrors > 0) {
      console.log(`Not graded: ${openscadErrors} whose OpenSCAD reference failed (NOT GRADED above)`)
    }
    if (skipped > 0) console.log(`Skipped: ${skipped} in skip list`)
    console.log(`Threshold: ${options.threshold}`)
  }

  // Every OpenSCAD render failing is a broken reference tool, not a suite of
  // models to skip: without this the run reports PASS having compared nothing.
  if (tested === 0 && files.length > 0) {
    console.error(`\nNothing was graded: ${skipped} skipped, ${openscadErrors} without an OpenSCAD reference. Check that OpenSCAD can render them.`)
    process.exit(1)
  }

  process.exit(failed + translatorErrors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
