#!/usr/bin/env node
/**
 * smoke-deploy.mjs — post-deploy smoke test against a live (or local) URL.
 *
 * Drives a real (bundled-chromium, WebGL) browser through the critical paths a
 * curl check can't see, and FAILS LOUDLY (non-zero exit) on any problem:
 *   1. the app boots and a model renders (no error bar, some vertices drawn,
 *      and no `ALL: FAILED` cell in the grid)
 *   2. Browse Demos lists examples via manifest.json — NOT a directory listing
 *      (catches the prod autoindex 403)
 *   3. the CORS split the compute frame needs: examples carry
 *      Access-Control-Allow-Origin, the API does not
 *   4. with --build, the app (and with --frame-url, the frame) serves the
 *      build in that directory, by the entry hash in each index.html
 *
 *   node e2e/smoke-deploy.mjs --url https://jscad.rkroll.com
 *   node e2e/smoke-deploy.mjs --url https://jscad.rkroll.com --build build \
 *     --frame-url https://jscad-run.rkroll.com
 */
import { readFileSync } from 'fs'
import { chromium } from '@playwright/test'
import { entryHash } from '../src_build/buildId.js'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1]?.replace(/\/$/, '') ?? null : null
}
const url = arg('--url') ?? 'http://localhost:5120'
const buildDir = arg('--build')
const frameUrl = arg('--frame-url')

const fails = []
const checked = []
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
  checked.push(name)
  if (!ok) fails.push(`${name}${detail ? ': ' + detail : ''}`)
}

console.log(`Smoke testing ${url}`)

// A deploy stage that silently did nothing leaves the old build serving, which
// passes every other check here.
if (buildDir) {
  const hosts = [['app', url, buildDir + '/index.html', 'main']]
  if (frameUrl) hosts.push(['frame', frameUrl, buildDir + '/frame/index.html', 'frame'])
  for (const [name, hostUrl, indexPath, entry] of hosts) {
    try {
      const built = entryHash(readFileSync(indexPath, 'utf8'), entry)
      const res = await fetch(hostUrl + '/', { cache: 'no-store' })
      const served = res.ok ? entryHash(await res.text(), entry) : null
      check(`${name} serves this build`, built !== null && served === built,
        `built ${built ?? 'unhashed'}, served ${res.ok ? served ?? 'unhashed' : 'HTTP ' + res.status}`)
    } catch (e) {
      check(`${name} serves this build`, false, String(e).split('\n')[0].slice(0, 160))
    }
  }
}

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext()).newPage()

// Record every /examples/ request that is NOT a model file, with its status.
const listingReqs = []
page.on('requestfinished', async r => {
  const u = r.url()
  if (u.includes('/examples/') && !/\.(scad|js)(\?|$)/.test(u)) {
    try { listingReqs.push({ status: (await r.response()).status(), url: u }) } catch { /* ignore */ }
  }
})

try {
  // 1. Browse Demos lists examples via the manifest (the prod 403 path).
  await page.goto(url + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  try { await page.locator('#welcome-dismiss').click({ timeout: 3000 }) } catch { /* ignore */ }
  const menuOpen = () => page.evaluate(
    () => getComputedStyle(document.querySelector('#menu-content')).display !== 'none',
  )
  await page.locator('#menu-button').click()
  if (!(await menuOpen())) throw new Error('menu did not open')
  await page.locator('#examples').getByText('Browse Demos').click()
  await page.locator('.demo-panel').waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForTimeout(1500)

  const entries = await page.locator('.demo-nav-file, .demo-nav-dir').count()
  const panelErr = await page.locator('.demo-error').textContent().catch(() => null)
  check('Browse Demos lists examples', entries > 0 && !panelErr, panelErr || `${entries} entries`)

  const usedManifest = listingReqs.some(r => r.url.endsWith('manifest.json') && r.status === 200)
  const listing403 = listingReqs.find(r => !r.url.endsWith('manifest.json'))
  check('uses manifest.json (no directory listing)', usedManifest && !listing403,
    listing403 ? `unexpected ${listing403.status} ${listing403.url}` : (usedManifest ? '' : 'manifest.json not fetched'))

  // 2. Models/grids render. Each in its OWN fresh context (a fresh worker, like
  //    opening the app and clicking one item): a plain model, an include-heavy
  //    model (resolution must survive the SPA host returning index.html for the
  //    missing relative path), and a grid (many models with shared includes in
  //    one worker — exercises per-grid-item state isolation).
  for (const [path, name, timeout] of [
    ['/examples/openscad/01-basics/cube.scad', 'cube.scad', 30000],
    ['/examples/openscad/mcad/examples/hardware_test.scad', 'hardware_test.scad (include resolution)', 30000],
    ['/examples/openscad/01-basics/ALL.js', '01-basics/ALL.js (grid)', 90000],
  ]) {
    const ctx = await browser.newContext()
    const pg = await ctx.newPage()
    // A grid catches each cell's error and draws a marker, so the page still
    // settles ok; the dead cells show only in these console lines.
    const deadCells = []
    pg.on('console', m => {
      if (m.type() === 'error' && m.text().startsWith('ALL: FAILED ')) deadCells.push(m.text().slice('ALL: FAILED '.length))
    })
    await pg.goto(url + '/#' + path, { waitUntil: 'domcontentloaded', timeout: 30000 })
    try { await pg.locator('#welcome-dismiss').click({ timeout: 3000 }) } catch { /* ignore */ }
    // #progress starts display:none (static/main.css), so waiting for it to
    // hide resolves before the model runs. html[data-render] is the real gate.
    let settled = true
    await pg.waitForFunction(
      () => ['ok', 'error'].includes(document.documentElement.dataset.render),
      null, { timeout },
    ).catch(() => { settled = false })
    const errVisible = await pg.locator('#error-bar').isVisible().catch(() => false)
    const empty = settled && !errVisible && await pg.evaluate(() => document.documentElement.dataset.vertices) === '0'
    check(`${name} renders`, settled && !errVisible && !empty && !deadCells.length,
      !settled ? `no render after ${timeout} ms`
        : errVisible ? (await pg.locator('#error-bar').textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim().slice(0, 140)
          : empty ? 'drew no vertices'
            : deadCells.length ? `${deadCells.length} dead cell(s): ${deadCells.slice(0, 3).join('; ').slice(0, 200)}` : '')
    await ctx.close()
  }

  // 3. The frame runs on its own origin, so example files must be readable
  //    cross-origin while the API must not be.
  const acao = async (path) => {
    const res = await page.request.get(url + path, { failOnStatusCode: false })
    return { status: res.status(), header: res.headers()['access-control-allow-origin'] ?? null }
  }
  const ex = await acao('/examples/openscad/01-basics/cube.scad')
  check('examples send Access-Control-Allow-Origin: *', ex.status === 200 && ex.header === '*',
    `${ex.status}, ACAO ${ex.header ?? 'absent'}`)
  const api = await acao('/api/health')
  check('/api/health sends no Access-Control-Allow-Origin', api.header === null,
    api.header ? `ACAO ${api.header}` : '')
} catch (e) {
  // Name the step that threw: "smoke run completed" alone sends the reader to
  // the whole file.
  const step = fails.length || checked.length ? `after ${checked[checked.length - 1] ?? 'no check'}` : 'before the first check'
  check(`smoke run completed (${step})`, false, String(e).split('\n')[0].slice(0, 160))
}

await browser.close()
if (fails.length) {
  console.error(`\n✖ ${fails.length} smoke check(s) FAILED:`)
  fails.forEach(f => console.error('   - ' + f))
  process.exit(1)
}
console.log('\n✓ all smoke checks passed')
