#!/usr/bin/env node

/**
 * Comprehensive Test Runner for jscadui
 *
 * Runs all test categories and provides a summary report:
 * - Unit tests (all packages via turbo)
 * - JSCAD example execution tests
 * - OpenSCAD transpilation and comparison tests
 * - E2E browser tests (optional)
 *
 * Usage:
 *   node scripts/test-all.js [--skip-e2e] [--skip-openscad] [--verbose]
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, '..')

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

// Parse command-line arguments
const args = process.argv.slice(2)
const options = {
  skipE2E: args.includes('--skip-e2e'),
  skipOpenSCAD: args.includes('--skip-openscad'),
  verbose: args.includes('--verbose'),
  help: args.includes('--help') || args.includes('-h'),
}

if (options.help) {
  console.log(`
${colors.bright}Test Runner for jscadui${colors.reset}

Usage:
  node scripts/test-all.js [options]

Options:
  --skip-e2e         Skip end-to-end browser tests
  --skip-openscad    Skip OpenSCAD comparison tests (faster)
  --verbose          Show detailed output from each test
  -h, --help         Show this help

Examples:
  # Run all tests
  node scripts/test-all.js

  # Run everything except E2E tests
  node scripts/test-all.js --skip-e2e

  # Quick run (skip OpenSCAD comparisons)
  node scripts/test-all.js --skip-openscad --skip-e2e
`)
  process.exit(0)
}

// Test results tracking
const results = {
  unit: null,
  jscad: null,
  openscad: null,
  e2e: null,
}

/**
 * Execute a command and capture output
 */
function execTest(command, label, cwd = rootDir) {
  const startTime = Date.now()

  console.log(`\n${colors.cyan}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`)
  console.log(`${colors.bright}${label}${colors.reset}`)
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`)

  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: options.verbose ? 'inherit' : 'pipe',
      env: { ...process.env, FORCE_COLOR: '1' },
    })

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    if (!options.verbose) {
      console.log(output)
    }

    console.log(`\n${colors.green}✓ ${label} passed${colors.reset} (${duration}s)`)
    return { success: true, duration, output }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    if (!options.verbose && error.stdout) {
      console.log(error.stdout.toString())
    }
    if (error.stderr) {
      console.error(error.stderr.toString())
    }

    console.log(`\n${colors.red}✗ ${label} failed${colors.reset} (${duration}s)`)
    return { success: false, duration, output: error.stdout?.toString() || '', error }
  }
}

/**
 * Parse test output to extract statistics
 */
function parseTestOutput(output, type) {
  if (type === 'vitest') {
    // Parse vitest output like "Test Files  12 passed (12)"
    const filesMatch = output.match(/Test Files\s+(\d+)\s+passed/)
    const testsMatch = output.match(/Tests\s+(\d+)\s+passed/)
    return {
      files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      tests: testsMatch ? parseInt(testsMatch[1], 10) : 0,
    }
  } else if (type === 'openscad') {
    // Parse test-harness output like "Results: 128/145 passed"
    const match = output.match(/Results:\s+(\d+)\/(\d+)\s+passed/)
    if (match) {
      return {
        passed: parseInt(match[1], 10),
        total: parseInt(match[2], 10),
        skipped: parseInt(match[2], 10) - parseInt(match[1], 10),
      }
    }
  } else if (type === 'playwright') {
    // Parse playwright output like "15 passed (1.2s)"
    const match = output.match(/(\d+)\s+passed/)
    return {
      tests: match ? parseInt(match[1], 10) : 0,
    }
  }

  return {}
}

/**
 * Print final summary
 */
function printSummary() {
  console.log(`\n${colors.cyan}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`)
  console.log(`${colors.bright}Test Summary${colors.reset}`)
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`)

  const allPassed = Object.values(results).every(r => r === null || r.success)

  // Unit tests
  if (results.unit) {
    const stats = parseTestOutput(results.unit.output, 'vitest')
    const status = results.unit.success ? `${colors.green}✓` : `${colors.red}✗`
    console.log(
      `${status} Unit Tests: ${stats.tests || '?'} tests passed across ${stats.files || '?'} packages${colors.reset}`
    )
  }

  // JSCAD examples
  if (results.jscad) {
    const stats = parseTestOutput(results.jscad.output, 'vitest')
    const status = results.jscad.success ? `${colors.green}✓` : `${colors.red}✗`
    console.log(`${status} JSCAD Examples: ${stats.tests || '?'} tests passed${colors.reset}`)
  }

  // ALL.js files
  if (results.allFiles) {
    const stats = parseTestOutput(results.allFiles.output, 'vitest')
    const status = results.allFiles.success ? `${colors.green}✓` : `${colors.red}✗`
    console.log(`${status} ALL.js Files: ${stats.tests || '?'} tests passed${colors.reset}`)
  }

  // OpenSCAD examples
  if (results.openscad) {
    const stats = parseTestOutput(results.openscad.output, 'openscad')
    const status = results.openscad.success ? `${colors.green}✓` : `${colors.red}✗`
    const msg = stats.total
      ? `${stats.passed}/${stats.total} passed${stats.skipped ? ` (${stats.skipped} skipped)` : ''}`
      : 'completed'
    console.log(`${status} OpenSCAD Examples: ${msg}${colors.reset}`)
  }

  // E2E tests
  if (results.e2e) {
    const stats = parseTestOutput(results.e2e.output, 'playwright')
    const status = results.e2e.success ? `${colors.green}✓` : `${colors.red}✗`
    console.log(`${status} E2E Tests: ${stats.tests || '?'} tests passed${colors.reset}`)
  }

  console.log()

  // Calculate total duration
  const totalDuration = Object.values(results)
    .filter(r => r !== null)
    .reduce((sum, r) => sum + parseFloat(r.duration), 0)

  console.log(`Total time: ${totalDuration.toFixed(2)}s`)

  if (allPassed) {
    console.log(`\n${colors.green}${colors.bright}✓ All tests passed!${colors.reset}\n`)
    process.exit(0)
  } else {
    console.log(`\n${colors.red}${colors.bright}✗ Some tests failed${colors.reset}\n`)
    process.exit(1)
  }
}

