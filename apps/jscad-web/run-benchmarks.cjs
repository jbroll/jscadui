#!/usr/bin/env node
/**
 * CLI runner for JSCAD benchmarks
 *
 * Usage: node run-benchmarks.cjs [benchmark-name] [runs] [modeling-path]
 *
 * Examples:
 *   node run-benchmarks.cjs                              # Run all benchmarks
 *   node run-benchmarks.cjs swiss-cheese                 # Run specific benchmark
 *   node run-benchmarks.cjs swiss-cheese 5               # Run with 5 iterations
 *   node run-benchmarks.cjs "" 3 /path/to/modeling       # Use custom modeling path
 *
 * Set JSCAD_MODELING_PATH env var to override the modeling package path.
 */

const { readdirSync } = require('fs')
const { join } = require('path')
const path = require('path')

// Setup require for @jscad/modeling
// Allow override via JSCAD_MODELING_PATH env var or 4th argument
const modelingPath = process.env.JSCAD_MODELING_PATH || process.argv[4]
const jscad = modelingPath
  ? require(path.resolve(modelingPath, 'src'))
  : require('@jscad/modeling')

// Simple params proxy that returns defaults
const createParamsProxy = (defaults = {}) => {
  return new Proxy(defaults, {
    get(target, prop) {
      if (prop in target) {
        const val = target[prop]
        // If it's a param definition, return the default
        if (val && typeof val === 'object' && 'default' in val) {
          return val.default
        }
        return val
      }
      // Return a nested proxy for hierarchical params
      const nested = {}
      target[prop] = nested
      return createParamsProxy(nested)
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    }
  })
}

// Load and execute a benchmark
const loadBenchmark = (filePath) => {
  const source = require('fs').readFileSync(filePath, 'utf-8')
  const mockRequire = (name) => {
    if (name === '@jscad/modeling') return jscad
    throw new Error(`Unknown module: ${name}`)
  }
  const exports = {}
  const module = { exports }
  const fn = new Function('require', 'exports', 'module', source)
  fn(mockRequire, exports, module)
  return module.exports
}

// Run a single benchmark
const runBenchmark = (name, filePath, runs = 3) => {
  const mod = loadBenchmark(filePath)
  const times = []

  // Warmup run
  const warmupParams = createParamsProxy({})
  mod.main(warmupParams)

  // Timed runs
  for (let i = 0; i < runs; i++) {
    const params = createParamsProxy({})
    const start = process.hrtime.bigint()
    mod.main(params)
    const end = process.hrtime.bigint()
    times.push(Number(end - start) / 1e6) // Convert to ms
  }

  // Calculate median
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]

  return { name, median, times }
}

// Main
const examplesDir = join(__dirname, 'examples')
const benchmarkFiles = readdirSync(examplesDir)
  .filter(f => f.startsWith('benchmark-') && f.endsWith('.example.js'))
  .map(f => ({ name: f.replace('.example.js', ''), path: join(examplesDir, f) }))

const targetBenchmark = process.argv[2]
const runs = parseInt(process.argv[3]) || 3

console.log('='.repeat(70))
console.log('JSCAD Benchmark Runner')
console.log('='.repeat(70))
console.log(`Runs per benchmark: ${runs}`)
if (modelingPath) {
  console.log(`Modeling package: ${path.resolve(modelingPath)}`)
}
console.log()

const toRun = targetBenchmark
  ? benchmarkFiles.filter(b => b.name.includes(targetBenchmark))
  : benchmarkFiles

if (toRun.length === 0) {
  console.log('No benchmarks found matching:', targetBenchmark)
  console.log('Available:', benchmarkFiles.map(b => b.name).join(', '))
  process.exit(1)
}

console.log(`Running ${toRun.length} benchmark(s)...`)
console.log()

const results = []
for (const bench of toRun) {
  process.stdout.write(`  ${bench.name.padEnd(40)} `)
  try {
    const result = runBenchmark(bench.name, bench.path, runs)
    results.push(result)
    console.log(`${result.median.toFixed(1).padStart(8)} ms`)
  } catch (err) {
    console.log(`ERROR: ${err.message}`)
  }
}

console.log()
console.log('='.repeat(70))
console.log('Complete')
