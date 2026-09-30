// apps/jscad-web/scripts/local/server.test.js
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRelayHandler } from './relay.js'
import { startLocal } from './server.js'

describe('local server', () => {
  it('serves app, frame dir, /models and relay-origin rules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jscad-local-'))
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
      expect((await fetch(`${url}/models/cube.js`)).status).toBe(200)
      expect(await (await fetch(`${url}/models/cube.js`)).text()).toContain('module.exports')
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
    const root = mkdtempSync(join(tmpdir(), 'jscad-local-'))
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
      expect(await (await fetch(`${url}/models/lib/part.js`)).text()).toBe('part')
      const framed = await fetch(`${url}/api/fs/main.js`, { headers: { origin: frameUrl } })
      expect(framed.status).toBe(403)
      expect(framed.headers.get('access-control-allow-origin')).toBeNull()
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('sends CORS on missing and forbidden files so the frame sees the status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jscad-local-'))
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
        [`${url}/models/missing.scad`, 404],
        [`${url}/..%2Fsecret`, 403],
        [`${frameUrl}/missing.js`, 404],
      ]) {
        const res = await fetch(target)
        expect(res.status).toBe(status)
        expect(res.headers.get('access-control-allow-origin')).toBe('*')
      }
    } finally {
      appServer.close(); frameServer.close()
    }
  })

  it('answers 500 and keeps serving when a handler throws', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jscad-local-'))
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    const relayHandler = async () => { throw new TypeError('terminated') }
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'),
      relayHandler, port: 0,
    })
    try {
      expect((await fetch(`${url}/api/relay/x/y`, { method: 'POST' })).status).toBe(500)
      expect((await fetch(`${url}/models/missing.scad`)).status).toBe(404)
    } finally {
      appServer.close(); frameServer.close()
    }
  })
})
