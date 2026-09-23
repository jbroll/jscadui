import express from 'express'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountRelayRoutes } from '../src/relay/routes.js'

const dir = join(tmpdir(), `relay-routes-${process.pid}`)
mkdirSync(dir, { recursive: true })
const allowlistPath = join(dir, 'providers.json')
writeFileSync(allowlistPath, JSON.stringify({ openai: 'https://upstream.test' }))

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const relayApp = (logs: unknown[]) => {
  const app = express()
  mountRelayRoutes(app, {
    allowlistPath,
    trustedOrigins: ['https://app.test'],
    logger: (entry) => logs.push(entry),
    fetchFn: fetchMock,
    dnsLookup: async () => [{ address: '93.184.216.34' }],
  })
  return app
}

const sseResponse = (text: string) =>
  ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new Response(text).body }) as unknown as Response

describe('relay routes', () => {
  it('answers preflight for a trusted origin', async () => {
    const res = await request(relayApp([])).options('/api/relay/openai/v1/chat/completions').set('Origin', 'https://app.test')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('https://app.test')
  })

  it('refuses an untrusted origin with 403', async () => {
    const res = await request(relayApp([])).post('/api/relay/openai/v1/chat/completions').set('Origin', 'https://evil.test').send({ model: 'm' })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown kind', async () => {
    const res = await request(relayApp([])).post('/api/relay/other/v1/x').set('Origin', 'https://app.test').send({})
    expect(res.status).toBe(404)
  })

  it('forwards method, body, and auth header and streams bytes back with CORS', async () => {
    // Fresh body per call: response streams are single-use.
    fetchMock.mockImplementation(async () => sseResponse('data: {"a":1}\n\n'))
    const logs: unknown[] = []
    const res = await request(relayApp(logs))
      .post('/api/relay/openai/v1/chat/completions')
      .set('Origin', 'https://app.test')
      .set('Authorization', 'Bearer sk-secret')
      .send({ model: 'm' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upstream.test/v1/chat/completions',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer sk-secret' }) }),
    )
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('https://app.test')
    expect(res.text).toContain('data: {"a":1}')
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs[0])).not.toMatch(/sk-secret|model/)
  })

  it('forwards only provider headers, never cookies or client identity', async () => {
    fetchMock.mockImplementation(async () => sseResponse('data: ok\n\n'))
    await request(relayApp([]))
      .post('/api/relay/openai/v1/messages')
      .set('Origin', 'https://app.test')
      .set('Cookie', 'better-auth.session_token=secret')
      .set('Referer', 'https://app.test/project/1')
      .set('X-Forwarded-For', '203.0.113.9')
      .set('User-Agent', 'browser')
      .set('x-api-key', 'sk-ant')
      .set('anthropic-version', '2023-06-01')
      .set('x-opencode-session', 'sess-1')
      .set('Accept', 'text/event-stream')
      .send({ model: 'm' })
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers).toEqual({
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-api-key': 'sk-ant',
      'anthropic-version': '2023-06-01',
      'x-opencode-session': 'sess-1',
    })
  })

  it('refuses an upstream that resolves to a private address', async () => {
    const app = express()
    const logs: unknown[] = []
    mountRelayRoutes(app, {
      allowlistPath,
      trustedOrigins: ['https://app.test'],
      logger: (entry) => logs.push(entry),
      fetchFn: fetchMock,
      dnsLookup: async () => [{ address: '10.0.0.5' }],
    })
    const res = await request(app).post('/api/relay/openai/v1/x').set('Origin', 'https://app.test').send({})
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rate-limits a hot IP with 429 and Retry-After', async () => {
    const logs: unknown[] = []
    fetchMock.mockImplementation(async () => sseResponse('data: ok\n\n'))
    // One app, one limiter: 61 rapid turns against a burst-10 bucket.
    const app = relayApp(logs)
    let last = 0
    let retryAfter = ''
    for (let i = 0; i < 61; i++) {
      const r = await request(app).post('/api/relay/openai/v1/x').set('Origin', 'https://app.test').send({})
      last = r.status
      retryAfter = r.headers['retry-after'] ?? retryAfter
    }
    expect(last).toBe(429)
    expect(retryAfter).not.toBe('')
  })
})
