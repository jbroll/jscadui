#!/usr/bin/env node
/**
 * render-all.mjs — headless browser smoke test for every example.
 *
 * Loads each example through the REAL browser render pipeline (worker transpile
 * → manifold geometry → three.js/WebGL) by hash-navigating the dev server, then
 * records whether it rendered cleanly, showed the #error-bar, or timed out.
 *
 * This is the browser-side counterpart to packages/openscad's STL-comparison
 * harness (which runs the transpiler in Node). It catches browser-only failures:
 * worker bundling, dynamic imports, fetch/URL resolution, WebGL, missing files.
 *
 * WebGL note: uses Playwright's BUNDLED chromium (ships swiftshader). System
 * chromium on this box cannot create a WebGL context headless — do not point
 * executablePath at it.
 *
 * Usage:
 *   node e2e/render-all.mjs [options]
 *
 * Options:
 *   --dir <rel>        Limit to a subdir under examples/ (repeatable).
 *                      Default: openscad
 *   --jscad            Also include .js examples (default: .scad only)
 *   --limit <n>        Only the first n files (quick smoke test)
 *   --concurrency <n>  Parallel pages (default: 4)
 *   --engine <name>    Modeling engine: jscad | manifold (default: app default)
 *   --timeout <ms>     Per-file timeout (default: 30000)
 *   --server <url>     Dev server base (default: http://localhost:5120)
 *   --no-skip          Ignore skip.txt files
 *   --out <file>       JSON report path (default: e2e/render-report.json)
 *   --headed           Run headed (debug)
 *
 * Requires the dev server running: `npm run dev` (or pass --server).
 */

import { chromium } from '@playwright/test'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(__dirname, '..')
const EXAMPLES_ROOT = join(APP_ROOT, 'examples')

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = {
    dirs: [], jscad: false, limit: 0, concurrency: 4, timeout: 30_000,
    server: 'http://localhost:5120', skip: true, engine: '',
    out: join(__dirname, 'render-report.json'), headed: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') o.dirs.push(argv[++i])
    else if (a === '--jscad') o.jscad = true
    else if (a === '--limit') o.limit = Number(argv[++i])
    else if (a === '--concurrency') o.concurrency = Number(argv[++i])
    else if (a === '--timeout') o.timeout = Number(argv[++i])
    else if (a === '--server') o.server = argv[++i]
    else if (a === '--engine') o.engine = argv[++i]
    else if (a === '--no-skip') o.skip = false
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--headed') o.headed = true
    else if (a === '-h' || a === '--help') { o.help = true }
    else throw new Error(`unknown arg: ${a}`)
  }
  if (o.dirs.length === 0) o.dirs = ['openscad']
  return o
}

// ── skip.txt handling (mirrors packages/openscad test-harness) ───────────────
/** Load skip patterns per library dir; key = absolute library dir. */
function loadSkipPatterns(absDir) {
  const f = join(absDir, 'skip.txt')
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
}

function matchesSkip(relativePath, patterns) {
  for (const pattern of patterns) {
    const rx = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
    if (rx.test(relativePath) || rx.test(basename(relativePath))) return true
  }
  return false
}

// ── enumerate example files ──────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'lib' || e.name === 'node_modules') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

/** Return list of {url, rel} for example files, honoring skip.txt. */
function collectFiles(opts) {
  const exts = opts.jscad ? ['.scad', '.js'] : ['.scad']
  const out = []
  for (const d of opts.dirs) {
    const absDir = join(EXAMPLES_ROOT, d)
    if (!existsSync(absDir)) { console.warn(`skip missing dir: ${d}`); continue }
    // Each immediate library subdir gets its own skip.txt scope; also the dir itself.
    for (const f of walk(absDir)) {
      if (!exts.includes(f.slice(f.lastIndexOf('.')))) continue
      if (basename(f) === 'ALL.js') continue
      const relFromExamples = relative(EXAMPLES_ROOT, f)
      // library = examples/openscad/<lib>
      const parts = relFromExamples.split('/')
      const libDir = join(EXAMPLES_ROOT, parts.slice(0, 3).join('/'))
      if (opts.skip && existsSync(libDir)) {
        const patterns = loadSkipPatterns(libDir)
        const relToLib = relative(libDir, f)
        if (matchesSkip(relToLib, patterns)) continue
      }
      out.push({ url: '/examples/' + relFromExamples, rel: relFromExamples })
    }
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel))
  return opts.limit ? out.slice(0, opts.limit) : out
}

