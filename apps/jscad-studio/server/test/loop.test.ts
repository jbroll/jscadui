import http, { type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express, { type Express } from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Provider, ProviderEvent, ProviderMessage } from '../src/providers/types.js'
import { runTurn, type Conversation } from '../src/agent/loop.js'
import { mountAgentRoutes, type ConversationStore } from '../src/agent/routes.js'

// Fake provider driving the loop with recorded event rounds — one round per send() call, so a
// tool result appends a message and the next send() returns the next round.

function roundsProvider(rounds: ProviderEvent[][]): Provider & { sent: ProviderMessage[][] } {
  const sent: ProviderMessage[][] = []
  return {
    sent,
    async *send(messages: ProviderMessage[], _tools) {
      sent.push([...messages])
      for (const event of rounds.shift() ?? []) yield event
    },
  }
}

describe('runTurn', () => {
  it('streams text and ends a turn with no tool call, leaving the input untouched', async () => {
    const provider = roundsProvider([
      [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' there' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ])
    const requestTool = vi.fn()
    const texts: string[] = []
    const input: Conversation = { messages: [{ role: 'user', content: 'hi' }] }

    const result = await runTurn({ conversation: input, provider, requestTool, onText: (t) => texts.push(t) })

    expect(texts).toEqual(['Hello', ' there'])
    expect(requestTool).not.toHaveBeenCalled()
    expect(result).not.toBe(input)
    expect(input.messages).toHaveLength(1)
    expect(result.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello there', toolCalls: [] },
    ])
  })

  it('requests measure, waits for the browser result, then continues', async () => {
    const provider = roundsProvider([
      [
        { type: 'text', text: 'Let me measure' },
        { type: 'tool_use', id: 'tool_1', name: 'measure', input: { target: 'part1' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'It fits' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ])
    let resolveResult!: (value: string) => void
    const resultPromise = new Promise<string>((r) => {
      resolveResult = r
    })
    const requestTool = vi.fn((name: string, input: unknown) => {
      expect(name).toBe('measure')
      expect(input).toEqual({ target: 'part1' })
      return resultPromise
    })
    const texts: string[] = []
    const conversation: Conversation = { messages: [{ role: 'user', content: 'measure part1' }] }

    const turn = runTurn({ conversation, provider, requestTool, onText: (t) => texts.push(t) })

    await vi.waitFor(() => expect(requestTool).toHaveBeenCalledTimes(1))
    expect(texts).toEqual(['Let me measure'])
    resolveResult('{"volume": 42}')
    const result = await turn

    expect(texts).toEqual(['Let me measure', 'It fits'])
    expect(provider.sent).toHaveLength(2)
    expect(provider.sent[1]).toEqual([
      { role: 'user', content: 'measure part1' },
      {
        role: 'assistant',
        content: 'Let me measure',
        toolCalls: [{ id: 'tool_1', name: 'measure', input: { target: 'part1' } }],
      },
      { role: 'tool', toolCallId: 'tool_1', content: '{"volume": 42}' },
    ])
    expect(result.messages).toEqual([
      { role: 'user', content: 'measure part1' },
      {
        role: 'assistant',
        content: 'Let me measure',
        toolCalls: [{ id: 'tool_1', name: 'measure', input: { target: 'part1' } }],
      },
      { role: 'tool', toolCallId: 'tool_1', content: '{"volume": 42}' },
      { role: 'assistant', content: 'It fits', toolCalls: [] },
    ])
  })

  it('times out a tool result that never arrives and ends the turn with an error', async () => {
    const provider = roundsProvider([
      [
        { type: 'tool_use', id: 'tool_1', name: 'measure', input: {} },
        { type: 'done', stopReason: 'tool_use' },
      ],
    ])
    const requestTool = vi.fn(() => new Promise<string>(() => {}))
    const conversation: Conversation = { messages: [{ role: 'user', content: 'measure it' }] }

    await expect(
      runTurn({ conversation, provider, requestTool, toolTimeoutMs: 25 }),
    ).rejects.toMatchObject({
      name: 'ToolTimeoutError',
      message: expect.stringContaining('timed out'),
    })
  })

  it('a second turn on the same conversation sees the prior messages', async () => {
    const first = roundsProvider([
      [
        { type: 'text', text: 'first answer' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ])
    const input: Conversation = { messages: [{ role: 'user', content: 'q1' }] }
    const afterFirst = await runTurn({ conversation: input, provider: first, requestTool: vi.fn() })
    expect(afterFirst).not.toBe(input)
    expect(input.messages).toHaveLength(1)

    const second = roundsProvider([[]])
    const afterSecond = await runTurn({
      conversation: { messages: [...afterFirst.messages, { role: 'user', content: 'q2' }] },
      provider: second,
      requestTool: vi.fn(),
    })

    expect(second.sent[0]).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'first answer', toolCalls: [] },
      { role: 'user', content: 'q2' },
    ])
    expect(afterSecond).not.toBe(afterFirst)
    expect(afterSecond.messages).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'first answer', toolCalls: [] },
      { role: 'user', content: 'q2' },
    ])
  })

  it('a disconnect cancels an in-flight turn', async () => {
    const provider: Provider = {
      async *send() {
        yield { type: 'text', text: 'thinking' }
        await new Promise((r) => setTimeout(r, 5000))
        yield { type: 'text', text: 'never seen' }
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const ac = new AbortController()
    const turn = runTurn({
      conversation: { messages: [] },
      provider,
      requestTool: vi.fn(),
      signal: ac.signal,
    })
    const rejection = expect(turn).rejects.toMatchObject({ name: 'AbortError' })
    setTimeout(() => ac.abort(), 15)
    await rejection
  })
})

// Raw HTTP harness for the SSE routes: supertest buffers the whole response, which cannot observe
// the mid-stream tool_request the round trip depends on.

interface SseFrame {
  event: string
  data: string
}

interface ChatStream {
  req: http.ClientRequest
  frames: SseFrame[]
  closed: Promise<void>
  waitForEvent(event: string, timeoutMs?: number): Promise<string>
}

function startChat(port: number, path: string, body: unknown): ChatStream {
  const frames: SseFrame[] = []
  const waiters = new Map<string, Array<(data: string) => void>>()
  let resolveClosed!: () => void
  const closed = new Promise<void>((r) => {
    resolveClosed = r
  })
  const req = http.request(
    { port, path, method: 'POST', headers: { 'content-type': 'application/json' } },
    (res: IncomingMessage) => {
      let buf = ''
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString()
        let sep: number
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep)
          buf = buf.slice(sep + 2)
          const event = frame.match(/^event: (.+)$/m)?.[1] ?? ''
          const data = frame.match(/^data: (.+)$/m)?.[1] ?? ''
          frames.push({ event, data })
          const waiter = waiters.get(event)
          if (waiter && waiter.length > 0) waiter.shift()!(data)
        }
      })
      res.on('end', () => resolveClosed())
      res.on('error', resolveClosed)
    },
  )
  req.on('error', resolveClosed)
  req.end(JSON.stringify(body))
  return {
    req,
    frames,
    closed,
    waitForEvent(event, timeoutMs = 2000) {
      const existing = frames.find((f) => f.event === event)
      if (existing) return Promise.resolve(existing.data)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for ${event} event`)),
          timeoutMs,
        )
        const list = waiters.get(event) ?? []
        list.push((data) => {
          clearTimeout(timer)
          resolve(data)
        })
        waiters.set(event, list)
      })
    },
  }
}

function postJson(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; bodyText: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { port, path, method: 'POST', headers: { 'content-type': 'application/json' } },
      (res: IncomingMessage) => {
        let text = ''
        res.on('data', (c: Buffer) => (text += c.toString()))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, bodyText: text }))
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

const PROVIDER_BODY = { kind: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-5' }

describe('chat routes', () => {
  let server: Server | undefined

  afterEach(() => {
    server?.close()
    server = undefined
  })

  function listen(app: Express): number {
    server = app.listen(0)
    return (server.address() as AddressInfo).port
  }

  function chatApp(provider: Provider): Express {
    const app = express()
    app.use(express.json())
    mountAgentRoutes(app, { createProvider: () => provider })
    return app
  }

  it('streams text then done over SSE and closes the stream once', async () => {
    const provider = roundsProvider([
      [
        { type: 'text', text: 'hello' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ])
    const res = await request(chatApp(provider))
      .post('/api/chat/proj1')
      .send({ message: 'hi', provider: PROVIDER_BODY })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.text).toContain('event: text')
    expect(res.text).toContain('event: done')
    expect(res.text.match(/event: done/g)).toHaveLength(1)
  })

  it('accepts a tool result POSTed to /tool/:callId and completes the turn', async () => {
    const provider = roundsProvider([
      [
        { type: 'tool_use', id: 'tool_1', name: 'measure', input: { target: 'part1' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'measured' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ])
    const port = listen(chatApp(provider))

    const stream = startChat(port, '/api/chat/proj1', {
      message: 'measure it',
      provider: PROVIDER_BODY,
    })
    const toolRequest = JSON.parse(await stream.waitForEvent('tool_request'))
    expect(toolRequest).toEqual({
      callId: expect.any(String),
      name: 'measure',
      input: { target: 'part1' },
    })

    const toolRes = await postJson(port, `/api/chat/proj1/tool/${toolRequest.callId}`, {
      result: { volume: 42 },
    })
    expect(toolRes.status).toBe(200)

    await stream.closed
    expect(stream.frames.map((f) => f.event)).toEqual(['tool_request', 'text', 'done'])
    expect(JSON.parse(stream.frames[2].data)).toEqual({})
  })

  it('answers 404 for an unknown tool call id', async () => {
    const port = listen(chatApp(roundsProvider([[]])))
    const res = await postJson(port, '/api/chat/proj1/tool/nope', { result: 1 })
    expect(res.status).toBe(404)
  })

  it('answers 403 when another author resolves a pending tool call', async () => {
    const provider = roundsProvider([
      [
        { type: 'tool_use', id: 'tool_1', name: 'measure', input: { target: 'part1' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'measured' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ])
    let author = 'u1'
    const app = express()
    app.use(express.json())
    mountAgentRoutes(app, { createProvider: () => provider, getAuthor: () => author })
    const port = listen(app)

    const stream = startChat(port, '/api/chat/proj1', {
      message: 'measure it',
      provider: PROVIDER_BODY,
    })
    const toolRequest = JSON.parse(await stream.waitForEvent('tool_request'))

    author = 'u2'
    const forbidden = await postJson(port, `/api/chat/proj1/tool/${toolRequest.callId}`, {
      result: 1,
    })
    expect(forbidden.status).toBe(403)

    // The rejected attempt must not consume the call: the owning author resolves it.
    author = 'u1'
    const ok = await postJson(port, `/api/chat/proj1/tool/${toolRequest.callId}`, {
      result: { volume: 42 },
    })
    expect(ok.status).toBe(200)
    await stream.closed
    expect(stream.frames.map((f) => f.event)).toEqual(['tool_request', 'text', 'done'])
  })

  it('rejects a second turn while one is running', async () => {
    const hanging: Provider = {
      send() {
        return {
          [Symbol.asyncIterator]() {
            return { next: () => new Promise(() => {}) } as AsyncIterator<ProviderEvent>
          },
        }
      },
    }
    const port = listen(chatApp(hanging))

    const stream = startChat(port, '/api/chat/proj1', { message: 'first', provider: PROVIDER_BODY })
    await new Promise((r) => setTimeout(r, 50))
    const res = await postJson(port, '/api/chat/proj1', {
      message: 'second',
      provider: PROVIDER_BODY,
    })
    expect(res.status).toBe(409)
    stream.req.destroy()
  })

  it('answers 401 when no session resolves the author', async () => {
    const app = express()
    app.use(express.json())
    mountAgentRoutes(app, { createProvider: () => roundsProvider([[]]), getAuthor: () => null })
    const res = await request(app)
      .post('/api/chat/proj1')
      .send({ message: 'hi', provider: PROVIDER_BODY })
    expect(res.status).toBe(401)
    const tool = await request(app).post('/api/chat/proj1/tool/nope').send({ result: 1 })
    expect(tool.status).toBe(401)
  })

  it('keeps conversations in the conversation store, per author and project', async () => {
    const saved = new Map<string, Conversation>()
    const store: ConversationStore = {
      load: vi.fn((key: string) => saved.get(key)),
      save: vi.fn((key: string, conversation: Conversation) => {
        saved.set(key, conversation)
      }),
    }
    const provider = roundsProvider([
      [
        { type: 'text', text: 'first answer' },
        { type: 'done', stopReason: 'end_turn' },
      ],
      [
        { type: 'text', text: 'second answer' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ])
    const app = express()
    app.use(express.json())
    mountAgentRoutes(app, {
      createProvider: () => provider,
      getAuthor: () => 'u1',
      conversationStore: store,
    })
    const port = listen(app)

    const first = startChat(port, '/api/chat/proj1', { message: 'q1', provider: PROVIDER_BODY })
    await first.closed
    expect(store.save).toHaveBeenCalledWith(
      'u1:proj1',
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'q1' },
          { role: 'assistant', content: 'first answer', toolCalls: [] },
        ],
      }),
    )

    const second = startChat(port, '/api/chat/proj1', { message: 'q2', provider: PROVIDER_BODY })
    await second.closed
    expect(store.load).toHaveBeenCalledWith('u1:proj1')
    // The second turn started from the stored conversation, not a fresh one.
    expect(provider.sent[1]).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'first answer', toolCalls: [] },
      { role: 'user', content: 'q2' },
    ])
  })
})
