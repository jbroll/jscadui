#!/usr/bin/env node
/**
 * render-all.mjs — headless browser smoke test for every example.
 *
 * Loads each example through the REAL browser render pipeline (worker transpile
 * → manifold geometry → three.js/WebGL) by hash-navigating the dev server, then
 * records whether it rendered cleanly, showed the #error-bar, or timed out.
 *
 * A model that settles without error but draws no vertices scores `empty`, not
 * `ok`: an empty result is a failure unless the baseline records it.
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
 *   --concurrency <n>  Parallel pages (default: 4). With --grids, a grid whose
 *                      items are all other grids runs after the rest, alone.
 *   --engine <name>    Modeling engine: jscad | manifold (default: app default)
 *   --timeout <ms>     Per-file timeout (default: 300000). This is a hang
 *                      guard, not a performance budget: a model that renders
 *                      slowly is still a model that renders. For a streamed
 *                      grid (--grids) the guard restarts on each cell that
 *                      arrives, so the budget is per cell, not per grid.
 *   --model-timeout <ms>  What the app gives a model before it kills it
 *                      (default: the per-file timeout less 30s, so the frame
 *                      reports "model exceeded N ms" rather than the harness
 *                      reporting an opaque timeout). Capped below the app's
 *                      300s RPC timeout, which would otherwise fire first.
 *   --server <url>     Dev server base (default: http://localhost:$JSCAD_WEB_PORT,
 *                      else :5120)
 *   --no-skip          Ignore skip.txt files
 *   --out <file>       JSON report path (default: e2e/render-report.json)
 *   --baseline <file>  Compare with a recorded baseline: print what changed and
 *                      exit 1 only on a new failure, a status change or a new
 *                      dead grid cell. Without it, any failure exits 1.
 *   --headed           Run headed (debug)
 *
 * Requires the dev server running: `npm run dev` (or pass --server).
 */

import { chromium } from '@playwright/test'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isExcluded } from '../src_build/exampleExclusions.js'
import { diffAgainstBaseline, toFailure } from './baseline-diff.mjs'
import { APP_ORIGIN } from './ports.mjs'
import { splitAggregateGrids } from './grid-order.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(__dirname, '..')
const EXAMPLES_ROOT = join(APP_ROOT, 'examples')

// @jscadui/postmessage's DEFAULT_TIMEOUT: past it the app reports "RPC timeout"
// while the worker keeps running, so the frame's kill must come first.
const RPC_TIMEOUT = 300_000
const MAX_MODEL_TIMEOUT = RPC_TIMEOUT - 10_000

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = {
    dirs: [], jscad: false, limit: 0, concurrency: 4, timeout: 300_000, modelTimeout: 0,
    server: APP_ORIGIN, skip: true, engine: '', grids: false,
    out: join(__dirname, 'render-report.json'), headed: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') o.dirs.push(argv[++i])
    else if (a === '--jscad') o.jscad = true
    else if (a === '--limit') o.limit = Number(argv[++i])
    else if (a === '--concurrency') o.concurrency = Number(argv[++i])
    else if (a === '--timeout') o.timeout = Number(argv[++i])
    else if (a === '--model-timeout') o.modelTimeout = Number(argv[++i])
    else if (a === '--server') o.server = argv[++i]
    else if (a === '--engine') o.engine = argv[++i]
    else if (a === '--grids') o.grids = true
    else if (a === '--no-skip') o.skip = false
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--baseline') o.baseline = argv[++i]
    else if (a === '--headed') o.headed = true
    else if (a === '-h' || a === '--help') { o.help = true }
    else throw new Error(`unknown arg: ${a}`)
  }
  if (o.dirs.length === 0) o.dirs = ['openscad']
  // Leave the harness a margin over the app, so a model that runs too long is
  // reported by the frame, which names the cause, rather than by page.goto.
  if (!o.modelTimeout) o.modelTimeout = Math.max(30_000, o.timeout - 30_000)
  if (o.modelTimeout > MAX_MODEL_TIMEOUT) {
    console.warn(`model budget ${o.modelTimeout} ms exceeds the app's ${RPC_TIMEOUT} ms RPC timeout; using ${MAX_MODEL_TIMEOUT} ms`)
    o.modelTimeout = MAX_MODEL_TIMEOUT
  }
  return o
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
      if (opts.grids) {
        if (basename(f) !== 'ALL.js') continue
      } else {
        if (!exts.includes(f.slice(f.lastIndexOf('.')))) continue
        if (basename(f) === 'ALL.js') continue
        if (opts.skip && isExcluded(f, EXAMPLES_ROOT)) continue
      }
      const relFromExamples = relative(EXAMPLES_ROOT, f)
      out.push({ url: '/examples/' + relFromExamples, rel: relFromExamples })
    }
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel))
  return opts.limit ? out.slice(0, opts.limit) : out
}

// ── render one file in a page ────────────────────────────────────────────────
const within = (ms, promise) => Promise.race([
  promise.catch(e => `failed: ${String(e).replace(/\s+/g, ' ').slice(0, 80)}`),
  new Promise(resolve => setTimeout(() => resolve(`no answer in ${ms} ms`), ms)),
])

// A hang-guard timeout alone cannot tell a page that settled unseen from one
// still running, or a running one from a blocked main thread.
async function stallState(page) {
  const app = await within(5000, page.evaluate(() => {
    const root = document.documentElement
    const bar = document.querySelector('#error-bar.visible')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)
    return `render=${root.dataset.render} at ${Math.round(performance.now() / 1000)}s${bar ? `, error-bar: ${bar}` : ''}`
  }))
  const frame = page.frames().find(f => f !== page.mainFrame())
  const run = frame
    ? await within(5000, frame.evaluate(() => `up ${Math.round(performance.now() / 1000)}s`))
    : 'absent'
  return `app ${app}; frame ${run}`
}

