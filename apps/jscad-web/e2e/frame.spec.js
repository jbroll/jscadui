import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { startServers, stopServers } from './frame-serve.mjs'
import { PROJECT_BASE } from '../src_frame/fileMap.js'

// The frame under test is served by the real dev frame server on its own
// origin (http://localhost:5121, whose baked allowed sender is the app
// origin's http://localhost:5120). The host page is injected with setContent
// after navigating to a same-origin lightweight URL, so no fixture ships in
// the production build.
const RUN = 'http://localhost:5121'
const MARK = 'http://localhost:5122'
const MARKER = `${MARK}/__mark`

test.beforeAll(async () => {
  await startServers()
})

test.afterAll(async () => {
  await stopServers()
})

const gotoHost = async (page) => {
  await page.goto('http://localhost:5120/robots.txt')
  await page.setContent(readFileSync(new URL('./frame-host.html', import.meta.url), 'utf8'))
}

const send = (page, method, params) =>
  page.evaluate(({ method, params }) => window.send(method, params), { method, params })

// The app's side of the relayed protocol: name the engine, hand over the file
// map, run the entry. The frame fills in the bundles itself.
const init = (page, options = {}) => send(page, 'jscadInit', { useParamsProxy: true, ...options })

const load = async (page, { files, entry }, options = {}) => {
  const inited = await init(page, options)
  if (!inited.ok) return inited
  const set = await send(page, 'jscadSetFiles', { files })
  if (!set.ok) return set
  return send(page, 'jscadScript', {
    script: files[entry],
    url: PROJECT_BASE + entry,
    base: PROJECT_BASE,
    root: PROJECT_BASE,
  })
}

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

const CUBE = project(
  `const { cube } = require('@jscad/modeling').primitives\n` +
  `const main = () => cube({ size: 10 })\n` +
  `module.exports = { main }\n`,
)

test('a script resolves a sibling require and returns geometry', async ({ page }) => {
  await gotoHost(page)
  const res = await load(page, SIBLING_PROJECT)
  expect(res.ok).toBe(true)
  expect(res.result.entities.length).toBe(2)
  const vertexCount = res.result.entities.reduce((n, e) => n + (e.vertices?.length ?? 0), 0)
  expect(vertexCount).toBeGreaterThan(0)
})

test('jscadMain re-runs the model and returns different geometry', async ({ page }) => {
  await gotoHost(page)
  const loadRes = await load(page, project(
    `const { cube } = require('@jscad/modeling').primitives\n` +
    `const main = (params) => {\n` +
    `  params.size = { type: 'slider', default: 10, min: 1, max: 100 }\n` +
    `  return cube({ size: params.size })\n` +
    `}\n` +
    `module.exports = { main }\n`,
  ))
  expect(loadRes.ok).toBe(true)
  const first = [...loadRes.result.entities[0].vertices]

  const mainRes = await send(page, 'jscadMain', { params: { size: 20 }, userInteractedPaths: ['size'] })
  expect(mainRes.ok).toBe(true)
  const second = [...mainRes.result.entities[0].vertices]
  expect(second).not.toEqual(first)
})

test('a model error comes back as an error response', async ({ page }) => {
  await gotoHost(page)
  const res = await load(page, project(
    `const main = () => { throw new Error('boom from model') }\n` +
    `module.exports = { main }\n`,
  ))
  expect(res.ok).toBe(false)
  expect(res.error.message).toContain('boom from model')
})

test('the frame names its own bundles and ignores the sender', async ({ page }) => {
  const hostile = []
  page.on('request', (req) => { if (req.url().startsWith(MARK)) hostile.push(req.url()) })
  await gotoHost(page)
  const res = await load(page, CUBE, {
    bundles: { '@jscad/modeling': `${MARK}/evil.js` },
  })
  expect(res.ok).toBe(true)
  expect(res.result.entities.length).toBe(1)
  // Building is not the point: the sender's bundle URL must never be fetched.
  expect(hostile).toEqual([])
})

test('a wrong-origin sender is never answered and cannot run a script', async ({ page, request }) => {
  await request.get(`${MARK}/__mark-reset`)
  await gotoHost(page)
  await init(page)
  const attacker = page.frames().find((f) => f.url().includes(':5123'))
  await attacker.evaluate(({ files, entry, base }) => {
    window.send('jscadSetFiles', { files })
    window.send('jscadScript', { script: files[entry], url: base + entry, base, root: base })
  }, { ...MARKER_PROJECT, base: PROJECT_BASE })
  await page.waitForTimeout(1500)
  expect(await attacker.evaluate(() => window.received)).toEqual([])

  const readCount = async () => (await (await request.get(`${MARK}/__mark-count`)).json()).count
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
  expect(res.headers()['content-security-policy']).toContain('frame-ancestors http://localhost:5120')
})

