import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mountRelayRoutes } from '../src/relay/routes.js'
import { tempDir } from './tempDir.js'

// The single relay endpoint family serves every provider through a hook chosen
// by wire `kind`. `jscad-web` is the free specialization; every other kind is
// the own-key passthrough. These tests pin the dispatch and the two hooks.

// One fixed instant so day/month rollovers in the meter are deterministic.
const NOW = Date.parse('2026-10-15T18:00:00Z')
const DAY = '2026-10-15'
const MONTH = '2026-10'

const tmp = () => tempDir('providers-')

const modelEntry = (over: Record<string, unknown> = {}) => ({
  model: 'deepseek-v4.1-flash',
  maxTokens: 8192,
  inputUsdPerMTok: 1,
  outputUsdPerMTok: 2,
  ...over,
})

const inferenceJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    monthlyUsd: 5,
    perIpDailyUsd: 0.1,
    providers: [{ kind: 'opencode-go', key: 'sk-server-secret', models: [modelEntry()] }],
    ...over,
  })

const sse = (text: string) =>
  ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new Response(text).body }) as unknown as Response

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const buildApp = ({
  config,
  logs = [],
  logDir,
  spend,
  allowlist = { 'opencode-go': 'https://upstream.test' },
}: {
  config?: string
  logs?: unknown[]
  logDir?: string
  spend?: unknown
  allowlist?: Record<string, string>
} = {}) => {
  const dir = tmp()
  const allowlistPath = join(dir, 'providers.json')
  writeFileSync(allowlistPath, JSON.stringify(allowlist))
  const inferencePath = join(dir, 'jscad-inference.json')
  if (config !== undefined) writeFileSync(inferencePath, config)
  const spendPath = join(dir, 'relay-spend.json')
  if (spend !== undefined) writeFileSync(spendPath, JSON.stringify(spend))
  const app = express()
  // index.ts parses the body before mounting the relay.
  app.use(express.json())
  mountRelayRoutes(app, {
    allowlistPath,
    inferencePath,
    inferenceSpendPath: spendPath,
    trustedOrigins: ['https://app.test'],
    logger: (entry) => logs.push(entry),
    fetchFn: fetchMock,
    dnsLookup: async () => [{ address: '93.184.216.34' }],
    now: () => NOW,
    // Every mount gets a temp log dir, even the cases that ignore the log, so a
    // served turn can never write into the repo's ./data.
    chatLogDir: logDir ?? join(dir, 'chat-logs'),
  })
  return { app, dir, inferencePath, spendPath }
}

const records = (dir: string): Record<string, unknown>[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) =>
      readFileSync(join(dir, name), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    )

const post = (app: express.Express, id: string, path: string) =>
  request(app).post(`/api/relay/jscad-web/${id}/${path}`).set('Origin', 'https://app.test')

describe('provider hook table', () => {
  it('dispatches jscad-web to the jscad hook and every other kind to the default hook', async () => {
    const { getHook } = await import('../src/relay/providers/index.js')
    const { jscadHook } = await import('../src/relay/providers/jscad.js')
    const { defaultHook } = await import('../src/relay/providers/default.js')
    expect(getHook('jscad-web')).toBe(jscadHook)
    expect(getHook('openai')).toBe(defaultHook)
    expect(getHook('meta')).toBe(defaultHook)
  })
})

