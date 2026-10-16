import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountRelayRoutes } from '../src/relay/routes.js'
import {
  DEFAULT_INFERENCE_PATH,
  MESSAGES_MODELS,
  RESPONSES_MODELS,
  expectedPathFor,
  loadInferenceFile,
  parseInferenceConfig,
} from '../src/relay/inference.js'
import { MESSAGES_MODELS as AGENT_LOOP_MESSAGES, RESPONSES_MODELS as AGENT_LOOP_RESPONSES } from '../../../../packages/agent-loop/src/providers.js'

// One fixed instant so day/month rollovers in the meter are deterministic.
const NOW = Date.parse('2026-10-15T18:00:00Z')
const DAY = '2026-10-15'
const MONTH = '2026-10'

const tmp = () => mkdtempSync(join(tmpdir(), 'inference-'))

const modelEntry = (over: Record<string, unknown> = {}) => ({
  id: 'deepseek',
  label: 'DeepSeek V4.1 Flash',
  model: 'deepseek-v4.1-flash',
  maxTokens: 8192,
  inputUsdPerMTok: 1,
  outputUsdPerMTok: 2,
  ...over,
})

const museEntry = {
  id: 'muse',
  label: 'Muse Spark 1.3',
  model: 'muse-spark-1.3-contributor',
  maxTokens: 4096,
  inputUsdPerMTok: 3,
  outputUsdPerMTok: 4,
}

const provider = (over: Record<string, unknown> = {}) => ({
  kind: 'opencode-go',
  key: 'sk-server-secret',
  models: [modelEntry()],
  ...over,
})

const inferenceJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    monthlyUsd: 5,
    perIpDailyUsd: 0.1,
    providers: [provider(), { kind: 'meta', key: 'meta-server-secret', models: [museEntry] }],
    ...over,
  })

const sse = (text: string) =>
  ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new Response(text).body }) as unknown as Response

let fetchMock: ReturnType<typeof vi.fn>

