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
  await expect(page.locator('.ai-settings')).toContainText('Key set (sk-test….')

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

// Stub one API call the page makes itself — the relay hops (`**/api/fetch`,
// `**/api/search`) and the browser-direct MCP endpoints — and log every parsed
// request body so a test can pin the exact payload the page sent. `respond` is
// either a literal `{status, body}` or a function of the request body that
// returns one. Register it before navigation; Playwright keeps routes across
// reloads. Returns the captured request bodies, in order.
const routeApi = async (page, pattern, respond = {}) => {
  const calls = []
  await page.route(pattern, async (route) => {
    let payload
    try {
      payload = route.request().postDataJSON()
    } catch {
      payload = null
    }
    calls.push(payload)
    const answer = typeof respond === 'function' ? respond(payload) : respond
    await route.fulfill({
      status: answer.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(answer.body ?? {}),
    })
  })
  return calls
}

// The keyless search tiers the browser reaches directly (Firecrawl went
// OAuth-only 2026-10-18, so it is keyed-only now). Tavily cannot join
// them: it answers no CORS preflight, so it is relay-only.
const DIRECT_MCP_ENDPOINTS = ['https://mcp.exa.ai/mcp', 'https://search.parallel.ai/mcp']

const MCP_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
}

// Stub the browser-direct MCP search endpoints and log every JSON-RPC POST as
// `{ url, status, body }`, so a test can pin the routing and the exact
// `tools/call` payload. A JSON POST triggers a CORS preflight, which route
// interception sees too, so answer OPTIONS with the CORS headers. The success
// body matches `test/aiSearch.test.js`'s `mcpOk` shape.
const stubMcp = async (page, results, { status = 200, body } = {}) => {
  const hits = []
  const payload = body ?? { result: { results } }
  for (const endpoint of DIRECT_MCP_ENDPOINTS) {
    await page.route(endpoint, async (route) => {
      const request = route.request()
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: MCP_CORS })
        return
      }
      let parsed = null
      try { parsed = request.postDataJSON() } catch { parsed = null }
      hits.push({ url: request.url(), status, body: parsed })
      await route.fulfill({ status, headers: MCP_CORS, contentType: 'application/json', body: JSON.stringify(payload) })
    })
  }
  return hits
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

  test('webfetch asks for permission first, then fetches through the relay', async ({ page }) => {
    test.setTimeout(60_000)
    const url = 'https://example.com/part'
    stub = await startStubRelay([
      // Turn 1: the ungranted call is denied, so the model just closes.
      { name: 'webfetch', args: { url } },
      { text: 'Permission needed.' },
      // Turn 2, after the user grants: the same call now reaches the relay.
      { name: 'webfetch', args: { url } },
      { text: 'Fetched.' },
    ])
    const fetches = await routeApi(page, '**/api/fetch', (body) => ({
      body: { ok: true, title: 'Part', finalUrl: body.url, content: '# Part\nsteel', truncated: false },
    }))
    // ROUTING: the target is never fetched directly — a browser cannot read a
    // cross-origin page, so only /api/fetch may carry the URL.
    const direct = []
    page.on('request', (req) => { if (req.url().startsWith('https://example.com')) direct.push(req.url()) })
    await openChatWithKey(page, stub)

    await page.locator('.chat-input').fill(`fetch ${url}`)
    await page.locator('.chat-send').click()
    await expect(page.locator('.chat-messages')).toContainText('Permission needed.', { timeout: 30_000 })
    await expect(page.locator('.chat-send')).toHaveText('Send')

    // The ungranted call fired no network and rendered no tool row; the model
    // saw the grant request instead (the second request carries that result).
    expect(fetches).toHaveLength(0)
    const denied = stub.requests[1].messages.filter((m) => m.role === 'tool').at(-1)
    expect(denied.content).toContain("webfetch needs the user's permission")
    await expect(page.locator('.chat-tool')).toHaveCount(0)

    // Grant the blanket permission for this conversation, then retry.
    await page.locator('.ai-gear').click()
    await page.locator('.ai-websearch-allow').check()
    await page.locator('.ai-dialog-footer button').click()

    await page.locator('.chat-input').fill(`fetch ${url}`)
    await page.locator('.chat-send').click()
    await expect(page.locator('.chat-messages')).toContainText('Fetched.', { timeout: 30_000 })

    // ROUTING: exactly one relay fetch, carrying the page-side contract body.
    expect(fetches).toEqual([{ url, format: 'markdown' }])
    expect(direct).toEqual([])
    // The model-visible result carried the relay's page text.
    const granted = stub.requests.at(-1).messages.filter((m) => m.role === 'tool').at(-1)
    expect(JSON.parse(granted.content)).toMatchObject({ ok: true, content: expect.stringContaining('steel') })
    // Rendered result: the one granted call is the only tool row, and it succeeded.
    await expect(page.locator('.chat-tool')).toHaveCount(1)
    await expect(page.locator('.chat-tool-mark')).toHaveText('ok')
    await expect(page.locator('.chat-tool-name')).toHaveText('webfetch')
    // webfetch carries no path/query, so the URL shows in the row's input detail.
    await expect(page.locator('.chat-tool-input')).toContainText('example.com/part')
  })

  test('webfetch relay failure renders failed, keeps turn alive', async ({ page }) => {
    test.setTimeout(60_000)
    stub = await startStubRelay([
      { name: 'webfetch', args: { url: 'https://example.com/down' } },
      { text: 'Could not fetch.' },
    ])
    const fetches = await routeApi(page, '**/api/fetch', { status: 502, body: { error: 'boom', name: 'FetchError' } })
    await openChatWithKey(page, stub)

    // Pre-grant the blanket permission so the call reaches the relay stub.
    await page.locator('.ai-gear').click()
    await page.locator('.ai-websearch-allow').check()
    await page.locator('.ai-dialog-footer button').click()

    await page.locator('.chat-input').fill('fetch https://example.com/down')
    await page.locator('.chat-send').click()
    await expect(page.locator('.chat-messages')).toContainText('Could not fetch.', { timeout: 30_000 })

    // The relay's 502 fails the tool line but the turn still closes with text.
    await expect(page.locator('.chat-tool.failed')).toBeVisible()
    await expect(page.locator('.chat-tool-mark')).toHaveText('failed')
    // The model saw the relay's failure, not merely a failed-looking row.
    const failed = stub.requests.at(-1).messages.filter((m) => m.role === 'tool').at(-1)
    expect(JSON.parse(failed.content)).toEqual({ ok: false, error: { name: 'FetchError', message: 'boom' } })
    // ROUTING: the failure is the relay's 502, not a skipped call.
    expect(fetches).toEqual([{ url: 'https://example.com/down', format: 'markdown' }])
  })

  test('websearch runs keyless through the direct pool and logs provider', async ({ page }) => {
    test.setTimeout(60_000)
    const query = '608 bearing dimensions'
    stub = await startStubRelay([
      { name: 'websearch', args: { query } },
      { text: 'Found.' },
    ])
    // The keyless pool: whichever tier answers, the relay search hop stays cold.
    const directHits = await stubMcp(page, [{ title: '608', url: 'https://example.com/bearing', snippet: '8x22x7' }])
    const relayHits = await routeApi(page, '**/api/search', { body: { ok: true, results: [] } })
    const logs = []
    page.on('console', (msg) => { if (msg.text().includes('[websearch]')) logs.push(msg.text()) })
    await openChatWithKey(page, stub)

    // Pre-grant the blanket permission so the call reaches the pool.
    await page.locator('.ai-gear').click()
    await page.locator('.ai-websearch-allow').check()
    await page.locator('.ai-dialog-footer button').click()

    await page.locator('.chat-input').fill('bearing size?')
    await page.locator('.chat-send').click()
    await expect(page.locator('.chat-messages')).toContainText('Found.', { timeout: 30_000 })

    // ROUTING (direct): at least one MCP endpoint answered, and every endpoint
    // hit was a JSON-RPC tools/call with its provider's arg shape
    // (Exa {query,objective,numResults}, Parallel {objective,search_queries});
    // the relay never saw a search.
    expect(directHits.length).toBeGreaterThanOrEqual(1)
    for (const hit of directHits) {
      expect(DIRECT_MCP_ENDPOINTS).toContain(hit.url)
      expect(hit.body).toMatchObject({ jsonrpc: '2.0', method: 'tools/call' })
      const toolArgs = hit.body.params.arguments
      if (hit.url.includes('exa.ai')) {
        expect(toolArgs).toMatchObject({ query, objective: expect.any(String), numResults: 8 })
      } else {
        expect(toolArgs).toMatchObject({ objective: expect.stringContaining(query), search_queries: expect.any(Array) })
      }
    }
    expect(relayHits).toEqual([])

    // The model-visible result carried the tagged direct hit...
    const tool = stub.requests.at(-1).messages.filter((m) => m.role === 'tool').at(-1)
    const parsed = JSON.parse(tool.content)
    expect(parsed.ok).toBe(true)
    expect(parsed.results[0]).toMatchObject({
      title: '608',
      url: 'https://example.com/bearing',
      snippet: '8x22x7',
      provider: expect.stringMatching(/^(exa|parallel)$/),
    })
    // ...and the audit log names the provider that answered.
    expect(logs.join('\n')).toMatch(/provider: (exa|parallel)/)

    // Rendered row: websearch carries a query, so the target detail shows it.
    await expect(page.locator('.chat-tool')).toHaveCount(1)
    await expect(page.locator('.chat-tool-mark')).toHaveText('ok')
    await expect(page.locator('.chat-tool-name')).toHaveText('websearch')
    await expect(page.locator('.chat-tool-target')).toHaveText(query)
  })

  test('websearch pinned off fails closed; Tavily fallback tags provider', async ({ page }) => {
    test.setTimeout(90_000)
    stub = await startStubRelay([
      // Part A: the pinned-off call is answered without touching any network.
      { name: 'websearch', args: { query: 'off query' } },
      { text: 'Blocked.' },
      // Part B: the direct pool is exhausted, so the relay answers.
      { name: 'websearch', args: { query: 'bearing 608' } },
      { text: 'Fallback found.' },
    ])
    // The direct pool answers 429 for every keyless tier; every MCP POST and
    // every relay hop is logged so each part can pin the routing it proves.
    const directHits = await stubMcp(page, [], { status: 429, body: {} })
    const relayHits = await routeApi(page, '**/api/search', {
      body: { ok: true, results: [{ title: 't', url: 'https://example.com', snippet: 's', provider: 'exa' }] },
    })
    await openChatWithKey(page, stub)

    // Part A: pin off. Grant first so the call reaches the handler instead of
    // the permission gate.
    await page.locator('.ai-gear').click()
    await page.locator('.ai-websearch-allow').check()
    await page.locator('.ai-websearch-provider').selectOption('off')
    await page.locator('.ai-dialog-footer button').click()

    await page.locator('.chat-input').fill('search with search off?')
    await page.locator('.chat-send').click()
    await expect(page.locator('.chat-messages')).toContainText('Blocked.', { timeout: 30_000 })

    const blocked = stub.requests.at(-1).messages.filter((m) => m.role === 'tool').at(-1)
    expect(JSON.parse(blocked.content)).toMatchObject({ ok: false, error: { name: 'SearchUnavailableError' } })
    // ROUTING: pinned off fails closed — no MCP endpoint and no relay hop.
    expect(directHits).toEqual([])
    expect(relayHits).toEqual([])
    await expect(page.locator('.chat-tool.failed')).toBeVisible()

    // Part B: clear the pin and store a Tavily key. Device custody so the
    // dialog's store and the handler's store share the key (session memory is
    // per instance); then retry, which must fall back to the relay.
    await page.locator('.ai-gear').click()
    await page.locator('.ai-websearch-provider').selectOption('random')
    await page.locator('.ai-search-mode').selectOption('device')
    const tavily = page.locator('[data-search-provider="tavily"]')
    await tavily.locator('.ai-search-key-input').fill('sk-tavily')
    await tavily.locator('.ai-search-save').click()
    await expect(tavily.locator('.ai-search-status')).toHaveText('key set')
    await page.locator('.ai-dialog-footer button').click()

    await page.locator('.chat-input').fill('bearing size?')
    await page.locator('.chat-send').click()
    await expect(page.locator('.chat-messages')).toContainText('Fallback found.', { timeout: 30_000 })

    // ROUTING (relay): the direct pool was tried and exhausted (429)...
    expect(directHits.length).toBeGreaterThanOrEqual(2)
    for (const hit of directHits) {
      expect(DIRECT_MCP_ENDPOINTS).toContain(hit.url)
      expect(hit.status).toBe(429)
      expect(hit.body).toMatchObject({ jsonrpc: '2.0', method: 'tools/call' })
    }
    // ...then POST /api/search carried exactly { query, count: 8 }.
    expect(relayHits).toEqual([{ query: 'bearing 608', count: 8 }])

    // The relay's hits are retagged provider:'tavily' (the stub claimed 'exa').
    const relayed = stub.requests.at(-1).messages.filter((m) => m.role === 'tool').at(-1)
    const parsed = JSON.parse(relayed.content)
    expect(parsed.ok).toBe(true)
    expect(parsed.results).toEqual([{ title: 't', url: 'https://example.com', snippet: 's', provider: 'tavily' }])
    await expect(page.locator('.chat-tool-mark').last()).toHaveText('ok')
    await expect(page.locator('.chat-tool-result').last()).toContainText('tavily')
  })

  // `view` is deliberately absent from the offered catalog for a text model
  // (tools.test.js pins that gate), so the model cannot discover it — but the
  // app still serves it through `aiDeps.view` when a turn asks for it. These two
  // tests pin the off-screen pipeline end to end: a real PNG data URL reaches
  // the model as a native image part, the transcript shows only the cameras, and
  // an unresolvable view fails the tool line without hanging the turn.
  test('view captures the model off-screen and the images reach the model', async ({ page }) => {
    test.setTimeout(60_000)
    stub = await startStubRelay([
      { name: 'view', args: {} },
      { text: 'I see a cube.' },
    ])
    await openChatWithKey(page, stub)

    // The default model is already rendered (the helper's waitForRender), so the
    // off-screen pass re-renders it from its own mesh: no route stub is needed.
    await page.locator('.chat-input').fill('what do you see?')
    await page.locator('.chat-send').click()
    await expect(page.locator('.chat-messages')).toContainText('I see a cube.', { timeout: 30_000 })

    // The transcript shows the cameras only: no data URL lands in the DOM.
    const rendered = await page.locator('.chat-tool-result').evaluate((el) => el.textContent)
    const parsed = JSON.parse(rendered)
    expect(parsed.ok).toBe(true)
    expect(parsed.image).toBeUndefined()
    expect(parsed.cameras).toHaveLength(1)
    expect(parsed.cameras[0]).toMatchObject({
      position: expect.any(Array),
      target: expect.any(Array),
      fov: expect.any(Number),
      aspect: expect.any(Number),
    })

    // The model's copy is the small camera stub as the tool text and the render
    // as a native image part in the follow-up user message of the same round.
    const second = stub.requests.at(-1)
    const tool = second.messages.filter((m) => m.role === 'tool').at(-1)
    expect(JSON.parse(tool.content)).toEqual({ ok: true, cameras: parsed.cameras })
    const imageMsg = second.messages.filter((m) => m.role === 'user' && Array.isArray(m.content)).at(-1)
    const image = imageMsg.content.find((part) => part.type === 'image_url')
    expect(image.image_url.url.slice(0, 22)).toBe('data:image/png;base64,')

    // Still under the relay's 1MB JSON body limit even with the pixels attached.
    expect(JSON.stringify(second).length).toBeLessThan(1_000_000)

    // The offered catalog never listed view: the stub model is not vision-capable.
    expect(stub.requests[0].tools.map((t) => t.function.name)).not.toContain('view')

    // Rendered: one successful tool row named view; the live canvas is untouched.
    await expect(page.locator('.chat-tool')).toHaveCount(1)
    await expect(page.locator('.chat-tool-name')).toHaveText('view')
    await expect(page.locator('.chat-tool-mark')).toHaveText('ok')
    await expect(page.locator('#viewer canvas')).toBeVisible()
  })

  test('view of a missing part fails the tool line without hanging', async ({ page }) => {
    test.setTimeout(60_000)
    stub = await startStubRelay([
      { name: 'view', args: { views: [{ lookAt: 'nope' }] } },
      { text: 'No view.' },
    ])
    await openChatWithKey(page, stub)

    await page.locator('.chat-input').fill('what do you see?')
    await page.locator('.chat-send').click()
    // The turn still closes with the model's text: a bad view is a tool result,
    // never a hang or a turn failure.
    await expect(page.locator('.chat-messages')).toContainText('No view.', { timeout: 30_000 })

    // The model saw the failure, not merely a failed-looking row.
    const tool = stub.requests.at(-1).messages.filter((m) => m.role === 'tool').at(-1)
    expect(JSON.parse(tool.content)).toMatchObject({ ok: false, error: { name: 'PartNotFoundError', message: expect.stringContaining('nope') } })

    await expect(page.locator('.chat-tool.failed')).toBeVisible()
    await expect(page.locator('.chat-tool-mark')).toHaveText('failed')
    await expect(page.locator('.chat-tool-name')).toHaveText('view')
  })

  // The `question` tool is served by the chat card itself: the turn pauses, the
  // card renders in the transcript, and the chosen answer returns to the loop.
  // A string result rides through verbatim (like a `docs` result), so the model
  // sees the raw answer, never JSON.
  test('question shows options and the picked answer reaches the model', async ({ page }) => {
    test.setTimeout(60_000)
    stub = await startStubRelay([
      { name: 'question', args: { question: 'Which size?', options: ['10 mm', '20 mm'], header: 'Size' } },
      { text: 'Building 20 mm.' },
    ])
    await openChatWithKey(page, stub)

    await page.locator('.chat-input').fill('model a bracket')
    await page.locator('.chat-send').click()

    // The card renders mid-turn: the short header, the question, and one button
    // per option.
    await expect(page.locator('.chat-question')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.chat-question-header')).toHaveText('Size')
    await expect(page.locator('.chat-question-option')).toHaveCount(2)

    await page.locator('.chat-question-option', { hasText: '20 mm' }).click()
    await expect(page.locator('.chat-messages')).toContainText('Building 20 mm.', { timeout: 30_000 })

    // Model-visible: the raw answer string, verbatim — not `"20 mm"` JSON.
    const tool = stub.requests.at(-1).messages.filter((m) => m.role === 'tool').at(-1)
    expect(tool.content).toBe('20 mm')

    // Rendered row: named question, the short header as the target, and success.
    await expect(page.locator('.chat-tool')).toHaveCount(1)
    await expect(page.locator('.chat-tool-name')).toHaveText('question')
    await expect(page.locator('.chat-tool-target')).toHaveText('Size')
    await expect(page.locator('.chat-tool-mark')).toHaveText('ok')
  })

  // With no options the card offers its own text input, and the chat input
  // answers it too: while a question is open a non-empty Send submits the draft
  // as the answer instead of starting a new turn (the button is the turn's Stop).
  test('question takes a typed custom answer via the chat input', async ({ page }) => {
    test.setTimeout(60_000)
    stub = await startStubRelay([
      { name: 'question', args: { question: 'Which printer?', header: 'Printer' } },
      { text: 'Sliced for mk3.' },
    ])
    await openChatWithKey(page, stub)

    await page.locator('.chat-input').fill('slice it')
    await page.locator('.chat-send').click()

    // No options: a text input instead of buttons.
    await expect(page.locator('.chat-question')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.chat-question-input')).toBeVisible()
    await expect(page.locator('.chat-question-option')).toHaveCount(0)

    await page.locator('.chat-input').fill('mk3')
    await page.locator('.chat-send').click()
    await expect(page.locator('.chat-messages')).toContainText('Sliced for mk3.', { timeout: 30_000 })

    // Model-visible: the typed answer, verbatim.
    const tool = stub.requests.at(-1).messages.filter((m) => m.role === 'tool').at(-1)
    expect(tool.content).toBe('mk3')
    await expect(page.locator('.chat-tool')).toHaveCount(1)
    await expect(page.locator('.chat-tool-name')).toHaveText('question')
    await expect(page.locator('.chat-tool-target')).toHaveText('Printer')
    await expect(page.locator('.chat-tool-mark')).toHaveText('ok')
  })
})
