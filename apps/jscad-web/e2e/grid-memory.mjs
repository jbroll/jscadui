#!/usr/bin/env node
/**
 * grid-memory.mjs — render one model in the bundled chromium and sample the
 * whole browser's resident memory (every chromium process, workers included)
 * and the page's streamed cell count until it settles, stalls or hits a cap.
 * Linux only: it reads /proc.
 *
 *   node e2e/grid-memory.mjs --model /examples/openscad/nopscadlib/NopSCADlib/tests/ALL.js --pool-size 4
 *
 * Options:
 *   --model <path>     example URL path to load (required)
 *   --pool-size <n>    frame workers (sets engine.poolSize); default: the app's own
 *   --server <url>     app base (default http://localhost:$JSCAD_WEB_PORT, else :5120)
 *   --max-gb <n>       stop when the browser's total RSS passes this (default 6)
 *   --stall <s>        stop when no new cell arrives for this long (default 120)
 *   --every <s>        sample interval (default 2)
 *   --log <prefix>     also print console lines that start with this, timestamped
 */
import { chromium } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { APP_ORIGIN } from './ports.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? fallback : process.argv[i + 1]
}

const model = arg('model', null)
if (!model) {
  console.error('--model is required')
  process.exit(2)
}
const server = arg('server', APP_ORIGIN)
const poolSize = Number(arg('pool-size', 0))
const maxBytes = Number(arg('max-gb', 6)) * 2 ** 30
const stallMs = Number(arg('stall', 120)) * 1000
const everyMs = Number(arg('every', 2)) * 1000

const children = new Map()
const readProcs = () => {
  children.clear()
  const procs = []
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      const rss = Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      procs.push({ pid: Number(pid), ppid, rss, type: cmd.match(/--type=([\w-]+)/)?.[1] ?? 'browser' })
    } catch { /* the process exited while we read it */ }
  }
  return procs
}

// Every process descended from this node process is the browser we launched.
const browserProcs = () => {
  const procs = readProcs()
  const mine = new Set([process.pid])
  let grew = true
  while (grew) {
    grew = false
    for (const p of procs) {
      if (!mine.has(p.pid) && mine.has(p.ppid)) {
        mine.add(p.pid)
        grew = true
      }
    }
  }
  return procs.filter((p) => p.pid !== process.pid && mine.has(p.pid))
}

const gb = (bytes) => (bytes / 2 ** 30).toFixed(2)

// Swap in use slows every worker at once, which shows up as leaves timing out
const systemMemory = () => {
  const info = Object.fromEntries(readFileSync('/proc/meminfo', 'utf8').trim().split('\n')
    .map((line) => line.split(/:\s+/)).map(([key, value]) => [key, parseInt(value, 10) * 1024]))
  return { available: info.MemAvailable, swapUsed: info.SwapTotal - info.SwapFree }
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--ignore-gpu-blocklist'] })
const context = await browser.newContext()
if (poolSize) {
  await context.addInitScript((n) => {
    try { localStorage.setItem('engine.poolSize', String(n)) } catch { /* default pool */ }
  }, poolSize)
}
const page = await context.newPage()
const cellFailures = []
const logPrefix = arg('log', null)
page.on('console', (m) => {
  const text = m.text()
  if (text.startsWith('ALL: FAILED ')) cellFailures.push(text)
  if (logPrefix && text.startsWith(logPrefix)) console.log(`  [${((Date.now() - started) / 1000).toFixed(1)}s] ${text}`)
})

const started = Date.now()
await page.goto(`${server}/?r=${started}#${model}`, { waitUntil: 'domcontentloaded' })
try { await page.locator('#welcome-dismiss').click({ timeout: 1500 }) } catch { /* already dismissed */ }

console.log(`${model} pool=${poolSize || 'default'} cap=${gb(maxBytes)} GB`)
console.log('   t(s)  total GB  largest GB  procs  cells  render')
let peak = 0
let lastCells = null
let lastChange = Date.now()
let outcome
for (;;) {
  const procs = browserProcs()
  const total = procs.reduce((sum, p) => sum + p.rss, 0)
  const largest = procs.reduce((max, p) => Math.max(max, p.rss), 0)
  peak = Math.max(peak, total)
  const { cells, render } = await page.evaluate(() => ({
    cells: document.documentElement.dataset.cells ?? null,
    render: document.documentElement.dataset.render ?? null,
  })).catch(() => ({ cells: null, render: 'unreachable' }))
  if (cells !== lastCells) {
    lastCells = cells
    lastChange = Date.now()
  }
  // A worker that has run OpenSCAD holds the modeling library on j$; WASM memory only grows
  const workers = await Promise.all(page.workers().map((worker) => worker.evaluate(() => {
    const module = globalThis.j$?.jscad?.getModule?.()
    return module?.HEAPU8?.length ?? module?.wasmMemory?.buffer.byteLength ?? 0
  }).catch(() => 0)))
  const heaps = workers.map((bytes) => gb(bytes)).join(' ')
  const { available, swapUsed } = systemMemory()
  const t = ((Date.now() - started) / 1000).toFixed(0).padStart(6)
  console.log(`${t}  ${gb(total).padStart(8)}  ${gb(largest).padStart(10)}  ${String(procs.length).padStart(5)}  ${String(cells ?? '-').padStart(5)}  ${render}  avail ${gb(available)} swap ${gb(swapUsed)}  wasm GB: ${heaps || '-'}`)
  if (render === 'ok' || render === 'error') { outcome = render; break }
  if (total > maxBytes) { outcome = `over the ${gb(maxBytes)} GB cap`; break }
  if (Date.now() - lastChange > stallMs) { outcome = `stalled: no new cell for ${stallMs / 1000}s`; break }
  await new Promise((resolve) => setTimeout(resolve, everyMs))
}

console.log(`\n${outcome} after ${((Date.now() - started) / 1000).toFixed(0)}s, peak ${gb(peak)} GB, cells ${lastCells ?? '-'}`)
for (const line of cellFailures.slice(0, 10)) console.log(`  ${line}`)
const errorBar = await page.locator('#error-bar.visible').textContent({ timeout: 1000 }).catch(() => null)
if (errorBar) console.log(`  error bar: ${errorBar.replace(/\s+/g, ' ').trim().slice(0, 400)}`)
await browser.close()
