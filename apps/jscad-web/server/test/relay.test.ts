import express from 'express'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendChatRecord, chatLogFileName } from '../src/relay/chatLog.js'
import { DEFAULT_CHAT_LOG_RETAIN_DAYS, mountRelayRoutes } from '../src/relay/routes.js'

const dir = join(tmpdir(), `relay-routes-${process.pid}`)
mkdirSync(dir, { recursive: true })
const allowlistPath = join(dir, 'providers.json')
writeFileSync(allowlistPath, JSON.stringify({ openai: 'https://upstream.test' }))
// A directory under the file's name is a read failure (EISDIR), not the
// missing-file case that falls back to the built-in providers.
mkdirSync(join(dir, 'does-not-exist.json'), { recursive: true })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const relayApp = (logs: unknown[], chatLog: { chatLogDir?: string; chatLogRetainDays?: number } = {}) => {
  const app = express()
  // index.ts parses the body before mounting the relay; the log keeps that body.
  app.use(express.json())
  mountRelayRoutes(app, {
    allowlistPath,
    trustedOrigins: ['https://app.test'],
    logger: (entry) => logs.push(entry),
    fetchFn: fetchMock,
    dnsLookup: async () => [{ address: '93.184.216.34' }],
    ...chatLog,
  })
  return app
}

const sseResponse = (text: string) =>
  ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new Response(text).body }) as unknown as Response

const tmpLogDir = () => mkdtempSync(join(tmpdir(), 'relay-chatlog-'))

/** Every record in `dir`'s JSONL files, in file order. */
const logRecords = (dir: string): Record<string, unknown>[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) =>
      readFileSync(join(dir, name), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    )

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

  it('GETs a model list through the relay with the same guards', async () => {
    fetchMock.mockImplementation(async () => sseResponse('{"data":[]}'))
    const res = await request(relayApp([])).get('/api/relay/openai/v1/models').set('Origin', 'https://app.test').set('Authorization', 'Bearer sk-x')
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://upstream.test/v1/models', expect.objectContaining({ method: 'GET' }))
  })

  it('refuses GET from an untrusted origin', async () => {
    const res = await request(relayApp([])).get('/api/relay/openai/v1/models').set('Origin', 'https://evil.test')
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards a same-origin GET, which browsers send without Origin', async () => {
    fetchMock.mockImplementation(async () => sseResponse('{"data":[]}'))
    const res = await request(relayApp([])).get('/api/relay/openai/v1/models').set('Sec-Fetch-Site', 'same-origin')
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('refuses a request with neither Origin nor same-origin fetch metadata', async () => {
    const res = await request(relayApp([])).get('/api/relay/openai/v1/models').set('Sec-Fetch-Site', 'cross-site')
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('hides allowlist read errors from the response and logs them', async () => {
    const logs: unknown[] = []
    const app = express()
    mountRelayRoutes(app, {
      allowlistPath: join(dir, 'does-not-exist.json'),
      trustedOrigins: ['https://app.test'],
      logger: (entry) => logs.push(entry),
      fetchFn: fetchMock,
    })
    const res = await request(app)
      .post('/api/relay/openai/v1/chat/completions')
      .set('Origin', 'https://app.test')
      .send({})
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'relay: allowlist unavailable' })
    expect(JSON.stringify(res.body)).not.toContain('does-not-exist')
    // The real error (which carries the path) reaches the log, not the client.
    expect(logs.some((l) => JSON.stringify(l).includes('does-not-exist'))).toBe(true)
  })

  it('uses the built-in providers when the allowlist file is absent', async () => {
    fetchMock.mockImplementation(async () => sseResponse('{"data":[]}'))
    const app = express()
    mountRelayRoutes(app, {
      allowlistPath: join(dir, 'absent.json'),
      trustedOrigins: ['https://app.test'],
      logger: () => {},
      fetchFn: fetchMock,
      dnsLookup: async () => [{ address: '93.184.216.34' }],
    })
    const res = await request(app).get('/api/relay/meta/v1/models').set('Origin', 'https://app.test')
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://api.meta.ai/v1/models', expect.objectContaining({ method: 'GET' }))
  })
})