/**
 * Main test execution
 */
async function runAllTests() {
  console.log(`${colors.bright}Running comprehensive test suite...${colors.reset}`)

  // 1. Unit tests (all packages via turbo, excluding openscad — handled separately in step 3)
  results.unit = execTest('npm run test:unit', 'Unit Tests (all packages)')

  // 2. JSCAD example execution tests
  const jscadWebDir = resolve(rootDir, 'apps/jscad-web')
  if (existsSync(jscadWebDir)) {
    results.jscad = execTest('npm test', 'JSCAD Example Execution Tests', jscadWebDir)
  } else {
    console.log(`${colors.yellow}⚠ Skipping JSCAD tests: apps/jscad-web not found${colors.reset}`)
  }

  // 3. OpenSCAD transpilation and comparison tests
  if (!options.skipOpenSCAD) {
    const openscadDir = resolve(rootDir, 'packages/openscad')
    if (existsSync(openscadDir)) {
      // Run the full test suite including test-harness
      results.openscad = execTest('npm test', 'OpenSCAD Transpilation & Comparison Tests', openscadDir)
    } else {
      console.log(`${colors.yellow}⚠ Skipping OpenSCAD tests: packages/openscad not found${colors.reset}`)
    }
  } else {
    console.log(`${colors.yellow}⚠ Skipping OpenSCAD tests (--skip-openscad)${colors.reset}`)
  }

  // 4. E2E browser tests (optional, can be slow)
  if (!options.skipE2E) {
    const jscadWebDir = resolve(rootDir, 'apps/jscad-web')
    const e2eConfig = resolve(jscadWebDir, 'playwright.config.js')

    if (existsSync(e2eConfig)) {
      results.e2e = execTest('npm run test:e2e', 'End-to-End Browser Tests', jscadWebDir)
    } else {
      console.log(`${colors.yellow}⚠ Skipping E2E tests: playwright config not found${colors.reset}`)
    }
  } else {
    console.log(`${colors.yellow}⚠ Skipping E2E tests (--skip-e2e)${colors.reset}`)
  }

  // Print summary
  printSummary()
}

// Run tests
runAllTests().catch(error => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error)
  process.exit(1)
})
