#!/usr/bin/env node
/**
 * smoke-deploy.mjs — post-deploy smoke test against a live (or local) URL.
 *
 * Drives a real (bundled-chromium, WebGL) browser through the critical paths a
 * curl check can't see, and FAILS LOUDLY (non-zero exit) on any problem:
 *   1. the app boots and a model renders (no error bar)
 *   2. Browse Demos lists examples via manifest.json — NOT a directory listing
 *      (catches the prod autoindex 403)
 *
 *   node e2e/smoke-deploy.mjs --url https://jscad.rkroll.com
 */
import { chromium } from '@playwright/test'

const url = (() => {
  const i = process.argv.indexOf('--url')
  return (i !== -1 ? process.argv[i + 1] : 'http://localhost:5120')
})().replace(/\/$/, '')

const fails = []
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fails.push(`${name}${detail ? ': ' + detail : ''}`)
}

console.log(`Smoke testing ${url}`)
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
  await page.waitForTimeout(1000)
  await page.locator('#menu-button').click()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#menu-content')).display !== 'none', null, { timeout: 8000 })
  await page.locator('#examples').getByText('Browse Demos').click()
  await page.locator('.demo-panel').waitFor({ state: 'visible', timeout: 8000 })
  await page.waitForTimeout(1500)

  const entries = await page.locator('.demo-nav-file, .demo-nav-dir').count()
  const panelErr = await page.locator('.demo-error').textContent().catch(() => null)
  check('Browse Demos lists examples', entries > 0 && !panelErr, panelErr || `${entries} entries`)

  const usedManifest = listingReqs.some(r => r.url.endsWith('manifest.json') && r.status === 200)
  const listing403 = listingReqs.find(r => !r.url.endsWith('manifest.json'))
  check('uses manifest.json (no directory listing)', usedManifest && !listing403,
    listing403 ? `unexpected ${listing403.status} ${listing403.url}` : (usedManifest ? '' : 'manifest.json not fetched'))

  // 2. App boots + a known model renders.
  await page.goto(url + '/#/examples/openscad/01-basics/cube.scad', { waitUntil: 'domcontentloaded', timeout: 30000 })
  try { await page.locator('#welcome-dismiss').click({ timeout: 3000 }) } catch { /* ignore */ }
  await page.locator('#progress').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const errVisible = await page.locator('#error-bar').isVisible().catch(() => false)
  check('cube.scad renders (no error bar)', !errVisible,
    errVisible ? (await page.locator('#error-bar').textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim().slice(0, 140) : '')
} catch (e) {
  check('smoke run completed', false, String(e).split('\n')[0].slice(0, 160))
}

await browser.close()
if (fails.length) {
  console.error(`\n✖ ${fails.length} smoke check(s) FAILED:`)
  fails.forEach(f => console.error('   - ' + f))
  process.exit(1)
}
console.log('\n✓ all smoke checks passed')