// A model loaded from a real URL resolves its siblings over the network from
// inside the frame, so reachability is no longer the guarantee. What holds is
// that the request carries nothing of the user's. The cookie is set on the
// target origin and asked for explicitly, so an unsandboxed worker on the app
// origin would send it: localhost is one site, and only the frame's opaque
// origin makes the request cross-site.
test('a model fetch carries no cookies and a null origin', async ({ page, context, request }) => {
  await context.addCookies([{ name: 'session', value: 'secret', url: `${MARK}/` }])
  await gotoHost(page)
  const res = await load(page, project(
    // The response is unreadable — credentials against a wildcard ACAO — so
    // the model only has to make the request; the server records what arrived.
    `const main = async () => {\n` +
    `  try { await fetch('${MARK}/__whoami', { credentials: 'include' }) } catch {}\n` +
    `  return []\n` +
    `}\n` +
    `module.exports = { main }\n`,
  ))
  expect(res.ok).toBe(true)

  const seen = await (await request.get(`${MARK}/__whoami-last`)).json()
  expect(seen).not.toBeNull()
  expect(seen.cookie).toBeNull()
  expect(seen.origin).toBe('null')
})

// The examples live on the app origin, so the editor's models must be able to
// read them from the frame.
test('model fetch against the app origin is allowed', async ({ page }) => {
  await gotoHost(page)
  const res = await load(page, project(
    `const main = async () => {\n` +
    `  const r = await fetch('http://localhost:5120/robots.txt')\n` +
    `  if (!r.ok) throw new Error('app fetch failed: ' + r.status)\n` +
    `  return []\n` +
    `}\n` +
    `module.exports = { main }\n`,
  ))
  expect(res.ok).toBe(true)
})

// Reachability is now gated by CORS rather than by connect-src, so a response
// that does not opt in stays unreadable. An over-broad vhost header would
// regress this silently.
test('a response without Access-Control-Allow-Origin is unreadable', async ({ page }) => {
  await gotoHost(page)
  const res = await load(page, project(
    `const main = async () => {\n` +
    `  const r = await fetch('${MARK}/__no-cors')\n` +
    `  return [await r.json()]\n` +
    `}\n` +
    `module.exports = { main }\n`,
  ))
  expect(res.ok).toBe(false)
})

test('model fetch against the run origin is allowed', async ({ page }) => {
  await gotoHost(page)
  const res = await load(page, project(
    `const main = async () => {\n` +
    `  const r = await fetch('${RUN}/index.html')\n` +
    `  if (!r.ok) throw new Error('frame fetch failed: ' + r.status)\n` +
    `  return []\n` +
    `}\n` +
    `module.exports = { main }\n`,
  ))
  expect(res.ok).toBe(true)
})

test('localStorage and IndexedDB throw inside the opaque frame', async ({ page }) => {
  await gotoHost(page)
  const storageRes = await load(page, project(
    `const main = () => { localStorage.getItem('x'); return [] }\n` +
    `module.exports = { main }\n`,
  ))
  expect(storageRes.ok).toBe(false)

  const idbRes = await load(page, project(
    `const main = () => { indexedDB.open('x'); return [] }\n` +
    `module.exports = { main }\n`,
  ))
  expect(idbRes.ok).toBe(false)
})

test('jscadMeasure returns the model measurements', async ({ page }) => {
  await gotoHost(page)
  expect((await load(page, CUBE)).ok).toBe(true)

  const res = await send(page, 'jscadMeasure', { options: {} })
  expect(res.ok).toBe(true)
  expect(res.result.dimensions).toEqual([10, 10, 10])
  expect(res.result.volume).toBeCloseTo(1000, 3)
})

test('jscadCheck reports solidity and bed fit', async ({ page }) => {
  await gotoHost(page)
  expect((await load(page, CUBE)).ok).toBe(true)

  const res = await send(page, 'jscadCheck', { bed: [100, 100, 100], options: {} })
  expect(res.ok).toBe(true)
  expect(res.result.watertight).toBe(true)
  expect(res.result.manifold).toBe(true)
  expect(res.result.fitsBed).toBe(true)
})

test('jscadExportData returns binary STL as ArrayBuffers', async ({ page }) => {
  await gotoHost(page)
  expect((await load(page, CUBE)).ok).toBe(true)

  // Inspect inside the page: an ArrayBuffer arrives back as a Buffer in Node,
  // so the instanceof check must run on the browser side of the boundary.
  const res = await page.evaluate(() =>
    window.send('jscadExportData', { format: 'stlb' }).then((r) => ({
      ok: r.ok,
      error: r.error,
      dataIsArray: Array.isArray(r.result?.data),
      allBuffers: (r.result?.data ?? []).every((v) => v instanceof ArrayBuffer),
      bytes: (r.result?.data ?? []).reduce((n, v) => n + v.byteLength, 0),
    })),
  )
  expect(res.ok).toBe(true)
  expect(res.dataIsArray).toBe(true)
  expect(res.allBuffers).toBe(true)
  expect(res.bytes).toBeGreaterThan(0)
})

