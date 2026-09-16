import { test, expect } from '@playwright/test'

const HOST = 'http://localhost:5122/host.html'
const WRONG = 'http://localhost:5121/wrong.html'

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

test('a wrong-origin sender is never answered', async ({ page }) => {
  await page.goto(WRONG)
  await page.evaluate((payload) => window.send(99, 'load', payload), SIBLING_PROJECT)
  await page.waitForTimeout(1500)
  const received = await page.evaluate(() => window.received)
  expect(received).toEqual([])
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