// An image attached in the chat reaches the provider as a chat-completions
// image_url part, through a stub relay that answers every turn with text.
import { test, expect } from '@playwright/test'
import http from 'node:http'
import { dismissWelcome, waitForRender, seedTos } from './helpers.js'

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const startStubRelay = () =>
  new Promise((resolve) => {
    const requests = []
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
      req.on('end', () => {
        if (req.method !== 'POST' || req.url !== '/api/relay/openai/v1/chat/completions') {
          res.writeHead(404, cors)
          res.end()
          return
        }
        requests.push(JSON.parse(body))
        res.writeHead(200, { ...cors, 'content-type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I see it.' } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
        res.end('data: [DONE]\n\n')
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests }))
  })

test('an attached image goes to a vision model and shows in the user bubble', async ({ page }) => {
  test.setTimeout(60_000)
  const stub = await startStubRelay()
  await page.addInitScript(({ port, tos }) => {
    window.localStorage.setItem('jscad-ai.relay', `http://127.0.0.1:${port}`)
    window.localStorage.setItem('jscad-ai.tos', tos)
    window.localStorage.setItem('jscad-ai.vision-overrides', JSON.stringify({ 'stub-model': true }))
  }, { port: stub.port, tos: seedTos() })
  await page.goto('/')
  await dismissWelcome(page)
  await waitForRender(page)

  await page.locator('#menu-button').click()
  await page.locator('#ai-chat-btn').click()
  await page.locator('.ai-gear').click()
  await page.locator('.ai-provider-select').selectOption('openai')
  await page.locator('.ai-model-input').fill('stub-model')
  await page.locator('.ai-model-input').dispatchEvent('change')
  await page.locator('.ai-field', { has: page.locator('.ai-field-name', { hasText: /^Keep$/ }) }).locator('select').selectOption('device')
  await page.locator('.ai-key-input').fill('sk-test')
  await page.locator('.ai-save-key').click()
  await expect(page.locator('.ai-settings')).toContainText('Key set (sk-test…).')
  await page.reload()
  await dismissWelcome(page)
  await waitForRender(page)
  await page.locator('#menu-button').click()
  await page.locator('#ai-chat-btn').click()

  await expect(page.locator('.chat-attach')).toBeEnabled()
  await page.locator('.chat-attach-input').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG_1X1 })
  await expect(page.locator('.chat-pending-item img')).toHaveCount(1)
  await page.locator('.chat-input').fill('like this')
  await page.locator('.chat-send').click()

  await expect(page.locator('.chat-msg.assistant')).toHaveText('I see it.')
  await expect(page.locator('.chat-pending-item')).toHaveCount(0)
  const user = stub.requests[0].messages.at(-1)
  expect(user.content[0]).toEqual({ type: 'text', text: 'like this' })
  expect(user.content[1].type).toBe('image_url')
  expect(user.content[1].image_url.url).toMatch(/^data:image\/png;base64,/)

  await page.locator('.chat-msg.user .chat-user-thumb').click()
  await expect(page.locator('.chat-view-overlay .chat-view-full')).toBeVisible()
  stub.server.close()
})
