import express from 'express'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { mountSearchRoutes } from '../src/search/routes.js'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const searchApp = (logs: unknown[], tavilyKey: string | undefined = 'server-tavily-key') => {
  const app = express()
  app.use(express.json())
  mountSearchRoutes(app, {
    tavilyKey,
    trustedOrigins: ['https://app.test'],
    logger: (entry) => logs.push(entry),
    fetchFn: fetchMock,
  })
  return app
}

const tavilyOk = (results: unknown[]) =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ result: { results } }),
  }) as unknown as Response

describe('search routes', () => {
  it('refuses an untrusted origin with 403 before touching Tavily', async () => {
    const res = await request(searchApp([])).post('/api/search').set('Origin', 'https://evil.test').send({ query: 'x' })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing query with 400', async () => {
    const res = await request(searchApp([])).post('/api/search').set('Origin', 'https://app.test').send({})
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when no server key is configured', async () => {
    const res = await request(searchApp([], '')).post('/api/search').set('Origin', 'https://app.test').send({ query: 'x' })
    expect(res.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards the query to Tavily MCP and answers tagged results without echoing the key', async () => {
    fetchMock.mockImplementation(async () => tavilyOk([{ title: 't', url: 'https://example.com', snippet: 's' }]))
    const logs: unknown[] = []
    const res = await request(searchApp(logs)).post('/api/search').set('Origin', 'https://app.test').send({ query: 'bearing 608' })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://mcp.tavily.com/mcp/')
    expect(url).toContain('server-tavily-key')
    expect(JSON.parse(String(init.body)).params.name).toBe('tavily-search')
    expect(res.body).toEqual({ ok: true, results: [{ title: 't', url: 'https://example.com', snippet: 's', provider: 'tavily' }] })
    expect(JSON.stringify(logs)).not.toContain('server-tavily-key')
    expect(JSON.stringify(res.body)).not.toContain('server-tavily-key')
  })

  it('answers 502 with an error body when Tavily is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    const res = await request(searchApp([])).post('/api/search').set('Origin', 'https://app.test').send({ query: 'x' })
    expect(res.status).toBe(502)
    expect(res.body.error).toBeTruthy()
  })
})
