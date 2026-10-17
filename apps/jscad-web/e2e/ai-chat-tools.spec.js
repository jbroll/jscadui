// End-to-end coverage for every tool the chat agent can call through the real
// page. A node http server stubs the relay at /api/relay/*, and each test pins
// both the model-visible result (the tool message in `stub.requests`) and the
// rendered chat DOM, plus the routing: inference, page fetch and search fallback
// ride the relay; a keyless search calls the MCP endpoints the browser reaches
// directly. No app code is exercised twice: this spec never imports the other
// spec, only the shared page helpers.
import { test, expect } from '@playwright/test'
import http from 'node:http'
import { TOS_VERSION } from '../src/aiConsent.js'
import { dismissWelcome, waitForRender } from './helpers.js'

// Every turn is gated on an accepted terms version, so a seeded relay must
// carry an accepted `jscad-ai.tos` record too, or Send opens the gate instead
// of the turn and the spec times out.
const seedTos = (version = TOS_VERSION, recordOwnChats = true) => JSON.stringify({ version, at: 0, recordOwnChats })

// The key-custody "Keep" select. Its label's accessible name also carries the
// option texts, and the search panel has a "Keep search keys" field, so target
// the field whose name span is exactly "Keep".
const keepMode = (page) =>
  page.locator('.ai-field', { has: page.locator('.ai-field-name', { hasText: /^Keep$/ }) }).locator('select')

const chunk = (json) => `data: ${JSON.stringify(json)}\n\n`

// The jscad-web free provider's catalog, as `GET /api/relay/jscad-web/v1/models` returns it.
const INFERENCE_OPTIONS = [{ id: 'deepseek-v4-flash', kind: 'opencode-go', model: 'deepseek-v4-flash', available: true }]

// A round `{ name, args }` answers a tool call, `{ text }` a closing reply, and
// `{ status, body }` a refused turn (the free route's 402 quota answer). Once
// the script runs out every request answers 'Done.'.
// `catalog` is the free option list the gear dialog reads; a free turn answers
// on the jscad-web route exactly like the own-key one.
const startStubRelay = (rounds = [], { delayMs = 0, catalog = INFERENCE_OPTIONS } = {}) =>
  new Promise((resolve) => {
    const requests = []
    const paths = []
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization, x-jscad-chat-id, x-opencode-session',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    }
    const server = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors)
        res.end()
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', async () => {
        // The free catalog the gear dialog reads.
        if (req.method === 'GET' && req.url === '/api/relay/jscad-web/v1/models') {
          res.writeHead(200, { ...cors, 'content-type': 'application/json' })
          res.end(JSON.stringify(catalog))
          return
        }
        const freeTurn = /^\/api\/relay\/jscad-web\/[^/]+\/v1\/chat\/completions$/.test(req.url)
        if ((req.url !== '/api/relay/openai/v1/chat/completions' && !freeTurn) || req.method !== 'POST') {
          res.writeHead(404)
          res.end()
          return
        }
        requests.push(JSON.parse(body))
        paths.push(req.url)
        const round = rounds[requests.length - 1]
        await new Promise((r) => setTimeout(r, delayMs))
        // A refused turn never streams: answer its status and JSON body instead.
        if (round?.status) {
          res.writeHead(round.status, { ...cors, 'content-type': 'application/json' })
          res.end(JSON.stringify(round.body ?? { error: { message: 'stub relay error' } }))
          return
        }
        res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        if (round?.name) {
          const call = { index: 0, id: `call-${requests.length}`, function: { name: round.name, arguments: JSON.stringify(round.args) } }
          res.write(chunk({ choices: [{ delta: { tool_calls: [call] } }] }))
          res.write(chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
        } else {
          res.write(chunk({ choices: [{ delta: { content: round?.text ?? 'Done.' } }] }))
          res.write(chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        }
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests, paths }))
  })

// Open the drawer, configure an own-key provider through the gear dialog, point
// the page at `stub`, and reopen the chat ready to send. Both the selection and
// the kept key survive the reload that installs the relay override.
const openChatWithKey = async (page, stub, { provider = 'openai', model = 'stub-model', key = 'sk-test' } = {}) => {
  await page.goto('/')
  await dismissWelcome(page)
  await waitForRender(page)
  await page.locator('#menu-button').click()
  await page.locator('#ai-chat-btn').click()
  await expect(page.locator('#ai-chat')).toBeVisible()

  await page.locator('.ai-gear').click()
  await page.locator('.ai-provider-select').selectOption(provider)
  await page.locator('.ai-model-input').fill(model)
  await page.locator('.ai-model-input').dispatchEvent('change')
  await keepMode(page).selectOption('device')
  await page.locator('.ai-key-input').fill(key)
  await page.locator('.ai-save-key').click()
  await expect(page.locator('.ai-settings')).toContainText('Key set.')

  await page.addInitScript(({ port, tos }) => {
    window.localStorage.setItem('jscad-ai.relay', `http://127.0.0.1:${port}`)
    window.localStorage.setItem('jscad-ai.tos', tos)
  }, { port: stub.port, tos: seedTos() })
  await page.reload()
  await dismissWelcome(page)
  await waitForRender(page)
  await page.locator('#menu-button').click()
  await page.locator('#ai-chat-btn').click()
  await expect(page.locator('#ai-chat')).toBeVisible()
}

