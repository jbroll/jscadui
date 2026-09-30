// apps/jscad-web/scripts/local/relay.test.js
import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { createRelayHandler } from './relay.js'

const echo = (req, res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`echo:${req.url}:${b}`)
  })
}

const withServers = async (t, options = {}, answer = echo) => {
  const seen = []
  const outcomes = []
  const upstream = http.createServer((req, res) => {
    seen.push(req.headers)
    answer(req, res)
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const port = upstream.address().port
  const handler = createRelayHandler({
    allowlist: { test: `http://127.0.0.1:${port}` },
    trustedOrigins: ['http://app.test'],
    allowPrivateUpstream: true,
    ...options,
  })
  const front = http.createServer((req, res) => {
    const outcome = handler(req, res).then((handled) => {
      if (!handled) { res.writeHead(404); res.end() }
      return 'resolved'
    }, (err) => `rejected: ${err}`)
    outcomes.push(outcome)
  })
  await new Promise((r) => front.listen(0, '127.0.0.1', r))
  try {
    await t(`http://127.0.0.1:${front.address().port}`, seen, outcomes)
  } finally {
    front.closeAllConnections(); upstream.closeAllConnections()
    front.close(); upstream.close()
  }
}

const post = (base, headers, init = {}) =>
  fetch(`${base}/api/relay/test/v1/chat/completions`, {
    method: 'POST',
    headers: { origin: 'http://app.test', 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'eval' }] }),
    ...init,
  })

describe('relay streaming failures', () => {
  it('settles and logs the failure when the upstream dies mid-stream', async () => {
    const records = []
    await withServers(async (base, _seen, outcomes) => {
      const res = await post(base, {})
      expect(res.status).toBe(200)
      await res.text().catch(() => {})
      expect(await outcomes[0]).toBe('resolved')
    }, { log: { write: (r) => records.push(r) } }, (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: partial\n\n')
      setTimeout(() => req.socket.destroy(), 20)
    })
    expect(records).toHaveLength(1)
    expect(records[0].status).toBe(200)
    expect(records[0].response).toContain('data: partial')
    expect(records[0].error).toMatch(/upstream stream failed/)
  })

  it('aborts the upstream request when the client goes away', async () => {
    let upstreamClosed
    const closed = new Promise((r) => { upstreamClosed = r })
    await withServers(async (base, _seen, outcomes) => {
      const controller = new AbortController()
      const res = await post(base, {}, { signal: controller.signal })
      const reader = res.body.getReader()
      await reader.read()
      controller.abort()
      await expect(Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream never closed')), 2000))])).resolves.toBe('closed')
      expect(await outcomes[0]).toBe('resolved')
    }, {}, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: first\n\n')
      res.on('close', () => upstreamClosed('closed'))
    })
  })
})

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
  it('forwards a GET such as the model list', async () => {
    await withServers(async (base) => {
      const res = await fetch(`${base}/api/relay/test/v1/models`, { headers: { origin: 'http://app.test' } })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('echo:/v1/models:')
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

describe('relay log', () => {
  it('logs a POST with its chat id and response, without tools or headers, and does not forward the id', async () => {
    const records = []
    await withServers(async (base, seen) => {
      const res = await post(base, { authorization: 'Bearer sk-secret', 'x-jscad-chat-id': 'chat-1' })
      expect(await res.text()).toContain('echo:/v1/chat/completions:')
      expect(seen[0]['x-jscad-chat-id']).toBeUndefined()
    }, { log: { write: (r) => records.push(r) } })
    expect(records).toHaveLength(1)
    const [r] = records
    expect(r).toMatchObject({
      chatId: 'chat-1',
      kind: 'test',
      path: 'v1/chat/completions',
      status: 200,
      request: { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(r.request).not.toHaveProperty('tools')
    expect(r.response).toContain('echo:/v1/chat/completions:')
    expect(Number.isNaN(Date.parse(r.ts))).toBe(false)
    expect(r.ms).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(r)).not.toContain('sk-secret')
    expect(Object.keys(r).sort()).toEqual(['chatId', 'kind', 'ms', 'path', 'request', 'response', 'status', 'ts'])
  })

  it('records a null chatId when the header is missing', async () => {
    const records = []
    await withServers(async (base) => {
      await (await post(base, {})).text()
    }, { log: { write: (r) => records.push(r) } })
    expect(records[0].chatId).toBeNull()
  })

  it('does not log a GET', async () => {
    const records = []
    await withServers(async (base) => {
      await (await fetch(`${base}/api/relay/test/v1/models`, { headers: { origin: 'http://app.test' } })).text()
    }, { log: { write: (r) => records.push(r) } })
    expect(records).toEqual([])
  })
})