test('a request over the timeout kills the worker and the next load starts fresh', async ({ page }) => {
  await gotoHost(page)
  // Warm the worker before shortening the budget: the timeout covers a whole
  // request, and a cold blob worker spends more than 500 ms on its bundles.
  expect((await load(page, CUBE)).ok).toBe(true)
  const inited = await init(page, { timeoutMs: 500 })
  expect(inited.ok).toBe(true)

  const hang = project(
    `const main = () => { while (true) {} }\n` +
    `module.exports = { main }\n`,
  )
  // The killed worker cannot answer, so the frame answers for it.
  await page.evaluate(({ files, entry, base }) => {
    window.hung = window.send('jscadScript', { script: files[entry], url: base + entry, base, root: base })
  }, { ...hang, base: PROJECT_BASE })

  const hung = await page.evaluate(() => window.hung)
  expect(hung.ok).toBe(false)
  expect(hung.error.name).toBe('TimeoutError')

  await page.waitForFunction(() => !!window.seen('frameWorkerTerminated'), null, { timeout: 10000 })
  const notice = await page.evaluate(() => window.seen('frameWorkerTerminated'))
  expect(notice.params[0].reason).toContain('500')

  // The replacement worker is cold again, so it needs a real budget.
  const res = await load(page, CUBE, { timeoutMs: 30000 })
  expect(res.ok).toBe(true)
  expect(res.result.entities.length).toBe(1)
})

// The manifold bundle resolves ./manifold.wasm against the bundle base, which
// in the frame's blob worker is __BUNDLE_BASE__ rather than an opaque blob: URL.
test('a manifold model loads its wasm and returns geometry', async ({ page }) => {
  const wasm = []
  page.on('request', (req) => { if (req.url().endsWith('manifold.wasm')) wasm.push(req.url()) })
  await gotoHost(page)
  const res = await load(page, project(
    `const { cube, sphere } = require('@jscad/modeling').primitives\n` +
    `const { subtract } = require('@jscad/modeling').booleans\n` +
    `const main = () => subtract(cube({ size: 10 }), sphere({ radius: 6 }))\n` +
    `module.exports = { main }\n`,
  ), { engine: 'manifold', timeoutMs: 60000 })
  expect(res.ok).toBe(true)
  expect(wasm).toEqual([`${RUN}/assets/manifold.wasm`])
  const vertexCount = res.result.entities.reduce((n, e) => n + (e.vertices?.length ?? 0), 0)
  expect(vertexCount).toBeGreaterThan(0)
})

// One triangle is enough to prove the .stl arrived intact and deserialized:
// the loader now hands the deserializer an ArrayBuffer from the file map
// rather than the binary string readFileWeb used to return.
const binaryStl = () => {
  const bytes = new Uint8Array(84 + 50)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, 1, true)
  const floats = [0, 0, 1, 0, 0, 0, 10, 0, 0, 0, 10, 0]
  floats.forEach((v, i) => view.setFloat32(84 + i * 4, v, true))
  return [...bytes]
}

test('a project require of a .stl deserializes inside the frame', async ({ page }) => {
  await gotoHost(page)
  const inited = await init(page)
  expect(inited.ok).toBe(true)

  const entry =
    `const { part } = require('./part.stl')\n` +
    `const main = () => part ?? require('./part.stl')\n` +
    `module.exports = { main }\n`
  const set = await page.evaluate(({ entry, bytes }) =>
    window.send('jscadSetFiles', {
      files: { 'main.js': entry, 'part.stl': new Uint8Array(bytes).buffer },
    }), { entry, bytes: binaryStl() })
  expect(set.ok).toBe(true)

  const res = await send(page, 'jscadScript', {
    script: entry,
    url: PROJECT_BASE + 'main.js',
    base: PROJECT_BASE,
    root: PROJECT_BASE,
  })
  expect(res.ok).toBe(true)
  const vertexCount = res.result.entities.reduce((n, e) => n + (e.vertices?.length ?? 0), 0)
  expect(vertexCount).toBeGreaterThan(0)
})

// The transpiler reports each resolved file's own path as fromFile, so an
// include from a file two directories deep has to resolve against that file
// rather than against the entry.
test('a nested include resolves against the file that asked for it', async ({ page }) => {
  await gotoHost(page)
  const res = await load(page, {
    entry: 'main.scad',
    files: {
      'main.scad': 'include <lib/outer.scad>\nouter();\n',
      'lib/outer.scad': 'include <deep/inner.scad>\nmodule outer() { inner(); }\n',
      'lib/deep/inner.scad': 'module inner() { cube([4, 4, 4]); }\n',
    },
  }, { timeoutMs: 60000 })
  expect(res.ok).toBe(true)
  const vertexCount = res.result.entities.reduce((n, e) => n + (e.vertices?.length ?? 0), 0)
  expect(vertexCount).toBeGreaterThan(0)
})