// Point the page at `stub` and pick the free jscad-web provider from its
// catalog, ready to send. A free selection rides the relay's own route.
const openChatFree = async (page, stub, modelName = 'deepseek-v4-flash') => {
  await page.addInitScript(({ port, tos }) => {
    window.localStorage.setItem('jscad-ai.relay', `http://127.0.0.1:${port}`)
    window.localStorage.setItem('jscad-ai.tos', tos)
  }, { port: stub.port, tos: seedTos() })
  await page.goto('/')
  await dismissWelcome(page)
  await waitForRender(page)
  await page.locator('#menu-button').click()
  await page.locator('#ai-chat-btn').click()
  await page.locator('.ai-gear').click()
  await expect(page.locator('.ai-provider-select option[value="jscad-web"]')).toHaveCount(1)
  await page.locator('.ai-provider-select').selectOption('jscad-web')
  // The catalog GET backs the shared model menu; the key controls stay disabled.
  await expect(page.locator('.ai-model-select')).toContainText(modelName)
  await page.locator('.ai-dialog-footer button').click()
  await expect(page.locator('#ai-chat')).toBeVisible()
}

test.describe('AI chat tools', () => {
  let stub

  test.afterEach(() => {
    stub?.server.closeAllConnections?.()
    stub?.server.close()
    stub = null
  })

  test('own-key inference turn offers web tools and completes', async ({ page }) => {
    test.setTimeout(60_000)
    stub = await startStubRelay([{ text: 'Hello from stub.' }])
    await openChatWithKey(page, stub)

    await page.locator('.chat-input').fill('say hello')
    await page.locator('.chat-send').click()
    await expect(page.locator('.chat-messages')).toContainText('Hello from stub.', { timeout: 30_000 })

    expect(stub.requests).toHaveLength(1)
    const offered = stub.requests[0].tools.map((t) => t.function.name)
    expect(offered).toEqual(expect.arrayContaining(['websearch', 'webfetch']))
    expect(offered).not.toContain('view')
    expect(offered).not.toContain('eval')

    // ROUTING: the turn rode the relay's OpenAI route, never a direct provider call.
    expect(stub.paths).toEqual(['/api/relay/openai/v1/chat/completions'])
  })

  test('free jscad-web inference turn rides the free route', async ({ page }) => {
    test.setTimeout(60_000)
    stub = await startStubRelay([{ text: 'Free reply.' }])
    const turns = []
    page.on('request', (req) => { if (req.url().includes('/v1/chat/completions')) turns.push(req.url()) })
    await openChatFree(page, stub)

    await page.locator('.chat-input').fill('model a cube')
    await page.locator('.chat-send').click()
    await expect(page.locator('.chat-messages')).toContainText('Free reply.', { timeout: 30_000 })

    // ROUTING: the one inference call rode the free relay route, never a provider host.
    expect(stub.paths).toEqual(['/api/relay/jscad-web/deepseek-v4-flash/v1/chat/completions'])
    expect(turns).toEqual([`http://127.0.0.1:${stub.port}/api/relay/jscad-web/deepseek-v4-flash/v1/chat/completions`])
    expect(stub.requests).toHaveLength(1)
    expect(stub.requests[0].model).toBe('deepseek-v4-flash')
  })

  test('free inference quota exhaustion renders the quota line', async ({ page }) => {
    test.setTimeout(60_000)
    stub = await startStubRelay([{ status: 402, body: { error: { message: 'inference_quota_exhausted' } } }])
    await openChatFree(page, stub)

    await page.locator('.chat-input').fill('model a cube')
    await page.locator('.chat-send').click()
    // The 402 quota refusal becomes the friendly budget line, not a raw error.
    await expect(page.locator('.chat-msg.error')).toContainText('out of budget', { timeout: 30_000 })
    await expect(page.locator('.chat-tool')).toHaveCount(0)
  })
})