describe('chat logging', () => {
  it('writes one record for a POST carrying x-jscad-chat-id, and never forwards that header', async () => {
    fetchMock.mockImplementation(async () => sseResponse('data: hello\n\n'))
    const logDir = tmpLogDir()
    const res = await request(relayApp([], { chatLogDir: logDir }))
      .post('/api/relay/openai/v1/chat/completions')
      .set('Origin', 'https://app.test')
      .set('Authorization', 'Bearer sk-secret')
      .set('x-jscad-chat-id', 'chat-1')
      .send({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'eval' }] })

    expect(res.status).toBe(200)
    const records = logRecords(logDir)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ chatId: 'chat-1', kind: 'openai', path: 'v1/chat/completions', status: 200 })
    expect(records[0].response).toContain('data: hello')
    expect(records[0].request).toEqual({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(Object.keys(headers)).not.toContain('x-jscad-chat-id')
  })

  it('writes nothing for a POST without a chat id', async () => {
    fetchMock.mockImplementation(async () => sseResponse('data: hello\n\n'))
    const logDir = tmpLogDir()
    const res = await request(relayApp([], { chatLogDir: logDir }))
      .post('/api/relay/openai/v1/chat/completions')
      .set('Origin', 'https://app.test')
      .send({ model: 'm' })

    expect(res.status).toBe(200)
    expect(logRecords(logDir)).toEqual([])
  })

  it('writes nothing for a GET, with or without a chat id', async () => {
    fetchMock.mockImplementation(async () => sseResponse('{"data":[]}'))
    const logDir = tmpLogDir()
    const res = await request(relayApp([], { chatLogDir: logDir }))
      .get('/api/relay/openai/v1/models')
      .set('Origin', 'https://app.test')
      .set('x-jscad-chat-id', 'chat-get')

    expect(res.status).toBe(200)
    expect(logRecords(logDir)).toEqual([])
  })

  it('records the body but no request header value', async () => {
    fetchMock.mockImplementation(async () => sseResponse('data: ok\n\n'))
    const logDir = tmpLogDir()
    await request(relayApp([], { chatLogDir: logDir }))
      .post('/api/relay/openai/v1/messages')
      .set('Origin', 'https://app.test')
      .set('Authorization', 'Bearer sk-secret')
      .set('x-api-key', 'sk-ant')
      .set('Cookie', 'better-auth.session_token=cookie-secret')
      .set('X-Forwarded-For', '203.0.113.9')
      .set('x-jscad-chat-id', 'chat-2')
      .send({ model: 'm' })

    const [record] = logRecords(logDir)
    // Exactly the record shape: no headers, and no field a header could hide in.
    expect(Object.keys(record).sort()).toEqual(['chatId', 'kind', 'ms', 'path', 'request', 'response', 'status', 'ts'])
    expect(JSON.stringify(record)).not.toMatch(/sk-secret|sk-ant|cookie-secret|203\.0\.113\.9/)
  })

  it('turns logging off when CHAT_LOG_DIR is 0', async () => {
    fetchMock.mockImplementation(async () => sseResponse('data: ok\n\n'))
    const had = process.env.CHAT_LOG_DIR
    process.env.CHAT_LOG_DIR = '0'
    try {
      const res = await request(relayApp([]))
        .post('/api/relay/openai/v1/chat/completions')
        .set('Origin', 'https://app.test')
        .set('x-jscad-chat-id', 'chat-3')
        .send({ model: 'm' })
      expect(res.status).toBe(200)
    } finally {
      if (had === undefined) delete process.env.CHAT_LOG_DIR
      else process.env.CHAT_LOG_DIR = had
    }
    // `0` is the off switch, not a directory to write into.
    expect(existsSync(join(process.cwd(), '0'))).toBe(false)
  })

  it('prunes log files older than the retention window, keeping newer files and other names', () => {
    const logDir = tmpLogDir()
    const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
    writeFileSync(join(logDir, `${day(200)}.jsonl`), '{}\n')
    writeFileSync(join(logDir, `${day(91)}.jsonl`), '{}\n')
    writeFileSync(join(logDir, `${day(89)}.jsonl`), '{}\n')
    writeFileSync(join(logDir, `${day(0)}.jsonl`), '{}\n')
    writeFileSync(join(logDir, 'notes.txt'), 'not a log\n')

    relayApp([], { chatLogDir: logDir, chatLogRetainDays: 90 })

    expect(readdirSync(logDir).sort()).toEqual([`${day(0)}.jsonl`, `${day(89)}.jsonl`, 'notes.txt'].sort())
  })

  it('prunes the files the writer names', () => {
    const logDir = tmpLogDir()
    const ts = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()
    appendChatRecord(logDir, { ts: ts(200) })
    appendChatRecord(logDir, { ts: ts(0) })

    relayApp([], { chatLogDir: logDir, chatLogRetainDays: 90 })

    expect(readdirSync(logDir)).toEqual([chatLogFileName(ts(0))])
  })

  describe('retention window', () => {
    const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
    const withEnv = (value: string, run: () => void) => {
      const had = process.env.CHAT_LOG_RETAIN_DAYS
      process.env.CHAT_LOG_RETAIN_DAYS = value
      try {
        run()
      } finally {
        if (had === undefined) delete process.env.CHAT_LOG_RETAIN_DAYS
        else process.env.CHAT_LOG_RETAIN_DAYS = had
      }
    }
    const filesAfter = (value: string, ages: number[]) => {
      const logDir = tmpLogDir()
      for (const age of ages) writeFileSync(join(logDir, `${day(age)}.jsonl`), '{}\n')
      withEnv(value, () => relayApp([], { chatLogDir: logDir }))
      return readdirSync(logDir).sort()
    }

    it('keeps today when the value is negative', () => {
      expect(filesAfter('-5', [0])).toEqual([`${day(0)}.jsonl`])
    })

    it('mounts without throwing when the value is huge', () => {
      expect(filesAfter('1e9', [0, 4000])).toEqual([`${day(0)}.jsonl`])
    })

    it('keeps the default window when the value is empty', () => {
      const inside = DEFAULT_CHAT_LOG_RETAIN_DAYS - 1
      expect(filesAfter('', [inside, DEFAULT_CHAT_LOG_RETAIN_DAYS + 1])).toEqual([`${day(inside)}.jsonl`])
    })

    it('floors a fraction', () => {
      expect(filesAfter('1.9', [0, 1, 3])).toEqual([`${day(1)}.jsonl`, `${day(0)}.jsonl`].sort())
    })
  })

  it('aborts the upstream request when the page closes the connection', async () => {
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
    const pending = request(relayApp([], { chatLogDir: tmpLogDir() }))
      .post('/api/relay/openai/v1/chat/completions')
      .set('Origin', 'https://app.test')
      .set('x-jscad-chat-id', 'chat-4')
      .send({ model: 'm' })
    const settled = pending.then(
      () => 'settled',
      () => 'settled',
    )

    await vi.waitFor(() => expect(signal).toBeDefined())
    pending.abort()
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    await settled
  })
})