describe('GET /api/relay/jscad-web/v1/models', () => {
  it('serves the free catalog array without contacting upstream', async () => {
    const { app } = buildApp({ config: inferenceJson() })
    const res = await request(app).get('/api/relay/jscad-web/v1/models').set('Origin', 'https://app.test')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { id: 'deepseek-v4.1-flash', kind: 'opencode-go', model: 'deepseek-v4.1-flash', available: true, capabilities: { vision: false } },
    ])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify(res.body)).not.toMatch(/secret|UsdPerMTok/)
  })

  it('answers an empty array when the config file is missing', async () => {
    const { app } = buildApp({})
    const res = await request(app).get('/api/relay/jscad-web/v1/models').set('Origin', 'https://app.test')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('hides the free models and logs when the config cannot be parsed', async () => {
    const logs: unknown[] = []
    const { app } = buildApp({ config: '{ not json', logs })
    const res = await request(app).get('/api/relay/jscad-web/v1/models').set('Origin', 'https://app.test')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(logs.some((l) => JSON.stringify(l).includes('inference-config-error'))).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('404s a jscad-web GET that is not the catalog, without contacting upstream', async () => {
    const { app } = buildApp({ config: inferenceJson() })
    const res = await request(app).get('/api/relay/jscad-web/v1/other').set('Origin', 'https://app.test')
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an untrusted origin', async () => {
    const { app } = buildApp({ config: inferenceJson() })
    const res = await request(app).get('/api/relay/jscad-web/v1/models').set('Origin', 'https://evil.test')
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/relay/jscad-web/<id>/<path>', () => {
  it('injects the server key, drops the sentinel, pins the model, and streams', async () => {
    fetchMock.mockImplementation(async () => sse('data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'))
    const { app } = buildApp({ config: inferenceJson() })
    const res = await post(app, 'deepseek-v4.1-flash', 'v1/chat/completions')
      .set('Authorization', 'Bearer jscad-web-free')
      .set('x-api-key', 'jscad-web-free')
      .send({ model: 'client-model', stream: false, max_tokens: 999, messages: [] })
    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://upstream.test/v1/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-server-secret')
    expect(headers['x-api-key']).toBeUndefined()
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('deepseek-v4.1-flash')
    expect(body.stream).toBe(true)
    expect(res.text).toContain('data:')
  })

  it('always logs the turn with inference and costUsd, even without a chat id, and never the key', async () => {
    fetchMock.mockImplementation(async () => sse('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n'))
    const logDir = tmp()
    const { app } = buildApp({ config: inferenceJson(), logDir })
    await post(app, 'deepseek-v4.1-flash', 'v1/chat/completions').send({ messages: [] })
    await vi.waitFor(() => expect(records(logDir)).toHaveLength(1))
    const [rec] = records(logDir)
    expect(rec).toMatchObject({ chatId: null, kind: 'opencode-go', path: 'v1/chat/completions', inference: 'deepseek-v4.1-flash', status: 200 })
    expect(rec.costUsd).toBeCloseTo((10 * 1 + 5 * 2) / 1e6, 12)
    expect(JSON.stringify(rec)).not.toMatch(/sk-server-secret/)
  })

  it('404s a wrong path and an unknown id without contacting upstream', async () => {
    const { app } = buildApp({ config: inferenceJson() })
    expect((await post(app, 'deepseek-v4.1-flash', 'v1/wrong').send({})).status).toBe(404)
    expect((await post(app, 'nope', 'v1/chat/completions').send({})).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a spent month with the inference_quota_exhausted 402 before any upstream call', async () => {
    const { app } = buildApp({ config: inferenceJson(), spend: { month: MONTH, monthSpent: 5, day: DAY, ipSpend: {} } })
    const res = await post(app, 'deepseek-v4.1-flash', 'v1/chat/completions').send({ messages: [] })
    expect(res.status).toBe(402)
    expect(res.body).toEqual({ error: { code: 'inference_quota_exhausted', scope: 'month', message: expect.any(String) } })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('default hook (own key)', () => {
  it('forwards the client key and logs only when a chat id is present', async () => {
    fetchMock.mockImplementation(async () => sse('data: ok\n\n'))
    const withId = tmp()
    const { app: appWithId } = buildApp({ allowlist: { openai: 'https://upstream.test' }, logDir: withId })
    await request(appWithId)
      .post('/api/relay/openai/v1/chat/completions')
      .set('Origin', 'https://app.test')
      .set('Authorization', 'Bearer sk-client')
      .set('x-jscad-chat-id', 'chat-1')
      .send({ model: 'm' })
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).authorization).toBe('Bearer sk-client')
    expect(records(withId)).toHaveLength(1)
    expect(records(withId)[0]).toMatchObject({ chatId: 'chat-1', kind: 'openai' })
    expect(records(withId)[0]).not.toHaveProperty('inference')

    fetchMock.mockClear()
    fetchMock.mockImplementation(async () => sse('data: ok\n\n'))
    const withoutId = tmp()
    const { app: appWithoutId } = buildApp({ allowlist: { openai: 'https://upstream.test' }, logDir: withoutId })
    const res = await request(appWithoutId)
      .post('/api/relay/openai/v1/chat/completions')
      .set('Origin', 'https://app.test')
      .set('Authorization', 'Bearer sk-client')
      .send({ model: 'm' })
    expect(res.status).toBe(200)
    expect(records(withoutId)).toEqual([])
  })
})

describe('removed route families', () => {
  it('no longer serves /api/relay/inference or /api/relay/shared', async () => {
    const { app } = buildApp({ config: inferenceJson() })
    for (const url of ['/api/relay/inference/deepseek/v1/chat/completions', '/api/relay/shared/deepseek/v1/chat/completions']) {
      const res = await request(app).post(url).set('Origin', 'https://app.test').send({ messages: [] })
      expect(res.status).toBe(404)
    }
    const got = await request(app).get('/api/relay/inference').set('Origin', 'https://app.test')
    expect(got.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
