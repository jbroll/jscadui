// apps/jscad-web/scripts/local/relay.test.js
import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { createRelayHandler } from './relay.js'

const withServers = async (t) => {
  const upstream = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(`echo:${req.url}:${b}`)
    })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const port = upstream.address().port
  const handler = createRelayHandler({
    allowlist: { test: `http://127.0.0.1:${port}` },
    trustedOrigins: ['http://app.test'],
    allowPrivateUpstream: true,
  })
  const front = http.createServer((req, res) => {
    handler(req, res).then((handled) => {
      if (!handled) { res.writeHead(404); res.end() }
    })
  })
  await new Promise((r) => front.listen(0, '127.0.0.1', r))
  try {
    await t(`http://127.0.0.1:${front.address().port}`)
  } finally {
    front.close(); upstream.close()
  }
}

describe('relay', () => {
  it('forwards a trusted origin to the upstream sub-path', async () => {
    await withServers(async (base) => {
      const res = await fetch(`${base}/api/relay/test/v1/chat`, {
        method: 'POST',
        headers: { origin: 'http://app.test', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'm' }),
      })
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('/v1/chat')
    })
  })
  it('403s an untrusted origin', async () => {
    await withServers(async (base) => {
      const res = await fetch(`${base}/api/relay/test/v1/chat`, {
        method: 'POST',
        headers: { origin: 'https://evil.test', 'content-type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(403)
    })
  })
  it('404s an unknown kind', async () => {
    await withServers(async (base) => {
      const res = await fetch(`${base}/api/relay/nope/v1/x`, {
        method: 'POST',
        headers: { origin: 'http://app.test', 'content-type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(404)
    })
  })
})
