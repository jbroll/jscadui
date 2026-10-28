// apps/jscad-web/scripts/local/server.test.js
import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../../test/tempDir.js'
import { createRelayHandler } from './relay.js'
import { startLocal } from './server.js'

describe('local server', () => {
  it('serves app, frame dir, /models and relay-origin rules', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    writeFileSync(join(root, 'index.html'), '<h1>app</h1>')
    writeFileSync(join(root, 'models', 'cube.js'), 'module.exports = {}')
    const relayHandler = createRelayHandler({ allowlist: {}, trustedOrigins: ['http://x'] })
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler, port: 0,
    })
    try {
      expect((await fetch(`${url}/index.html`)).status).toBe(200)
      expect((await fetch(`${url}/models/cube.js`, { headers: { origin: url } })).status).toBe(200)
      expect(await (await fetch(`${url}/models/cube.js`, { headers: { origin: url } })).text()).toContain('module.exports')
      expect((await fetch(`${url}/..%2Findex.html`)).status).toBe(403)
      const bad = await fetch(`${url}/api/relay/nope/v1/x`, {
        method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}',
      })
      expect(bad.status).toBe(403)
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('mounts the fs api for the app origin only, ahead of the static routes', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    mkdirSync(join(root, 'api', 'fs'), { recursive: true })
    writeFileSync(join(root, 'api', 'fs', 'main.js'), 'static copy')
    writeFileSync(join(root, 'models', 'main.js'), 'model')
    const relayHandler = createRelayHandler({ allowlist: {}, trustedOrigins: [] })
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler, port: 0,
    })
    const frameUrl = url.replace(/:(\d+)$/, (_, p) => `:${Number(p) + 1}`)
    try {
      const list = await fetch(`${url}/api/fs`, { headers: { origin: url } })
      expect(list.status).toBe(200)
      expect((await list.json()).files.map((f) => f.path)).toEqual(['main.js'])
      const file = await fetch(`${url}/api/fs/main.js`, { headers: { origin: url } })
      expect(await file.text()).toBe('model')
      const put = await fetch(`${url}/api/fs/lib/part.js`, { method: 'PUT', body: 'part', headers: { origin: url } })
      expect(put.status).toBe(204)
      expect(await (await fetch(`${url}/models/lib/part.js`, { headers: { origin: url } })).text()).toBe('part')
      const framed = await fetch(`${url}/api/fs/main.js`, { headers: { origin: frameUrl } })
      expect(framed.status).toBe(403)
      expect(framed.headers.get('access-control-allow-origin')).toBeNull()
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('sends CORS on missing and forbidden files so the frame sees the status', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    const relayHandler = createRelayHandler({ allowlist: {}, trustedOrigins: [] })
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler, port: 0,
    })
    const frameUrl = url.replace(/:(\d+)$/, (_, p) => `:${Number(p) + 1}`)
    try {
      for (const [target, status] of [
        [`${url}/..%2Fsecret`, 403],
        [`${frameUrl}/missing.js`, 404],
      ]) {
        const res = await fetch(target)
        expect(res.status).toBe(status)
        expect(res.headers.get('access-control-allow-origin')).toBe('*')
      }
      const models = await fetch(`${url}/models/missing.scad`, { headers: { origin: url } })
      expect(models.status).toBe(404)
      expect(models.headers.get('access-control-allow-origin')).toBeNull()
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('serves fonts, source maps and OpenSCAD files with their MIME types', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    writeFileSync(join(root, 'font.woff2'), 'w')
    writeFileSync(join(root, 'font.ttf'), 't')
    writeFileSync(join(root, 'bundle.js.map'), '{}')
    writeFileSync(join(root, 'models', 'part.scad'), 'cube(1);')
    const relayHandler = createRelayHandler({ allowlist: {}, trustedOrigins: [] })
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler, port: 0,
    })
    try {
      for (const [path, type] of [
        ['/font.woff2', 'font/woff2'],
        ['/font.ttf', 'font/ttf'],
        ['/bundle.js.map', 'application/json'],
        ['/models/part.scad', 'text/plain'],
      ]) {
        expect((await fetch(`${url}${path}`, { headers: { origin: url } })).headers.get('content-type')).toBe(type)
      }
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('answers 500 and keeps serving when a handler throws', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    const relayHandler = async () => { throw new TypeError('terminated') }
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler, port: 0,
    })
    try {
      expect((await fetch(`${url}/api/relay/x/y`, { method: 'POST' })).status).toBe(500)
      expect((await fetch(`${url}/models/missing.scad`, { headers: { origin: url } })).status).toBe(404)
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('routes /api/fetch to the fetch handler, ahead of the static routes', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    mkdirSync(join(root, 'api'), { recursive: true })
    writeFileSync(join(root, 'api', 'fetch'), 'static')
    const fetchHandler = async (req, res) => {
      if (req.method !== 'POST') return false
      res.writeHead(200); res.end('fetched')
      return true
    }
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler: createRelayHandler({ allowlist: {}, trustedOrigins: [] }),
      fetchHandler, port: 0,
    })
    try {
      expect(await (await fetch(`${url}/api/fetch`, { method: 'POST', body: '{}' })).text()).toBe('fetched')
      expect((await fetch(`${url}/api/fetch`)).status).toBe(404)
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('serves /models through a symlinked model directory root', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    const realModels = join(root, 'real-models')
    mkdirSync(realModels, { recursive: true })
    writeFileSync(join(realModels, 'cube.js'), 'module.exports = {}')
    const modelDir = join(root, 'models-link')
    symlinkSync(realModels, modelDir, 'dir')
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir,
      relayHandler: createRelayHandler({ allowlist: {}, trustedOrigins: [] }),
      port: 0,
    })
    try {
      expect((await fetch(`${url}/models/cube.js`, { headers: { origin: url } })).status).toBe(200)
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('refuses dotfiles and symlinks that leave the model directory', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models', '.git'), { recursive: true })
    writeFileSync(join(root, 'models', '.env'), 'SECRET=1')
    writeFileSync(join(root, 'models', '.git', 'config'), '[core]')
    writeFileSync(join(root, 'outside.txt'), 'out')
    symlinkSync(join(root, 'outside.txt'), join(root, 'models', 'link.txt'))
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler: createRelayHandler({ allowlist: {}, trustedOrigins: [] }),
      port: 0,
    })
    try {
      expect((await fetch(`${url}/models/.env`, { headers: { origin: url } })).status).toBe(404)
      expect((await fetch(`${url}/models/.git/config`, { headers: { origin: url } })).status).toBe(404)
      expect((await fetch(`${url}/models/link.txt`, { headers: { origin: url } })).status).toBe(404)
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('refuses foreign origins and unmarked requests to /models', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    writeFileSync(join(root, 'models', 'cube.js'), 'module.exports = {}')
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler: createRelayHandler({ allowlist: {}, trustedOrigins: [] }),
      port: 0,
    })
    const frameUrl = url.replace(/:(\d+)$/, (_, p) => `:${Number(p) + 1}`)
    try {
      for (const headers of [
        { origin: 'https://evil.test' },
        { origin: frameUrl },
        { 'sec-fetch-site': 'cross-site' },
        {},
      ]) {
        const res = await fetch(`${url}/models/cube.js`, { headers })
        expect(res.status, JSON.stringify(headers)).toBe(403)
        expect(await res.text()).toBe('untrusted origin')
        expect(res.headers.get('access-control-allow-origin')).toBeNull()
      }
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('refuses a rebound host on /models even when the request looks same-origin', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    writeFileSync(join(root, 'models', 'cube.js'), 'module.exports = {}')
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler: createRelayHandler({ allowlist: {}, trustedOrigins: [] }),
      port: 0,
    })
    const { port } = new URL(url)
    try {
      const status = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: '/models/cube.js', headers: { host: `evil.test:${port}`, 'sec-fetch-site': 'same-origin' } }, (res) => {
          res.resume()
          resolve(res.statusCode)
        }).on('error', reject)
      })
      expect(status).toBe(403)
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('serves the static branch cross-origin', async () => {
    const root = tempDir('jscad-local-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    writeFileSync(join(root, 'index.html'), '<h1>app</h1>')
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler: createRelayHandler({ allowlist: {}, trustedOrigins: [] }),
      port: 0,
    })
    try {
      const res = await fetch(`${url}/index.html`, { headers: { origin: 'https://evil.test' } })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    } finally {
      appServer.close(); frameServer.close()
    }
  })
})
