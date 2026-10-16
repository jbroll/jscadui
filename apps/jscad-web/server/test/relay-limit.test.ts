import express from 'express'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountRelayRoutes } from '../src/relay/routes.js'
import { relayJson, relayJsonError } from '../src/relay/body.js'

const dir = join(tmpdir(), `relay-limit-${process.pid}`)
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

describe('relay body limit', () => {
  it('forwards a 200KB chat completion body instead of 413', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new Response('data: ok\n\n').body }) as unknown as Response)
    const app = express()
    app.use(relayJson())
    app.use(relayJsonError())
    mountRelayRoutes(app, {
      allowlistPath,
      trustedOrigins: ['https://app.test'],
      logger: () => {},
      fetchFn: fetchMock,
      dnsLookup: async () => [{ address: '93.184.216.34' }],
      chatLogDir: '0',
    })
    const big = 'x'.repeat(200 * 1024)
    const res = await request(app).post('/api/relay/openai/v1/chat/completions').set('Origin', 'https://app.test').send({ model: 'm', messages: [{ role: 'user', content: big }] })
    expect(res.status).toBe(200)
  })

  it('answers JSON 413 past the limit instead of an HTML page', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new Response('data: ok\n\n').body }) as unknown as Response)
    const app = express()
    app.use(relayJson())
    app.use(relayJsonError())
    mountRelayRoutes(app, {
      allowlistPath,
      trustedOrigins: ['https://app.test'],
      logger: () => {},
      fetchFn: fetchMock,
      dnsLookup: async () => [{ address: '93.184.216.34' }],
      chatLogDir: '0',
    })
    const huge = 'x'.repeat(2 * 1024 * 1024)
    const res = await request(app).post('/api/relay/openai/v1/chat/completions').set('Origin', 'https://app.test').send({ model: 'm', messages: [{ role: 'user', content: huge }] })
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'payload too large' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
