// Post-deploy smoke test for jscad-studio. Run by deploy-full.sh with APP_URL
// set (and optionally TEST_SESSION_COOKIE + TEST_PROVIDER_KEY for the agent
// turn). What it proves without any OAuth test harness:
//   1. the API answers /api/health,
//   2. the app loads and renders the default model through the frame,
//   3. the run host serves the frame-ancestors CSP + Permissions-Policy,
//   4. a model export returns bytes through the frame (no export UI yet).
// With a session cookie it additionally runs one turn against a stub
// OpenAI-compatible provider (no model key needed) and asserts a text event.
import http from 'node:http'
import { chromium } from '@playwright/test'

const APP_URL = process.env.APP_URL
if (!APP_URL) throw new Error('APP_URL is required (deploy-full.sh sets it)')
const RUN_URL = APP_URL.replace('jscad-studio', 'run.jscad-studio')

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
  const stats = await page.locator('#stats-content').textContent()
  check('canvas renders default model', (stats ?? '').includes('Triangles'))
  check('no error bar', !(await page.locator('#error-bar').getAttribute('class') ?? '').includes('visible'))
  check('no page errors', errors.length === 0, errors.join('; ').slice(0, 200))

  const stlBytes = await page.evaluate(async () => {
    const frame = document.querySelector('iframe')
    const id = 9001
    const done = new Promise((resolve) => {
      const onMessage = (event) => {
        if (event.source !== frame.contentWindow) return
        if (event.data?.id !== id) return
        window.removeEventListener('message', onMessage)
        resolve(event.data)
      }
      window.addEventListener('message', onMessage)
    })
    frame.contentWindow.postMessage(
      { id, command: 'export', payload: { format: 'stl' } },
      '*',
    )
    return done.then((res) => (res.ok ? res.result.data.byteLength : -1))
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

// 5. One agent turn against a stub provider (needs a session cookie; the CI
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
