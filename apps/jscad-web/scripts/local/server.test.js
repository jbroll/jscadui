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
})
