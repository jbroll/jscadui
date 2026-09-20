// A stub relay speaking the provider API the browser loop calls, under the
// real relay path /api/relay/openai: first POST streams one eval tool call
// (agent-authored source for a 10mm cube), second POST streams one measure
// call against the frame session the eval seeded, third POST answers Done.
// The agent session is self-contained: measure operates on what eval loaded,
// never on the editor model. The page points at it via localStorage
// jscad-ai.relay, so no /api/chat server exists.
import { test, expect } from '@playwright/test'
import http from 'node:http'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

const chunk = (json) => `data: ${JSON.stringify(json)}\n\n`

const startStubRelay = () =>
  new Promise((resolve) => {
    const requests = []
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'POST, OPTIONS',
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
        if (req.url === '/api/relay/openai/v1/chat/completions' && req.method === 'POST') {
          const parsed = JSON.parse(body)
          requests.push(parsed)
          res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
          if (requests.length === 1) {
            res.write(chunk({ choices: [{ delta: { content: 'Modeling. ' } }] }))
            res.write(
              chunk({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call-1',
                          function: {
                            name: 'eval',
                            arguments: JSON.stringify({
                              source:
                                `const { cube } = require('@jscad/modeling').primitives\n` +
                                `const main = () => cube({ size: 10 })\n` +
                                `module.exports = { main }\n`,
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
            )
            res.write(chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
            res.write('data: [DONE]\n\n')
            res.end()
          } else if (requests.length === 2) {
            res.write(chunk({ choices: [{ delta: { content: 'Measuring. ' } }] }))
            res.write(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-2', function: { name: 'measure', arguments: '' } }] } }] }))
            res.write(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] }))
            res.write(chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
            res.write('data: [DONE]\n\n')
            res.end()
          } else {
            res.write(chunk({ choices: [{ delta: { content: 'Done.' } }] }))
            res.write(chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
            res.write('data: [DONE]\n\n')
            res.end()
          }
        } else {
          res.writeHead(404)
          res.end()
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests }))
  })

test.describe('AI chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await assertNoError(page)
  })

  test('panel opens and runs an eval-then-measure turn through the relay stub', async ({ page }) => {
    await page.locator('#menu-button').click()
    await page.locator('#ai-chat-btn').click()
    await expect(page.locator('#ai-chat')).toBeVisible()

    await page.locator('#ai-account input[placeholder="claude-sonnet-4-5"]').fill('stub-model')
    await page.locator('#ai-account select').first().selectOption('openai')
    await page.locator('#ai-account select').nth(1).selectOption('device')
    await page.locator('#ai-account input[placeholder="sk-..."]').fill('sk-test')
    await page.locator('#ai-account button', { hasText: 'Save key' }).click()
    await expect(page.locator('#ai-account')).toContainText('Key set.')

    const stub = await startStubRelay()
    await page.addInitScript((port) => {
      window.localStorage.setItem('jscad-ai.relay', `http://127.0.0.1:${port}`)
    }, stub.port)
    await page.reload()
    await dismissWelcome(page)
    await waitForRender(page)

    await page.locator('#menu-button').click()
    await page.locator('#ai-chat-btn').click()
    await page.locator('.chat-input').fill('model a 10mm cube and measure it')
    await page.locator('.chat-send').click()

    await expect(page.locator('.chat-messages')).toContainText('Done.', { timeout: 30_000 })
    expect(stub.requests.length).toBeGreaterThanOrEqual(3)
    expect(stub.requests[0].model).toBe('stub-model')
    expect(stub.requests[0].tools.map((t) => t.function.name)).toContain('eval')
    expect(stub.requests[1].tools.map((t) => t.function.name)).toContain('measure')
    const toolContents = stub.requests
      .flatMap((r) => r.messages ?? [])
      .filter((m) => m.role === 'tool')
      .map((m) => JSON.parse(m.content))
    expect(toolContents.find((r) => r.entityCount === 1)).toBeTruthy()
    const measured = toolContents.find((r) => r.dimensions)
    expect(measured.dimensions).toHaveLength(3)
    expect(measured.volume).toBeGreaterThan(0)
    stub.server.close()
  })
})