const buildApp = ({
  config,
  logs = [],
  logDir,
  spend,
  dnsLookup = async () => [{ address: '93.184.216.34' }],
  onClose,
}: {
  config?: string
  logs?: unknown[]
  logDir?: string
  spend?: unknown
  dnsLookup?: (host: string) => Promise<Array<{ address: string }>>
  /** Fires when the response closes, so a test can await the server seeing a client leave. */
  onClose?: () => void
} = {}) => {
  const dir = tmp()
  const allowlistPath = join(dir, 'providers.json')
  writeFileSync(allowlistPath, JSON.stringify({ 'opencode-go': 'https://upstream.test', meta: 'https://upstream.test' }))
  const inferencePath = join(dir, 'jscad-inference.json')
  if (config !== undefined) writeFileSync(inferencePath, config)
  const spendPath = join(dir, 'relay-spend.json')
  if (spend !== undefined) writeFileSync(spendPath, JSON.stringify(spend))
  const app = express()
  // index.ts parses the body before mounting the relay.
  app.use(express.json())
  if (onClose) app.use((_req, res, next) => { res.on('close', onClose); next() })
  mountRelayRoutes(app, {
    allowlistPath,
    sharedPath: inferencePath,
    inferenceSpendPath: spendPath,
    trustedOrigins: ['https://app.test'],
    logger: (entry) => logs.push(entry),
    fetchFn: fetchMock,
    dnsLookup,
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
  request(app).post(`/api/relay/inference/${id}/${path}`).set('Origin', 'https://app.test')

beforeEach(() => {
  fetchMock = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('inference config', () => {
  it('defaults to the jscad-inference.json path', () => {
    expect(DEFAULT_INFERENCE_PATH.endsWith('jscad-inference.json')).toBe(true)
  })

  it('mirrors agent-loop routing sets and sends each free model down its endpoint', () => {
    expect([...RESPONSES_MODELS].sort()).toEqual([...AGENT_LOOP_RESPONSES].sort())
    expect([...MESSAGES_MODELS].sort()).toEqual([...AGENT_LOOP_MESSAGES].sort())
    expect(expectedPathFor('opencode-go', 'deepseek-v4.1-flash')).toBe('v1/chat/completions')
    expect(expectedPathFor('meta', 'muse-spark-1.3-contributor')).toBe('v1/responses')
    expect(expectedPathFor('openai', 'gpt')).toBeNull()
    expect(expectedPathFor('opencode-go', 'minimax-m3')).toBeNull()
  })

  it('names the inference config in a parse error', () => {
    expect(() => parseInferenceConfig('{ not json', 'jscad-inference.json')).toThrow(
      /relay: inference config jscad-inference\.json is not valid JSON/,
    )
  })

  it('refuses a messages-protocol model, which a bearer key cannot serve', () => {
    const messages = { ...modelEntry(), model: 'minimax-m3' }
    const config = { providers: [provider({ models: [messages] })] }
    expect(() => parseInferenceConfig(JSON.stringify(config), 'jscad-inference.json')).toThrow(/minimax-m3/)
  })

  it('treats a missing file as no options, with the Phase 1 budget defaults', () => {
    const config = loadInferenceFile(join(tmp(), 'absent.json'))
    expect(config.options).toEqual([])
    expect(config.monthlyUsd).toBe(5)
    expect(config.perIpDailyUsd).toBe(0.1)
  })

  it('refuses a missing, null or negative price, and accepts a zero (free) price', () => {
    for (const bad of [undefined, null, -1]) {
      const config = { providers: [provider({ models: [modelEntry({ inputUsdPerMTok: bad })] })] }
      expect(() => parseInferenceConfig(JSON.stringify(config), 'jscad-inference.json')).toThrow(/inputUsdPerMTok/)
      const configOut = { providers: [provider({ models: [modelEntry({ outputUsdPerMTok: bad })] })] }
      expect(() => parseInferenceConfig(JSON.stringify(configOut), 'jscad-inference.json')).toThrow(/outputUsdPerMTok/)
    }
    const free = { providers: [provider({ models: [modelEntry({ inputUsdPerMTok: 0, outputUsdPerMTok: 0 })] })] }
    expect(parseInferenceConfig(JSON.stringify(free), 'jscad-inference.json').options[0]).toMatchObject({ inputUsdPerMTok: 0, outputUsdPerMTok: 0 })
  })

  it('refuses a kind other than opencode-go or meta', () => {
    const config = { providers: [provider({ kind: 'openai' })] }
    expect(() => parseInferenceConfig(JSON.stringify(config), 'jscad-inference.json')).toThrow(/kind/)
  })

  it('derives the endpoint path from kind and model instead of reading it', () => {
    const parsed = parseInferenceConfig(inferenceJson(), 'jscad-inference.json')
    expect(parsed.options.map((o) => [o.id, o.path])).toEqual([
      ['deepseek', 'v1/chat/completions'],
      ['muse', 'v1/responses'],
    ])
  })

  it('refuses duplicate option ids, even across providers', () => {
    const config = { providers: [provider(), provider({ kind: 'meta', key: 'other', models: [modelEntry()] })] }
    expect(() => parseInferenceConfig(JSON.stringify(config), 'jscad-inference.json')).toThrow(/duplicate|id/)
  })

  it('attaches one key to every model under its provider', () => {
    const config = { providers: [provider({ models: [modelEntry(), { ...museEntry, id: 'muse-go', model: 'muse-spark-1.3-contributor' }] })] }
    const options = parseInferenceConfig(JSON.stringify(config), 'jscad-inference.json').options
    expect(options.map((o) => o.key)).toEqual(['sk-server-secret', 'sk-server-secret'])
  })

  it('accepts the two free options', () => {
    expect(parseInferenceConfig(inferenceJson(), 'jscad-inference.json').options.map((o) => o.id)).toEqual(['deepseek', 'muse'])
  })
})

describe('GET /api/relay/inference', () => {
  it('returns an empty list when the config file is missing', async () => {
    const { app } = buildApp({})
    const res = await request(app).get('/api/relay/inference').set('Origin', 'https://app.test')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('accepts the deprecated RELAY_SHARED env var as a file fallback', async () => {
    const dir = tmp()
    const allowlistPath = join(dir, 'providers.json')
    writeFileSync(allowlistPath, JSON.stringify({ 'opencode-go': 'https://upstream.test' }))
    const file = join(dir, 'jscad-inference.json')
    writeFileSync(file, inferenceJson({ providers: [provider()] }))
    const hadInference = process.env.RELAY_INFERENCE
    const hadShared = process.env.RELAY_SHARED
    delete process.env.RELAY_INFERENCE
    process.env.RELAY_SHARED = file
    try {
      const app = express()
      app.use(express.json())
      mountRelayRoutes(app, {
        allowlistPath,
        trustedOrigins: ['https://app.test'],
        logger: () => {},
        fetchFn: fetchMock,
        dnsLookup: async () => [{ address: '93.184.216.34' }],
        chatLogDir: join(dir, 'chat-logs'),
      })
      const res = await request(app).get('/api/relay/inference').set('Origin', 'https://app.test')
      expect(res.body.map((o: { id: string }) => o.id)).toEqual(['deepseek'])
    } finally {
      if (hadInference === undefined) delete process.env.RELAY_INFERENCE
      else process.env.RELAY_INFERENCE = hadInference
      if (hadShared === undefined) delete process.env.RELAY_SHARED
      else process.env.RELAY_SHARED = hadShared
    }
  })

  it('lists options without keys or prices', async () => {
    const { app } = buildApp({ config: inferenceJson() })
    const res = await request(app).get('/api/relay/inference').set('Origin', 'https://app.test')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { id: 'deepseek', label: 'DeepSeek V4.1 Flash', kind: 'opencode-go', model: 'deepseek-v4.1-flash', available: true },
      { id: 'muse', label: 'Muse Spark 1.3', kind: 'meta', model: 'muse-spark-1.3-contributor', available: true },
    ])
    expect(JSON.stringify(res.body)).not.toMatch(/secret|UsdPerMTok/)
  })

  it('marks every option unavailable once the month budget is spent', async () => {
    const { app } = buildApp({ config: inferenceJson(), spend: { month: MONTH, monthSpent: 5, day: DAY, ipSpend: {} } })
    const res = await request(app).get('/api/relay/inference').set('Origin', 'https://app.test')
    expect(res.body.every((o: { available: boolean }) => o.available === false)).toBe(true)
  })

  it('hides free options (empty list) when the config cannot be parsed, and logs it', async () => {
    const logs: unknown[] = []
    const { app } = buildApp({ config: '{ not json', logs })
    const res = await request(app).get('/api/relay/inference').set('Origin', 'https://app.test')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(logs.some((l) => JSON.stringify(l).includes('inference'))).toBe(true)
  })

  it('refuses an untrusted origin', async () => {
    const { app } = buildApp({ config: inferenceJson() })
    const res = await request(app).get('/api/relay/inference').set('Origin', 'https://evil.test')
    expect(res.status).toBe(403)
  })
})

describe('POST /api/relay/inference/:id/*splat', () => {
  it('rewrites the body: pins model and stream, caps tokens, sets include_usage, passes tools and effort', async () => {
    fetchMock.mockImplementation(async () => sse('data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'))
    const { app } = buildApp({ config: inferenceJson(), logDir: tmp() })
    const res = await post(app, 'deepseek', 'v1/chat/completions').send({
      model: 'client-model',
      stream: false,
      max_tokens: 999999,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'eval' }],
      reasoning_effort: 'high',
    })
    expect(res.status).toBe(200)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.model).toBe('deepseek-v4.1-flash')
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(8192)
    expect(body.stream_options).toEqual({ include_usage: true })
    expect(body.tools).toEqual([{ name: 'eval' }])
    expect(body.reasoning_effort).toBe('high')
    expect(fetchMock).toHaveBeenCalledWith('https://upstream.test/v1/chat/completions', expect.objectContaining({ method: 'POST' }))
  })

  it('keeps the smaller client token cap', async () => {
    fetchMock.mockImplementation(async () => sse('data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'))
    const { app } = buildApp({ config: inferenceJson() })
    await post(app, 'deepseek', 'v1/chat/completions').send({ max_tokens: 100, messages: [] })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(100)
  })

  it('caps max_output_tokens for a responses option and leaves stream_options alone', async () => {
    fetchMock.mockImplementation(async () => sse('data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n'))
    const { app } = buildApp({ config: inferenceJson() })
    const res = await post(app, 'muse', 'v1/responses').send({ max_output_tokens: 100000, input: 'x' })
    expect(res.status).toBe(200)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.model).toBe('muse-spark-1.3-contributor')
    expect(body.max_output_tokens).toBe(4096)
    expect(body.stream).toBe(true)
    expect(body).not.toHaveProperty('stream_options')
  })

  it('drops the client credential and injects the server key, accepting the sentinel interchangeably', async () => {
    fetchMock.mockImplementation(async () => sse('data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'))
    const { app } = buildApp({ config: inferenceJson() })
    await post(app, 'deepseek', 'v1/chat/completions').set('Authorization', 'Bearer jscad-web-free').set('x-api-key', 'client-key').send({ messages: [] })
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-server-secret')
    expect(headers['x-api-key']).toBeUndefined()

    fetchMock.mockClear()
    fetchMock.mockImplementation(async () => sse('data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'))
    await post(app, 'deepseek', 'v1/chat/completions').set('Authorization', 'Bearer client-sentinel').send({ messages: [] })
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).authorization).toBe('Bearer sk-server-secret')
  })

  it('404s an unknown option and a wrong path without calling upstream', async () => {
    const { app } = buildApp({ config: inferenceJson() })
    expect((await post(app, 'nope', 'v1/chat/completions').send({})).status).toBe(404)
    expect((await post(app, 'deepseek', 'v1/responses').send({})).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('always logs the turn with inference and costUsd, even without a chat id, and never the key', async () => {
    fetchMock.mockImplementation(async () => sse('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n'))
    const logDir = tmp()
    const { app } = buildApp({ config: inferenceJson(), logDir })
    await post(app, 'deepseek', 'v1/chat/completions').send({ messages: [], max_tokens: 4 })
    await vi.waitFor(() => expect(records(logDir)).toHaveLength(1))
    const [rec] = records(logDir)
    expect(rec).toMatchObject({ chatId: null, kind: 'opencode-go', path: 'v1/chat/completions', inference: 'deepseek', status: 200 })
    expect(rec.costUsd).toBeCloseTo((10 * 1 + 5 * 2) / 1e6, 12)
    expect(JSON.stringify(rec)).not.toMatch(/sk-server-secret|meta-server-secret/)
  })

  it('keeps the chat id on the record when the client sends one', async () => {
    fetchMock.mockImplementation(async () => sse('data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'))
    const logDir = tmp()
    const { app } = buildApp({ config: inferenceJson(), logDir })
    await post(app, 'deepseek', 'v1/chat/completions').set('x-jscad-chat-id', 'chat-7').send({ messages: [] })
    await vi.waitFor(() => expect(records(logDir)).toHaveLength(1))
    expect(records(logDir)[0].chatId).toBe('chat-7')
  })

  it('estimates the charge when the stream carries no usage', async () => {
    fetchMock.mockImplementation(async () => sse('data: {"choices":[{"delta":{"content":"hello world"}}]}\n\n'))
    const logDir = tmp()
    const { app } = buildApp({ config: inferenceJson(), logDir })
    await post(app, 'deepseek', 'v1/chat/completions').send({ messages: [{ role: 'user', content: '123456' }] })
    await vi.waitFor(() => expect(records(logDir)).toHaveLength(1))
    const [rec] = records(logDir)
    const sentBytes = Buffer.byteLength(String(fetchMock.mock.calls[0][1].body))
    const responseBytes = Buffer.byteLength(String(rec.response))
    const expected = (Math.ceil(sentBytes / 3) * 1 + Math.ceil(responseBytes / 3) * 2) / 1e6
    expect(rec.costUsd).toBeCloseTo(expected, 12)
  })

  it('charges the IP group so an over-budget second turn is refused with the 402 body', async () => {
    fetchMock.mockImplementation(async () => sse('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n'))
    const { app } = buildApp({ config: inferenceJson({ perIpDailyUsd: 0.00001 }) })
    expect((await post(app, 'deepseek', 'v1/chat/completions').send({ messages: [] })).status).toBe(200)
    const second = await post(app, 'deepseek', 'v1/chat/completions').send({ messages: [] })
    expect(second.status).toBe(402)
    expect(second.body).toEqual({ error: { code: 'inference_quota_exhausted', scope: 'day', message: expect.any(String) } })
  })

  it('refuses a spent month with scope month before any rewrite', async () => {
    const { app } = buildApp({ config: inferenceJson(), spend: { month: MONTH, monthSpent: 5, day: DAY, ipSpend: {} } })
    const res = await post(app, 'deepseek', 'v1/chat/completions').send({ messages: [] })
    expect(res.status).toBe(402)
    expect(res.body.error).toMatchObject({ code: 'inference_quota_exhausted', scope: 'month' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a body over the 100 KB json limit before forwarding', async () => {
    const { app } = buildApp({ config: inferenceJson() })
    const res = await post(app, 'deepseek', 'v1/chat/completions').send({ messages: [{ role: 'user', content: 'x'.repeat(120_000) }] })
    expect(res.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a third in-flight request from the same IP group with 429 and Retry-After: 2', async () => {
    const pending: Array<(r: Response) => void> = []
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)))
    const { app } = buildApp({ config: inferenceJson() })
    const held = [post(app, 'deepseek', 'v1/chat/completions').send({ messages: [] }), post(app, 'deepseek', 'v1/chat/completions').send({ messages: [] })]
    // superagent sends when the thenable is awaited; start both without awaiting.
    for (const t of held) void t.then(() => {}, () => {})
    await vi.waitFor(() => expect(pending).toHaveLength(2))

    const third = await post(app, 'deepseek', 'v1/chat/completions').send({ messages: [] })
    expect(third.status).toBe(429)
    expect(third.headers['retry-after']).toBe('2')

    for (const resolve of pending) resolve(sse('data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'))
    await Promise.allSettled(held)
  })

  it('aborts the upstream request when the page closes, and still charges the estimate', async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal
      const body = new ReadableStream({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
        },
      })
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body } as unknown as Response
    })
    const logDir = tmp()
    const { app } = buildApp({ config: inferenceJson(), logDir })
    const pendingReq = post(app, 'deepseek', 'v1/chat/completions').send({ messages: [] })
    const settled = pendingReq.then(
      () => 'settled',
      () => 'settled',
    )

    await vi.waitFor(() => expect(signal).toBeDefined())
    pendingReq.abort()
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    await settled
    await vi.waitFor(() => expect(records(logDir)).toHaveLength(1))
    const [rec] = records(logDir)
    expect(rec).toMatchObject({ inference: 'deepseek', error: 'client closed' })
    expect(rec.costUsd).toBeGreaterThan(0)
  })

  it('charges the input estimate when the client leaves before the upstream responds', async () => {
    // A real fetch rejects once its signal aborts; this one models that, so the
    // handler takes its pre-headers failure path.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal
          if (signal.aborted) reject(new Error('aborted'))
          else signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const logDir = tmp()
    const { app, spendPath } = buildApp({ config: inferenceJson(), logDir })
    const pendingReq = post(app, 'deepseek', 'v1/chat/completions').send({ messages: [{ role: 'user', content: 'hello there' }] })
    const settled = pendingReq.then(
      () => 'settled',
      () => 'settled',
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    pendingReq.abort()
    await settled
    await vi.waitFor(() => expect(records(logDir)).toHaveLength(1))
    const [rec] = records(logDir)
    expect(rec).toMatchObject({ inference: 'deepseek', error: 'client closed' })
    // The prompt had already gone upstream, so the estimated input is charged and
    // the meter advances: a repeated abort cannot run the free model for free.
    const sentBytes = Buffer.byteLength(String(fetchMock.mock.calls[0][1].body))
    const expected = (Math.ceil(sentBytes / 3) * 1) / 1e6
    expect(expected).toBeGreaterThan(0)
    expect(rec.costUsd).toBeCloseTo(expected, 12)
    expect(JSON.parse(readFileSync(spendPath, 'utf8')).monthSpent).toBeCloseTo(expected, 12)
  })

  it('never calls upstream when the client leaves during DNS resolution', async () => {
    let releaseDns: (() => void) | undefined
    const dnsLookup = () =>
      new Promise<Array<{ address: string }>>((resolve) => {
        releaseDns = () => resolve([{ address: '93.184.216.34' }])
      })
    let sawClose: (() => void) | undefined
    const closed = new Promise<void>((resolve) => {
      sawClose = resolve
    })
    const logDir = tmp()
    const { app } = buildApp({ config: inferenceJson(), logDir, dnsLookup, onClose: () => sawClose?.() })
    const pendingReq = post(app, 'deepseek', 'v1/chat/completions').send({ messages: [] })
    const settled = pendingReq.then(
      () => 'settled',
      () => 'settled',
    )

    await vi.waitFor(() => expect(releaseDns).toBeDefined())
    pendingReq.abort()
    // The server's own close listener has run by the time its sibling fires.
    await closed
    releaseDns?.()
    await settled
    await vi.waitFor(() => expect(records(logDir)).toHaveLength(1))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(records(logDir)[0]).toMatchObject({ inference: 'deepseek', error: 'client closed', costUsd: 0 })
  })
})
