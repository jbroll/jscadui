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
 *   test-harness model.scad                     Test single file
 *   test-harness --dir examples/                Test all .scad files
 *   test-harness --corpus                       Test built-in corpus
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { resolve, basename, dirname, join } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const VERSION = '0.1.0'

function printHelp() {
  console.log(`
test-harness - OpenSCAD translator fidelity testing

Usage:
  test-harness <model.scad> [options]     Test single file
  test-harness --dir <path> [options]     Test all .scad files in directory
  test-harness --corpus [options]         Test built-in corpus

Options:
  --dir <path>            Directory to scan for .scad files (can be repeated)
  --threshold <n>         Minimum Jaccard for pass (default: 0.99)
  --fn <n>                Set global $fn for both OpenSCAD and transpiler
                          Higher values give better match (try --fn 48)
  --openscad <path>       Path to OpenSCAD binary (default: openscad)
  --keep-temp             Keep temporary files for debugging
  --verbose               Print detailed output
  --json                  Output results as JSON
  -h, --help              Show this help
  -v, --version           Show version

Output:
  For each file, prints: filename, Jaccard, PASS/FAIL
  Summary statistics at end.

Examples:
  test-harness model.scad                         Test single model
  test-harness --corpus --fn 48                   Test corpus with high resolution
  test-harness --dir ./examples --verbose         Test directory
  test-harness model.scad --openscad /opt/openscad/openscad
`)
}

function parseArgs(args) {
  const options = {
    files: [],
    dirs: [],
    corpus: false,
    threshold: 0.99,
    openscad: 'openscad',
    keepTemp: false,
    verbose: false,
    json: false,
    help: false,
    version: false,
    fn: 0,  // Global $fn override (0 = use defaults)
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-h' || arg === '--help') {
      options.help = true
    } else if (arg === '-v' || arg === '--version') {
      options.version = true
    } else if (arg === '--verbose') {
      options.verbose = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--keep-temp') {
      options.keepTemp = true
    } else if (arg === '--corpus') {
      options.corpus = true
    } else if (arg === '--dir') {
      i++
      options.dirs.push(args[i])
    } else if (arg === '--threshold') {
      i++
      options.threshold = parseFloat(args[i])
    } else if (arg === '--openscad') {
      i++
      options.openscad = args[i]
    } else if (arg === '--fn') {
      i++
      options.fn = parseInt(args[i], 10)
    } else if (!arg.startsWith('-')) {
      options.files.push(arg)
    } else {
      console.error(`Unknown option: ${arg}`)
      process.exit(1)
    }
    i++
  }

  return options
}

/**
 * Check if OpenSCAD is available and has Manifold backend
 */
function checkOpenscad(openscadPath) {
  try {
    const version = execSync(`${openscadPath} --version 2>&1`, { encoding: 'utf8' })
    const hasManifold = version.includes('manifold') || version.includes('Manifold')
    return { available: true, version: version.trim(), hasManifold }
  } catch {
    return { available: false, version: null, hasManifold: false }
  }
}

/**
 * Run OpenSCAD to generate STL
 */
