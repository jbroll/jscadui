import express from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mountRelayRoutes } from '../src/relay/routes.js'
import { tempDir } from './tempDir.js'

const sseResponse = (text: string) =>
  ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new Response(text).body }) as unknown as Response

describe('relay state under DATA_PATH', () => {
  let had: { data?: string; log?: string; spend?: string }
  beforeEach(() => {
    had = { data: process.env.DATA_PATH, log: process.env.CHAT_LOG_DIR, spend: process.env.RELAY_SPEND_PATH }
    delete process.env.CHAT_LOG_DIR
    delete process.env.RELAY_SPEND_PATH
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    for (const [key, value] of [['DATA_PATH', had.data], ['CHAT_LOG_DIR', had.log], ['RELAY_SPEND_PATH', had.spend]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('writes the chat log and spend state under DATA_PATH, outside the deployed app directory', async () => {
    const data = tempDir('relay-data-')
    process.env.DATA_PATH = data
    const allowlistPath = join(data, 'providers.json')
    writeFileSync(allowlistPath, JSON.stringify({ openai: 'https://upstream.test' }))
    const fetchMock = vi.fn(async () => sseResponse('data: ok\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    const app = express()
    app.use(express.json())
    mountRelayRoutes(app, {
      allowlistPath,
      trustedOrigins: ['https://app.test'],
      logger: () => {},
      fetchFn: fetchMock,
      dnsLookup: async () => [{ address: '93.184.216.34' }],
    })

    const res = await request(app)
      .post('/api/relay/openai/v1/chat/completions')
      .set('Origin', 'https://app.test')
      .set('x-jscad-chat-id', 'chat-dp')
      .send({ model: 'm' })

    expect(res.status).toBe(200)
    expect(readdirSync(join(data, 'chat-logs')).filter((name) => name.endsWith('.jsonl'))).toHaveLength(1)
  })
})
