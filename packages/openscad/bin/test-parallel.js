#!/usr/bin/env node

/**
 * Parallel test runner — runs test-harness.js for each library subdirectory
 * in parallel, then merges the exit codes.
 *
 * Usage:
 *   test-parallel <examples-root> [test-harness-options...]
 *
 * Directories with no .scad files are skipped automatically.
 * 'lib' directories and hidden directories are excluded.
 */

import { readdirSync, existsSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const HARNESS = join(__dirname, 'test-harness.js')

// ── Line-buffered prefix writer ─────────────────────────────────────────────

class LineBuffer {
  constructor(prefix, out) {
    this.prefix = `[${prefix}] `
    this.out = out
    this.buf = ''
  }

  push(chunk) {
    this.buf += chunk.toString()
    const lines = this.buf.split('\n')
    this.buf = lines.pop()  // keep partial trailing line
    for (const line of lines) this.out.write(this.prefix + line + '\n')
  }

  flush() {
    if (this.buf) {
      this.out.write(this.prefix + this.buf + '\n')
      this.buf = ''
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const rootDir = argv.find(a => !a.startsWith('-'))
const extraArgs = argv.filter(a => a !== rootDir)

if (!rootDir) {
  console.error('Usage: test-parallel <examples-root> [test-harness-options...]')
  process.exit(1)
}

const absRoot = resolve(rootDir)
if (!existsSync(absRoot)) {
  console.error(`Directory not found: ${absRoot}`)
  process.exit(1)
}

// Find subdirectories that are likely library test roots (contain .scad files or subdirs)
const subdirs = readdirSync(absRoot, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'lib')
  .map(e => join(absRoot, e.name))

if (subdirs.length === 0) {
  console.error(`No library subdirectories found under ${absRoot}`)
  process.exit(1)
}

const names = subdirs.map(d => basename(d))
console.log(`Running ${subdirs.length} suites sequentially: ${names.join(', ')}\n`)

// Run one test-harness process per subdirectory, sequentially.
// Each suite gets the full CPU/memory budget for its workers.
function runSuite(dir) {
  const name = basename(dir)
  const child = spawn(process.execPath, [HARNESS, dir, ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const stdout = new LineBuffer(name, process.stdout)
  const stderr = new LineBuffer(name, process.stderr)

  child.stdout.on('data', chunk => stdout.push(chunk))
  child.stderr.on('data', chunk => stderr.push(chunk))

  return new Promise(res => {
    child.on('close', code => {
      stdout.flush()
      stderr.flush()
      res({ name, code: code ?? 1 })
    })
  })
}

const results = []
for (const dir of subdirs) {
  results.push(await runSuite(dir))
}

// Print combined summary
console.log('\n── Suite results ───────────────────────────────────────────')
let anyFailed = false
for (const { name, code } of results) {
  const status = code === 0 ? 'PASS' : 'FAIL'
  console.log(`  ${status}  ${name}`)
  if (code !== 0) anyFailed = true
}

process.exit(anyFailed ? 1 : 0)
