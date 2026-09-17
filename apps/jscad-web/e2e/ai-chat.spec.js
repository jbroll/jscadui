// AI chat loop against a stubbed API: no provider key, no network beyond the
// page itself. The stub emits one tool_request (measure); the tool executes
// against the real local worker, and the spec asserts the posted result
// carries genuine measurements — the full agent loop, end to end.
import { test, expect } from '@playwright/test'
import http from 'node:http'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

const sse = (frames) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}`).join('\n\n') + '\n\n'

// A stub agent server speaking the real turn protocol with true streaming:
// one POST opens the turn, tool results arrive on sibling POSTs, and the same
// stream completes. The page's /api/chat requests are forwarded to it.
const startStubServer = () =>
  new Promise((resolve) => {
    let toolResult = null
    let notifyTool = null
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', async () => {
        if (req.url === '/api/chat/local' && req.method === 'POST') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
          const send = (event, data) => res.write(sse([[event, data]]))
          send('text', { text: 'Measuring. ' })
          send('tool_request', { callId: 'call-1', name: 'measure', input: {} })
          await new Promise((done) => {
            notifyTool = done
            setTimeout(done, 55000)
          })
          send('text', { text: 'Done.' })
          send('done', {})
          res.end()
        } else if (req.url?.startsWith('/api/chat/local/tool/')) {
          try {
            toolResult = JSON.parse(body)?.result ?? null
          } catch {
            toolResult = null
          }
          notifyTool?.()
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{}')
        } else {
          res.writeHead(404)
          res.end()
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, tool: () => toolResult }))
  })

test.describe('AI chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await assertNoError(page)
  })

  test('panel opens and runs a measure turn through the local worker', async ({ page }) => {
    await page.locator('#menu-button').click()
    await page.locator('#ai-chat-btn').click()
    await expect(page.locator('#ai-chat')).toBeVisible()

    // Account: model name typed, key saved in session custody.
    await page.locator('#ai-account input[placeholder="claude-sonnet-4-5"]').fill('stub-model')
    await page.locator('#ai-account input[placeholder="sk-..."]').fill('sk-test')
    await page.locator('#ai-account button', { hasText: 'Save key' }).click()
    await expect(page.locator('#ai-account')).toContainText('Key set.')

    const stub = await startStubServer()
    // Forward the page's API calls to the stub, preserving method and body.
    await page.route('**/api/chat/**', (route) => {
      const path = new URL(route.request().url()).pathname
      route.continue({ url: `http://127.0.0.1:${stub.port}${path}` })
    })

    await page.locator('.chat-input').fill('how big is it?')
    await page.locator('.chat-send').click()

    await expect.poll(() => stub.tool() !== null, { timeout: 60_000 }).toBe(true)
    expect(stub.tool().dimensions).toHaveLength(3)
    expect(stub.tool().volume).toBeGreaterThan(0)
    await expect(page.locator('.chat-messages')).toContainText('Done.', { timeout: 30_000 })
    stub.server.close()
  })
})
