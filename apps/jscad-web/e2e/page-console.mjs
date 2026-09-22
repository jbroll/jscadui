#!/usr/bin/env node
/**
 * page-console.mjs — open a URL in the bundled chromium and print everything
 * the browser said: console messages, uncaught errors, failed requests and
 * non-2xx responses. The first thing to reach for when a deploy smoke test
 * fails and the message only says a wait timed out.
 *
 *   node e2e/page-console.mjs --url https://jscad.rkroll.com
 *   node e2e/page-console.mjs --url http://localhost:5120/#/examples/x.scad --wait 20000
 *
 * Options:
 *   --url <url>       page to open (default http://localhost:5120)
 *   --wait <ms>       how long to watch after load (default 15000)
 *   --click <sel>     click this selector after load, before watching
 *   --init <js>       statement to run before any page script, e.g. to install
 *                     an observer that records what happens during load
 *   --eval <js>       expression to evaluate in the page after watching; its
 *                     value is printed as JSON
 *   --headed          show the browser
 */
import { chromium } from '@playwright/test'

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? fallback : process.argv[i + 1]
}

const url = arg('url', 'http://localhost:5120')
const waitMs = Number(arg('wait', 15000))
// Repeatable, in order: --click '#welcome-dismiss' --click '#menu-button'
const clicks = process.argv.flatMap((a, i) => (a === '--click' ? [process.argv[i + 1]] : []))
const headed = process.argv.includes('--headed')

const browser = await chromium.launch({
  headless: !headed,
  args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
})
const page = await (await browser.newContext()).newPage()

const line = (tag, text) => console.log(`[${tag}] ${text}`)

page.on('console', (m) => line(m.type(), m.text()))
page.on('pageerror', (e) => line('pageerror', e.stack ?? String(e)))
page.on('requestfailed', (r) => line('reqfail', `${r.failure()?.errorText ?? 'failed'} ${r.url()}`))
page.on('response', (r) => {
  if (r.status() >= 400) line('http' + r.status(), r.url())
})

const init = arg('init', null)
if (init) await page.addInitScript(init)

console.log(`Opening ${url}`)
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
} catch (e) {
  line('goto', String(e))
}

for (const sel of clicks) {
  try {
    await page.locator(sel).click({ timeout: 5000 })
    line('click', sel)
  } catch (e) {
    line('click-failed', `${sel}: ${e.message?.split('\n')[0]}`)
  }
  await page.waitForTimeout(1000)
}

await page.waitForTimeout(waitMs)

const expr = arg('eval', null)
if (expr) {
  try {
    line('eval', JSON.stringify(await page.evaluate(`(() => (${expr}))()`)))
  } catch (e) {
    line('eval-failed', e.message?.split('\n')[0])
  }
}

await browser.close()