// ── render one file in a page ────────────────────────────────────────────────
async function renderOne(context, opts, file, idx) {
  const page = await context.newPage()
  const consoleErrs = []
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => consoleErrs.push('PAGEERR: ' + String(e).slice(0, 200)))
  // Cache-busting query forces a full document load → fresh worker per file.
  const target = `${opts.server}/?r=${idx}#${file.url}`
  let status, errText = ''
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: opts.timeout })
    try { await page.locator('#welcome-dismiss').click({ timeout: 1500 }) } catch {}
    status = await Promise.race([
      page.locator('#progress').waitFor({ state: 'hidden', timeout: opts.timeout }).then(() => 'ok'),
      page.locator('#error-bar').waitFor({ state: 'visible', timeout: opts.timeout }).then(() => 'error'),
    ])
    if (await page.locator('#error-bar').isVisible().catch(() => false)) {
      status = 'error'
      errText = ((await page.locator('#error-bar').textContent().catch(() => '')) || '')
        .replace(/\s+/g, ' ').trim().slice(0, 300)
    }
  } catch (e) {
    status = String(e).includes('Timeout') ? 'timeout' : 'crash'
    errText = String(e).replace(/\s+/g, ' ').slice(0, 200)
  }
  await page.close().catch(() => {})
  return { rel: file.rel, status, errText, consoleErrs: consoleErrs.slice(0, 5) }
}

// ── pool runner ──────────────────────────────────────────────────────────────
async function run() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); return }

  // verify server reachable
  try {
    const r = await fetch(opts.server + '/')
    if (!r.ok) throw new Error(`status ${r.status}`)
  } catch (e) {
    console.error(`✖ Dev server not reachable at ${opts.server} (${e.message}). Run \`npm run dev\` first.`)
    process.exit(2)
  }

  const files = collectFiles(opts)
  console.log(`Rendering ${files.length} example(s) from [${opts.dirs.join(', ')}] @ concurrency ${opts.concurrency}\n`)

  const browser = await chromium.launch({
    headless: !opts.headed,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  })

  const results = []
  let next = 0, done = 0
  async function worker() {
    const context = await browser.newContext()
    if (opts.engine) await context.addInitScript(e => {
      try { localStorage.setItem('engine.modelingEngine', e) } catch {}
    }, opts.engine)
    while (next < files.length) {
      const i = next++
      const res = await renderOne(context, opts, files[i], i)
      results[i] = res
      done++
      const mark = res.status === 'ok' ? '·' : 'F'
      process.stdout.write(mark)
      if (done % 80 === 0) process.stdout.write(`  ${done}/${files.length}\n`)
    }
    await context.close()
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, files.length) }, worker))
  await browser.close()

  // ── report ──
  const fails = results.filter(r => r.status !== 'ok')
  const byLib = {}
  for (const r of results) {
    const lib = r.rel.split('/').slice(0, 2).join('/')
    byLib[lib] ??= { ok: 0, fail: 0 }
    byLib[lib][r.status === 'ok' ? 'ok' : 'fail']++
  }
  console.log('\n\n── Summary by library ──')
  for (const [lib, c] of Object.entries(byLib).sort()) {
    const total = c.ok + c.fail
    console.log(`  ${c.fail === 0 ? '✓' : '✗'} ${lib.padEnd(28)} ${c.ok}/${total}`)
  }
  console.log(`\nTotal: ${results.length - fails.length}/${results.length} rendered, ${fails.length} failed`)

  if (fails.length) {
    console.log('\n── Failures ──')
    for (const f of fails) {
      console.log(`  [${f.status}] ${f.rel}`)
      if (f.errText) console.log(`        ${f.errText}`)
    }
  }

  writeFileSync(opts.out, JSON.stringify({
    when: new Date().toISOString(), dirs: opts.dirs,
    total: results.length, failed: fails.length, byLib, results,
  }, null, 2))
  console.log(`\nReport: ${relative(process.cwd(), opts.out)}`)
  process.exit(fails.length ? 1 : 0)
}

run()
