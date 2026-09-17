// Post-deploy smoke test for jscad-studio. Run by deploy-full.sh with APP_URL
// set (and optionally TEST_SESSION_COOKIE + TEST_PROVIDER_KEY for the agent
// turn). What it proves without any OAuth test harness:
//   1. the API answers /api/health,
//   2. the app loads and renders the default model through the frame,
//   3. the run host serves the frame-ancestors CSP + Permissions-Policy,
//   4. a model export returns bytes through the frame (no export UI yet).
//   5. the relay refuses an untrusted origin with 403 (no provider touched).
// With a session cookie it additionally runs one turn against a stub
// OpenAI-compatible provider (no model key needed) and asserts a text event.
import http from 'node:http'
import { chromium, expect } from '@playwright/test'

const APP_URL = process.env.APP_URL
if (!APP_URL) throw new Error('APP_URL is required (deploy-full.sh sets it)')
// RUN_URL overrides; otherwise the run host is the app host with the first
// label suffixed: jscad.rkroll.com -> jscad-run.rkroll.com,
// jscad-studio.rkroll.com -> run.jscad-studio.rkroll.com.
const RUN_URL =
  process.env.RUN_URL ??
  (APP_URL.includes('jscad-studio')
    ? APP_URL.replace('jscad-studio', 'run.jscad-studio')
    : APP_URL.replace('jscad.', 'jscad-run.'))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

// 1. API health.
const healthRes = await fetch(`${APP_URL}/api/health`)
const health = await healthRes.json().catch(() => ({}))
check('api health', healthRes.ok && health.status === 'ok', JSON.stringify(health))

// 2 + 4. App render and frame export in a real browser.
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(String(err)))
  await page.goto(APP_URL, { waitUntil: 'load' })
  await page.locator('#viewer canvas').waitFor({ timeout: 60000 })
  await expect(page.locator('#stats-content')).toContainText('Triangles', { timeout: 60000 })
  check('canvas renders default model', true)
  check('no error bar', !(await page.locator('#error-bar').getAttribute('class') ?? '').includes('visible'))
  check('no page errors', errors.length === 0, errors.join('; ').slice(0, 200))

  // The frame answers a model load directly: this is the round trip every
  // other frame check depends on, with a timeout so a silent frame fails
  // loudly instead of hanging the suite.
  const loadResult = await page.evaluate(async () => {
    const frame = document.querySelector('iframe')
    const id = 9000
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: { message: 'smoke: frame load timed out' } }), 45000)
      const onMessage = (event) => {
        if (event.source !== frame.contentWindow || event.data?.id !== id) return
        clearTimeout(timer)
        window.removeEventListener('message', onMessage)
        resolve(event.data)
      }
      window.addEventListener('message', onMessage)
      frame.contentWindow.postMessage(
        {
          id,
          command: 'load',
          payload: {
            files: {
              'main.js':
                `const { cube } = require('@jscad/modeling').primitives\n` +
                `const main = () => cube({ size: 10 })\n` +
                `module.exports = { main }\n`,
            },
            entry: 'main.js',
          },
        },
        '*',
      )
    })
  })
  check(
    'frame answers a model load',
    loadResult.ok === true && (loadResult.result?.entities?.length ?? 0) > 0,
    loadResult.ok ? `${loadResult.result.entities.length} entities` : loadResult.error?.message,
  )

  const stlBytes = await page.evaluate(async () => {
    const frame = document.querySelector('iframe')
    const id = 9001
    const done = new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false }), 45000)
      const onMessage = (event) => {
        if (event.source !== frame.contentWindow) return
        if (event.data?.id !== id) return
        clearTimeout(timer)
        window.removeEventListener('message', onMessage)
        resolve(event.data)
      }
      window.addEventListener('message', onMessage)
    })
    frame.contentWindow.postMessage(
      { id, command: 'export', payload: { format: 'stlb' } },
      '*',
    )
    return done.then((res) => {
      if (!res.ok || !Array.isArray(res.result?.data)) return -1
      return res.result.data.reduce((n, v) => n + (v?.byteLength ?? 0), 0)
    })
  })
  check('frame export returns STL bytes', stlBytes > 0, `${stlBytes} bytes`)
  await page.close()
} finally {
  await browser.close()
}

// 3. Run-host security headers.
const runRes = await fetch(RUN_URL)
const csp = runRes.headers.get('content-security-policy') ?? ''
const pp = runRes.headers.get('permissions-policy') ?? ''
check('run host frame-ancestors the app origin', csp.includes(`frame-ancestors ${APP_URL}`), csp.slice(0, 120))
check('run host permissions-policy locks sensors', pp.includes('camera=()'), pp)

// 5. Relay refuses an untrusted origin without touching any provider.
const relayRes = await fetch(`${APP_URL}/api/relay/openai/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
  body: JSON.stringify({ model: 'probe' }),
})
check('relay refuses untrusted origins', relayRes.status === 403, `status ${relayRes.status}`)

// 6. One agent turn against a stub provider (needs a session cookie; the CI
// deploy has no OAuth test harness, so this is opt-in).
if (process.env.TEST_SESSION_COOKIE && process.env.TEST_PROVIDER_KEY) {
  const stub = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        'data: {"choices":[{"delta":{"content":"stub answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      )
    })
  })
  await new Promise((resolve) => stub.listen(0, resolve))
  const stubUrl = `http://127.0.0.1:${stub.address().port}`
  const chatRes = await fetch(`${APP_URL}/api/chat/smoke-proj`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: process.env.TEST_SESSION_COOKIE,
      origin: APP_URL,
    },
    body: JSON.stringify({
      message: 'say hi',
      provider: { kind: 'openai', apiKey: process.env.TEST_PROVIDER_KEY, model: 'stub', baseUrl: stubUrl },
    }),
  })
  const text = await chatRes.text()
  stub.close()
  check('stub-provider turn streams text then done', text.includes('event: text') && text.includes('event: done'))
} else {
  console.log('○ stub-provider turn skipped (TEST_SESSION_COOKIE/TEST_PROVIDER_KEY unset)')
}

if (process.exitCode) throw new Error('smoke test failed')
console.log('smoke test passed')
