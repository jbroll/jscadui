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

import { writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
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
  test-harness --dir ./examples --verbose         Test directory
  test-harness --dir ./tests --dir ./examples     Test multiple directories
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
function runOpenscad(scadPath, stlPath, openscadPath, verbose) {
  const args = [
    '--backend=manifold',
    '-o', stlPath,
    scadPath
  ]

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
 * Translate OpenSCAD to JSCAD
 */
function translateToJscad(scadPath, jsPath, verbose) {
  const scad2jscadPath = join(__dirname, 'scad2jscad.js')

  if (verbose) {
    console.error(`  Translating: ${scadPath}`)
  }

  try {
    const jscadCode = execSync(`node ${scad2jscadPath} "${scadPath}"`, {
      encoding: 'utf8',
      timeout: 30000
    })
    writeFileSync(jsPath, jscadCode)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Run JSCAD with Manifold backend
 */
function runJscad(jsPath, stlPath, verbose) {
  const runJscadPath = join(__dirname, 'run-jscad.js')

  if (verbose) {
    console.error(`  Running JSCAD: ${jsPath}`)
  }

  try {
    execSync(`node ${runJscadPath} "${jsPath}" -o "${stlPath}"`, {
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

  const refStl = join(tempDir, 'reference.stl')
  const jsPath = join(tempDir, 'model.js')
  const genStl = join(tempDir, 'generated.stl')

  const result = {
    name,
    path: scadPath,
    openscad: null,
    translate: null,
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
    result.openscad = runOpenscad(tempScad, refStl, options.openscad, options.verbose)
    if (!result.openscad.success) {
      result.error = `OpenSCAD failed: ${result.openscad.error}`
      return result
    }

    // Step 2: Translate to JSCAD
    if (options.verbose) {
      console.error(`  Step 2: Translating to JSCAD...`)
    }
    result.translate = translateToJscad(scadPath, jsPath, options.verbose)
    if (!result.translate.success) {
      result.error = `Translation failed: ${result.translate.error}`
      return result
    }

    // Step 3: Run JSCAD
    if (options.verbose) {
      console.error(`  Step 3: Running JSCAD with Manifold...`)
    }
    result.jscad = runJscad(jsPath, genStl, options.verbose)
    if (!result.jscad.success) {
      result.error = `JSCAD failed: ${result.jscad.error}`
      return result
    }

    // Step 4: Compare STLs
    if (options.verbose) {
      console.error(`  Step 4: Comparing STLs...`)
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
  let errors = 0

  for (const file of files) {
    const result = await testFile(file, options)
    results.push(result)

    if (result.error) {
      errors++
      if (!options.json) {
        console.log(`${result.name}: ERROR - ${result.error}`)
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

  // Output summary
  if (options.json) {
    console.log(JSON.stringify({
      summary: { total: files.length, passed, failed, errors },
      threshold: options.threshold,
      results
    }, null, 2))
  } else {
    console.log()
    console.log(`Summary: ${passed} passed, ${failed} failed, ${errors} errors out of ${files.length} total`)
    console.log(`Threshold: ${options.threshold}`)
  }

  // Exit with error if any failures
  process.exit(failed + errors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