function runOpenscad(scadPath, stlPath, openscadPath, verbose, fn = 0) {
  const args = [
    '--backend=manifold',
    '-o', stlPath,
  ]

  // Add $fn override if specified (quote to prevent shell expansion)
  if (fn > 0) {
    args.push('-D', `"\\$fn=${fn}"`)
  }

  args.push(scadPath)

  if (verbose) {
    console.error(`  Running: ${openscadPath} ${args.join(' ')}`)
  }

  try {
    execSync(`${openscadPath} ${args.join(' ')}`, {
      encoding: 'utf8',
      stdio: verbose ? 'inherit' : 'pipe',
      timeout: 60000  // 60 second timeout
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Run OpenSCAD file through transpiler + JSCAD with Manifold backend
 * run-jscad.js now handles .scad files directly (transpile + execute in-memory)
 */
function runJscad(scadPath, stlPath, verbose, fn = 0) {
  const runJscadPath = join(__dirname, 'run-jscad.js')

  if (verbose) {
    console.error(`  Transpiling and running: ${scadPath}`)
  }

  const fnArg = fn > 0 ? ` --fn ${fn}` : ''

  try {
    execSync(`node ${runJscadPath} "${scadPath}" -o "${stlPath}"${fnArg}`, {
      encoding: 'utf8',
      stdio: verbose ? 'inherit' : 'pipe',
      timeout: 60000
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Compare two STL files
 */
function compareStl(refStl, genStl, verbose) {
  const compareStlPath = join(__dirname, 'compare-stl.js')

  try {
    const output = execSync(
      `node ${compareStlPath} "${refStl}" "${genStl}" ${verbose ? '--verbose' : ''}`,
      { encoding: 'utf8', timeout: 120000 }
    )

    // Parse Jaccard from output
    const match = output.match(/Jaccard:\s*([\d.]+)/)
    if (match) {
      return { success: true, jaccard: parseFloat(match[1]) }
    }
    return { success: false, error: 'Could not parse Jaccard' }
  } catch (err) {
    // Try to extract Jaccard even from failed run
    const match = err.stdout?.match(/Jaccard:\s*([\d.]+)/)
    if (match) {
      return { success: true, jaccard: parseFloat(match[1]) }
    }
    return { success: false, error: err.message }
  }
}

/**
 * Find and copy dependencies (use/include statements) to temp dir
 */
function copyDependencies(scadPath, tempDir, verbose) {
  const sourceDir = dirname(scadPath)
  const content = readFileSync(scadPath, 'utf8')

  // Match use <file> and include <file> statements
  const useRegex = /(?:use|include)\s*<([^>]+)>/g
  let match

  while ((match = useRegex.exec(content)) !== null) {
    const depPath = match[1]
    const sourcePath = join(sourceDir, depPath)
    const destPath = join(tempDir, depPath)

    if (existsSync(sourcePath)) {
      // Create parent directory if needed
      mkdirSync(dirname(destPath), { recursive: true })
      copyFileSync(sourcePath, destPath)
      if (verbose) {
        console.error(`  Copied dependency: ${depPath}`)
      }

      // Recursively copy dependencies of this file
      copyDependencies(sourcePath, tempDir, verbose)
    }
  }
}

/**
 * Test a single OpenSCAD file
 */
async function testFile(scadPath, options) {
  const name = basename(scadPath)
  // Use home directory for temp files (Flatpak OpenSCAD can't access /tmp)
  const tempDir = join(homedir(), '.cache', 'scad-test', `${Date.now()}-${Math.random().toString(36).slice(2)}`)

  mkdirSync(tempDir, { recursive: true })

  // Copy input file to temp dir (Flatpak OpenSCAD can only access $HOME)
  const tempScad = join(tempDir, 'input.scad')
  copyFileSync(scadPath, tempScad)

  // Copy any dependencies (use/include statements)
  copyDependencies(scadPath, tempDir, options.verbose)

  const refStl = join(tempDir, 'reference.stl')
  const genStl = join(tempDir, 'generated.stl')

  const result = {
    name,
    path: scadPath,
    openscad: null,
    jscad: null,
    compare: null,
    jaccard: null,
    pass: false,
    error: null
  }

  try {
    // Step 1: Run OpenSCAD
    if (options.verbose) {
      console.error(`\nTesting: ${name}`)
      console.error(`  Step 1: Running OpenSCAD...`)
    }
    result.openscad = runOpenscad(tempScad, refStl, options.openscad, options.verbose, options.fn)
    if (!result.openscad.success) {
      result.error = `OpenSCAD failed: ${result.openscad.error}`
      return result
    }

    // Step 2: Transpile and run with JSCAD (in-memory)
    if (options.verbose) {
      console.error(`  Step 2: Transpiling and running with JSCAD...`)
    }
    result.jscad = runJscad(scadPath, genStl, options.verbose, options.fn)
    if (!result.jscad.success) {
      result.error = `JSCAD failed: ${result.jscad.error}`
      return result
    }

    // Step 3: Compare STLs
    if (options.verbose) {
      console.error(`  Step 3: Comparing STLs...`)
    }
    result.compare = compareStl(refStl, genStl, options.verbose)
    if (!result.compare.success) {
      result.error = `Comparison failed: ${result.compare.error}`
      return result
    }

    result.jaccard = result.compare.jaccard
    result.pass = result.jaccard >= options.threshold

  } finally {
    // Cleanup temp files unless --keep-temp
    if (!options.keepTemp) {
      try {
        rmSync(tempDir, { recursive: true })
      } catch {
        // Ignore cleanup errors
      }
    } else if (options.verbose) {
      console.error(`  Temp files: ${tempDir}`)
    }
  }

  return result
}

/**
 * Get list of test files
 */
function getTestFiles(options) {
  const files = []

  if (options.files.length > 0) {
    for (const file of options.files) {
      files.push(resolve(file))
    }
  }

  // Process all directories
  for (const dir of options.dirs) {
    const dirPath = resolve(dir)
    if (!existsSync(dirPath)) {
      console.error(`Warning: Directory not found: ${dirPath}`)
      continue
    }
    const entries = readdirSync(dirPath)
    for (const entry of entries) {
      if (entry.endsWith('.scad')) {
        files.push(join(dirPath, entry))
      }
    }
  }

  if (options.corpus) {
    // Built-in corpus - look for examples in the package
    const corpusDir = join(__dirname, '..', 'test', 'corpus')
    if (existsSync(corpusDir)) {
      const entries = readdirSync(corpusDir)
      for (const entry of entries) {
        if (entry.endsWith('.scad')) {
          files.push(join(corpusDir, entry))
        }
      }
    }
  }

  return files
}

async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  if (options.help) {
    printHelp()
    process.exit(0)
  }

  if (options.version) {
    console.log(`test-harness v${VERSION}`)
    process.exit(0)
  }

  // Check OpenSCAD availability
  const openscadInfo = checkOpenscad(options.openscad)
  if (!openscadInfo.available) {
    console.error(`Error: OpenSCAD not found at '${options.openscad}'`)
    console.error('Install OpenSCAD or specify path with --openscad')
    process.exit(1)
  }

  if (options.verbose) {
    console.error(`OpenSCAD: ${openscadInfo.version}`)
    if (!openscadInfo.hasManifold) {
      console.error('Warning: Manifold backend may not be available')
    }
  }

  // Get files to test
  const files = getTestFiles(options)
  if (files.length === 0) {
    console.error('No test files specified. Use -h for help.')
    process.exit(1)
  }

  if (options.verbose) {
    console.error(`Testing ${files.length} file(s)...`)
  }

  // Run tests
  const results = []
  let passed = 0
  let failed = 0
  let translatorErrors = 0
  let openscadErrors = 0

  for (const file of files) {
    const result = await testFile(file, options)
    results.push(result)

    if (result.error) {
      // Separate OpenSCAD-side failures (not our translator's fault)
      if (result.error.startsWith('OpenSCAD failed:')) {
        openscadErrors++
        if (!options.json) {
          console.log(`${result.name}: SKIPPED - ${result.error}`)
        }
      } else {
        translatorErrors++
        if (!options.json) {
          console.log(`${result.name}: ERROR - ${result.error}`)
        }
      }
    } else if (result.pass) {
      passed++
      if (!options.json) {
        console.log(`${result.name}: PASS (Jaccard: ${result.jaccard.toFixed(4)})`)
      }
    } else {
      failed++
      if (!options.json) {
        console.log(`${result.name}: FAIL (Jaccard: ${result.jaccard.toFixed(4)})`)
      }
    }
  }

  // Calculate stats excluding OpenSCAD-side failures
  const tested = files.length - openscadErrors
  const passRate = tested > 0 ? ((passed / tested) * 100).toFixed(1) : '0.0'

  // Output summary
  if (options.json) {
    console.log(JSON.stringify({
      summary: { total: files.length, tested, passed, failed, translatorErrors, openscadErrors },
      threshold: options.threshold,
      passRate: `${passRate}%`,
      results
    }, null, 2))
  } else {
    console.log()
    console.log(`Summary: ${passed} passed, ${failed} failed, ${translatorErrors} errors out of ${tested} tested (${passRate}%)`)
    if (openscadErrors > 0) {
      console.log(`Skipped: ${openscadErrors} (OpenSCAD-side failures)`)
    }
    console.log(`Threshold: ${options.threshold}`)
  }

  // Exit with error if any translator failures (not OpenSCAD-side failures)
  process.exit(failed + translatorErrors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
