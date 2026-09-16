import { test, expect } from '@playwright/test'

const HOST = 'http://localhost:5122/host.html'
const RUN = 'http://localhost:5121'
const MARKER = `${RUN}/__mark`

const project = (mainSource) => ({ files: { 'main.js': mainSource }, entry: 'main.js' })

const SIBLING_PROJECT = {
  files: {
    'main.js':
      `const { cube } = require('@jscad/modeling').primitives\n` +
      `const { part } = require('./part.js')\n` +
      `const main = () => [cube({ size: 10 }), part()]\n` +
      `module.exports = { main }\n`,
    'part.js':
      `const { cylinder } = require('@jscad/modeling').primitives\n` +
      `const part = () => cylinder({ radius: 3, height: 4 })\n` +
      `module.exports = { part }\n`,
  },
  entry: 'main.js',
}

// The model's only effect is a request to the run origin, which the test server
// counts, so a command that ran is observable even though its reply is dropped.
const MARKER_PROJECT = project(
  `const main = async () => { await fetch('${MARKER}'); return [] }\n` +
  `module.exports = { main }\n`,
)

test('load resolves a sibling require and returns geometry', async ({ page }) => {
  await page.goto(HOST)
  const res = await page.evaluate(({ id, command, payload }) => window.send(id, command, payload), {
    id: 1,
    command: 'load',
    payload: SIBLING_PROJECT,
  })
  expect(res.ok).toBe(true)
  expect(res.result.entities.length).toBe(2)
  const vertexCount = res.result.entities.reduce((n, e) => n + (e.vertices?.length ?? 0), 0)
  expect(vertexCount).toBeGreaterThan(0)
})

test('params re-runs the model and returns different geometry', async ({ page }) => {
  await page.goto(HOST)
  const model = project(
    `const { cube } = require('@jscad/modeling').primitives\n` +
    `const main = (params) => {\n` +
    `  params.size = { type: 'slider', default: 10, min: 1, max: 100 }\n` +
    `  return cube({ size: params.size })\n` +
    `}\n` +
    `module.exports = { main }\n`,
  )
  const loadRes = await page.evaluate(({ id, command, payload }) => window.send(id, command, payload), {
    id: 2,
    command: 'load',
    payload: model,
  })
  expect(loadRes.ok).toBe(true)
  const first = [...loadRes.result.entities[0].vertices]

  const paramsRes = await page.evaluate(({ id, command, payload }) => window.send(id, command, payload), {
    id: 3,
    command: 'params',
    payload: { values: { size: 20 } },
  })
  expect(paramsRes.ok).toBe(true)
  const second = [...paramsRes.result.entities[0].vertices]
  expect(second).not.toEqual(first)
})

test('a model error is answered as ok:false with the message', async ({ page }) => {
  await page.goto(HOST)
  const res = await page.evaluate(({ id, command, payload }) => window.send(id, command, payload), {
    id: 4,
    command: 'load',
    payload: project(
      `const main = () => { throw new Error('boom from model') }\n` +
      `module.exports = { main }\n`,
    ),
  })
  expect(res.ok).toBe(false)
  expect(res.error.message).toContain('boom from model')
})

test('a wrong-origin sender is never answered and cannot run a command', async ({ page, request }) => {
  await request.get(`${RUN}/__mark-reset`)
  await page.goto(HOST)
  await page.evaluate(() => window.frameReady)
  const attacker = page.frames().find((f) => f.url().includes(':5123'))
  await attacker.evaluate((payload) => window.send(99, 'load', payload), MARKER_PROJECT)
  await page.waitForTimeout(1500)
  expect(await attacker.evaluate(() => window.received)).toEqual([])

  const readCount = async () => (await (await request.get(`${RUN}/__mark-count`)).json()).count
  let count = await readCount()
  const deadline = Date.now() + 5000
  while (count === 0 && Date.now() < deadline) {
    await page.waitForTimeout(250)
    count = await readCount()
  }
  expect(count).toBe(0)
})

test('the frame document sends frame-ancestors for the app origin', async ({ request }) => {
  const res = await request.get(`${RUN}/`)
  expect(res.headers()['content-security-policy']).toContain('frame-ancestors http://localhost:5122')
})

test('model fetch against the app origin API fails', async ({ page }) => {
  await page.goto(HOST)
  const res = await page.evaluate(({ id, command, payload }) => window.send(id, command, payload), {
    id: 5,
    command: 'load',
    payload: project(
      `const main = async () => {\n` +
      `  await fetch('http://localhost:5122/api/private')\n` +
      `  return []\n` +
      `}\n` +
      `module.exports = { main }\n`,
    ),
  })
  expect(res.ok).toBe(false)
})

test('localStorage and IndexedDB throw inside the opaque frame', async ({ page }) => {
  await page.goto(HOST)
  const storageRes = await page.evaluate(({ id, command, payload }) => window.send(id, command, payload), {
    id: 6,
    command: 'load',
    payload: project(
      `const main = () => { localStorage.getItem('x'); return [] }\n` +
      `module.exports = { main }\n`,
    ),
  })
  expect(storageRes.ok).toBe(false)

  const idbRes = await page.evaluate(({ id, command, payload }) => window.send(id, command, payload), {
    id: 7,
    command: 'load',
    payload: project(
      `const main = () => { indexedDB.open('x'); return [] }\n` +
      `module.exports = { main }\n`,
    ),
  })
  expect(idbRes.ok).toBe(false)
})