async function renderOne(context, opts, file, idx) {
  const page = await context.newPage()
  const consoleErrs = []
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => consoleErrs.push('PAGEERR: ' + String(e).slice(0, 200)))
  // A failed include reads the same whether the path was wrong or the file was
  // missing, so record which URL the browser was refused and with what.
  const badRequests = []
  page.on('response', r => { if (r.status() >= 400) badRequests.push(`${r.status()} ${r.url()}`) })
  page.on('requestfailed', r => badRequests.push(`${r.failure()?.errorText ?? 'failed'} ${r.url()}`))
  // Cache-busting query forces a full document load → fresh worker per file.
  const target = `${opts.server}/?r=${idx}#${file.url}`
  let status, errText = '', stalled
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: opts.timeout })
    try { await page.locator('#welcome-dismiss').click({ timeout: 1500 }) } catch { /* already dismissed */ }
    // The app marks html[data-render] running → ok/error. #progress cannot be
    // waited on: it starts display:none, so 'hidden' resolves before the model
    // has even begun and every page reads as a pass.
    // waitForFunction does not notice a crashed renderer and runs out the guard.
    const crashed = new Promise((_, reject) => page.once('crash', () => reject(new Error('renderer crashed'))))
    // A streamed grid sets data-cells as each cell lands, so the guard is per cell.
    const settled = async () => {
      let cells = null
      for (;;) {
        const handle = await page.waitForFunction((seen) => {
          const d = document.documentElement.dataset
          if (['ok', 'error'].includes(d.render)) return { settled: true }
          const now = d.cells ?? null
          return now !== seen ? { cells: now } : false
        }, cells, { timeout: opts.timeout })
        const state = await handle.jsonValue()
        if (state.settled) return
        cells = state.cells
      }
    }
    status = await Promise.race([settled(), crashed])
      .then(() => page.evaluate(() => document.documentElement.dataset.render))
    if (await page.locator('#error-bar').isVisible().catch(() => false)) {
      status = 'error'
      errText = ((await page.locator('#error-bar').textContent().catch(() => '')) || '')
        .replace(/\s+/g, ' ').trim().slice(0, 300)
    } else if (status === 'ok' && await page.evaluate(() => document.documentElement.dataset.vertices) === '0') {
      status = 'empty'
    }
  } catch (e) {
    status = String(e).includes('Timeout') ? 'timeout' : 'crash'
    errText = String(e).replace(/\s+/g, ' ').slice(0, 200)
    if (status === 'timeout') stalled = await stallState(page)
  }
  await page.close().catch(() => {})
  // A grid with a failed cell renders fine, so the only trace is what ALL.js logs
  const cellFailures = consoleErrs.filter(t => t.startsWith('ALL: FAILED '))
    .map(t => t.slice('ALL: FAILED '.length))
  if (status === 'ok' && cellFailures.length) status = 'partial'
  return {
    rel: file.rel, status, errText, stalled, cellFailures,
    consoleErrs: consoleErrs.slice(0, 5), badRequests: badRequests.slice(0, 5),
  }
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

  const collected = collectFiles(opts)
  const { grids: pooled, aggregates } = opts.grids
    ? splitAggregateGrids(collected, rel => readFileSync(join(EXAMPLES_ROOT, rel), 'utf8'))
    : { grids: collected, aggregates: [] }
  const files = [...pooled, ...aggregates]
  console.log(`Rendering ${files.length} example(s) from [${opts.dirs.join(', ')}] @ concurrency ${opts.concurrency}`)
  if (aggregates.length) console.log(`then ${aggregates.length} aggregate grid(s) one at a time: ${aggregates.map(f => f.rel).join(' ')}`)
  console.log()

  const browser = await chromium.launch({
    headless: !opts.headed,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  })

  const results = []
  let next = 0, done = 0
  async function worker(end) {
    const context = await browser.newContext()
    if (opts.engine) await context.addInitScript(e => {
      try { localStorage.setItem('engine.modelingEngine', e) } catch { /* the app falls back to its default */ }
    }, opts.engine)
    await context.addInitScript(ms => {
      try { localStorage.setItem('engine.modelTimeoutMs', String(ms)) } catch { /* the app falls back to its default */ }
    }, opts.modelTimeout)
    while (next < end) {
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
  const pool = (end, n) => Promise.all(Array.from({ length: Math.min(n, end - next) }, () => worker(end)))
  await pool(pooled.length, opts.concurrency)
  await pool(files.length, 1)
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
      if (f.stalled) console.log(`        at the guard: ${f.stalled}`)
      for (const cell of f.cellFailures ?? []) console.log(`        ☠ ${cell}`)
      for (const bad of f.badRequests ?? []) console.log(`        ↳ ${bad}`)
    }
  }

  writeFileSync(opts.out, JSON.stringify({
    when: new Date().toISOString(), dirs: opts.dirs, engine: opts.engine || 'default',
    total: results.length, ok: results.length - fails.length, failed: fails.length, byLib,
    failures: fails.map(toFailure), results,
  }, null, 2))
  console.log(`\nReport: ${relative(process.cwd(), opts.out)}`)

  if (!opts.baseline) process.exit(fails.length ? 1 : 0)
  const { regressions, fixed } = diffAgainstBaseline(JSON.parse(readFileSync(opts.baseline, 'utf8')), results)
  console.log(`\n── Against ${relative(process.cwd(), opts.baseline)} ──`)
  for (const line of fixed) console.log(`  fixed: ${line}`)
  for (const line of regressions) console.log(`  REGRESSION ${line}`)
  if (!fixed.length && !regressions.length) console.log('  matches the baseline')
  process.exit(regressions.length ? 1 : 0)
}

run()
