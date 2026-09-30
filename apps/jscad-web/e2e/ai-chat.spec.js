// A stub relay speaking the provider API the browser loop calls, under the
// real relay path /api/relay/openai. Each POST answers the next scripted
// round: a tool call, or the closing text. The page points at it via
// localStorage jscad-ai.relay, so no /api/chat server exists.
import { test, expect } from '@playwright/test'
import http from 'node:http'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

const chunk = (json) => `data: ${JSON.stringify(json)}\n\n`

const CUBE = `const { cube } = require('@jscad/modeling').primitives\nconst main = () => cube({ size: 10 })\nmodule.exports = { main }\n`

// One tool call per round, then 'Done.' for every request after the script runs out.
const ROUNDS = [
  { name: 'write', args: { path: 'main.js', content: CUBE } },
  { name: 'measure', args: {} },
  { name: 'edit', args: { path: 'main.js', oldString: 'cube({ size: 10 })', newString: 'cube({ size: 10 )' } },
  { name: 'measure', args: {} },
  { name: 'edit', args: { path: 'main.js', oldString: 'cube({ size: 10 )', newString: 'cube({ size: 20 })' } },
  { name: 'run', args: { source: "console.log('scratch', 6 * 7)" } },
]

const startStubRelay = () =>
  new Promise((resolve) => {
    const requests = []
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization, x-jscad-chat-id',
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
        if (req.url !== '/api/relay/openai/v1/chat/completions' || req.method !== 'POST') {
          res.writeHead(404)
          res.end()
          return
        }
        requests.push(JSON.parse(body))
        res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const round = ROUNDS[requests.length - 1]
        if (round) {
          const call = { index: 0, id: `call-${requests.length}`, function: { name: round.name, arguments: JSON.stringify(round.args) } }
          res.write(chunk({ choices: [{ delta: { tool_calls: [call] } }] }))
          res.write(chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
        } else {
          res.write(chunk({ choices: [{ delta: { content: 'Done.' } }] }))
          res.write(chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
        }
        res.write('data: [DONE]\n\n')
        res.end()
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

  test('writes, edits, builds and runs the project through the relay stub', async ({ page }) => {
    test.setTimeout(90_000)
    await page.locator('#menu-button').click()
    await page.locator('#ai-chat-btn').click()
    await expect(page.locator('#ai-chat')).toBeVisible()
    await expect(page.locator('#menu')).not.toHaveClass(/open/)

    await page.locator('.ai-gear').click()
    await page.locator('.ai-provider-select').selectOption('openai')
    await page.locator('.ai-model-input').fill('stub-model')
    await page.locator('.ai-model-input').dispatchEvent('change')
    await page.getByLabel('Keep').selectOption('device')
    await page.locator('.ai-key-input').fill('sk-test')
    await page.locator('.ai-save-key').click()
    await expect(page.locator('.ai-settings')).toContainText('Key set.')

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

    await expect(page.locator('.chat-messages')).toContainText('Done.', { timeout: 60_000 })
    expect(stub.requests.length).toBe(ROUNDS.length + 1)
    expect(stub.requests[0].model).toBe('stub-model')
    const offered = stub.requests[0].tools.map((t) => t.function.name)
    expect(offered).toEqual(expect.arrayContaining(['list', 'read', 'write', 'edit', 'run', 'measure', 'check']))
    expect(offered).not.toContain('eval')

    const results = stub.requests.at(-1).messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content))
    const [written, measured, broken, refused, fixed, ran] = results
    expect(written).toMatchObject({ ok: true, entry: 'main.js', geometry: { dimensions: [10, 10, 10] } })
    expect(measured.dimensions).toEqual([10, 10, 10])
    expect(broken).toMatchObject({ ok: false, entry: 'main.js', error: { name: 'SyntaxError', file: 'main.js', line: 2 } })
    expect(refused).toMatchObject({ ok: false, error: { name: 'NoGeometryError' } })
    expect(refused.error.message).toMatch(/the last build failed/)
    expect(fixed).toMatchObject({ ok: true, geometry: { dimensions: [20, 20, 20] } })
    expect(ran).toMatchObject({ ok: true, console: ['scratch 42'] })

    await expect(page.locator('.cm-content')).toContainText('cube({ size: 20 })')
    await assertNoError(page)

    // The next turn starts from the last build of the project.
    await page.locator('.chat-input').fill('make it bigger')
    await page.locator('.chat-send').click()
    await expect.poll(() => stub.requests.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(ROUNDS.length + 2)
    const followUp = stub.requests.at(-1)
    const header = followUp.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    expect(header).toContain('Last build of the project')
    expect(header).toContain('"dimensions":[20,20,20]')

    stub.server.close()
  })

  test('a failed build keeps the last render on screen and shows the error', async ({ page }) => {
    // The middle of the viewer, clear of the params and stats panels a load rebuilds.
    const box = await page.locator('#viewer canvas').boundingBox()
    const clip = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3, width: box.width * 0.4, height: box.height * 0.4 }
    const before = await page.screenshot({ clip })
    await page.evaluate(() => {
      const view = document.querySelector('.cm-content').cmView.rootView.view
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'module.exports = { main: () => { throw new Error("broken") } }' } })
    })
    await page.locator('.cm-content').press('Shift+Enter')
    await expect(page.locator('#error-bar')).toBeVisible()
    await expect(page.locator('#error-bar')).toContainText('broken')
    await page.locator('#error-bar').evaluate((bar) => { bar.style.visibility = 'hidden' })
    const after = await page.screenshot({ clip })
    expect(after.equals(before)).toBe(true)
  })
})