describe('client address', () => {
  it('keys the limiter on the address the loopback proxy appended, not the client-forged entry', async () => {
    fetchMock.mockImplementation(async () => sseResponse('data: ok\n\n'))
    const app = express()
    // Mirrors src/index.ts. With `true` Express would trust the leftmost
    // X-Forwarded-For entry, which is whatever the client sent.
    app.set('trust proxy', 'loopback')
    mountRelayRoutes(app, {
      allowlistPath,
      trustedOrigins: ['https://app.test'],
      logger: () => {},
      fetchFn: fetchMock,
      dnsLookup: async () => [{ address: '93.184.216.34' }],
    })

    // A different forged leftmost entry each time, one real client all along.
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/relay/openai/v1/chat/completions')
        .set('Origin', 'https://app.test')
        .set('X-Forwarded-For', `203.0.113.${i}, 198.51.100.7`)
        .send({})
      statuses.push(res.status)
    }
    expect(statuses).toEqual([...Array(10).fill(200), 429])
  })

  it('pins the production trust-proxy setting to the loopback hop', () => {
    // createServer cannot be built in this suite (the better-sqlite3 native
    // binding fails to self-register), so read the setting itself: `true` here
    // would hand the rate-limit key to the client.
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/app\.set\(\s*['"]trust proxy['"]\s*,\s*['"]loopback['"]\s*\)/)
  })
})
