// packages/agent-loop/test/providers.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProvider, fetchWithRetry, parseAnthropicStream, parseOpenAIStream, streamWithRetry } from '../src/providers.js'
import { parseResponsesStream } from '../src/responses.js'
import { buildMessages } from '../src/context.js'

const TOOLS = [
  {
    name: 'measure',
    description: 'Measure the current model',
    inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
  },
]

const sseBody = (text) =>
  new Response(text, { headers: { 'content-type': 'text/event-stream' } }).body

const anthropicToolUse =
  `event: message_start\ndata: {"type":"message_start"}\n\n` +
  `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"measure","input":{}}}\n\n` +
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"target\\": \\""}}\n\n` +
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"part1\\"}"}}\n\n` +
  `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n` +
  `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n` +
  `event: message_stop\ndata: {"type":"message_stop"}\n\n`

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('providers', () => {
  it('anthropic: assembles split tool input and posts to baseUrl', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody(anthropicToolUse)))
    const provider = createProvider({ kind: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    const events = []
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.test/v1/messages',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events).toEqual([
      { type: 'tool_use', id: 'toolu_01', name: 'measure', input: { target: 'part1' } },
      { type: 'done', stopReason: 'tool_use' },
    ])
  })

  it('openai-compatible: streams text then tool_use then done', async () => {
    const body =
      `data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n` +
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"measure","arguments":""}}]}}]}\n\n` +
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"target\\":\\"part1\\"}"}}]}}]}\n\n` +
      `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n` +
      `data: [DONE]\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const provider = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    const events = []
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.test/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events[0]).toEqual({ type: 'text', text: 'Hi' })
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'measure', input: { target: 'part1' } })
    expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'tool_calls' })
  })

  it('rejects unknown provider kinds', () => {
    expect(() => createProvider({ kind: 'other', apiKey: 'k', model: 'm' })).toThrow(/unknown kind/)
  })

  it('opencode-go resolves the Zen URL through the openai adapter', async () => {
    const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'deepseek-v4-flash' })
    const events = []
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'stop' })
  })

  it('an explicit baseUrl overrides the lookup table', async () => {
    const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    const events = []
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.test/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'stop' })
  })

  it('throws when the apiKey is missing', () => {
    expect(() => createProvider({ kind: 'openai', model: 'm', baseUrl: 'https://relay.test' })).toThrow(/apiKey/)
  })

  it('meta posts Muse Spark to the Model API responses endpoint', async () => {
    const body =
      `data: {"type":"response.output_text.delta","delta":"Hi"}\n\n` +
      `data: {"type":"response.completed"}\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const provider = createProvider({ kind: 'meta', apiKey: 'k', model: 'muse-spark-1.3' })
    const events = []
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.meta.ai/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events).toContainEqual({ type: 'text', text: 'Hi' })
  })

  it('opencode-go sends a stable x-opencode-session header; openai does not', async () => {
    const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
    fetchMock.mockImplementation(() => Promise.resolve(new Response(sseBody(body))))
    const drain = async (provider) => {
      const events = []
      for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
      return events
    }
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'm' })
    await drain(provider)
    await drain(provider)
    const first = fetchMock.mock.calls[0][1].headers['x-opencode-session']
    expect(typeof first).toBe('string')
    expect(fetchMock.mock.calls[1][1].headers['x-opencode-session']).toBe(first)
    const plain = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    await drain(plain)
    expect(fetchMock.mock.calls[2][1].headers['x-opencode-session']).toBeUndefined()
  })

  it('opencode-go routes spark models to the responses endpoint', async () => {
    const body =
      `data: {"type":"response.output_text.delta","delta":"Hi"}\n\n` +
      `data: {"type":"response.output_item.added","item":{"id":"item_1","type":"function_call","call_id":"call_1","name":"measure"}}\n\n` +
      `data: {"type":"response.function_call_arguments.delta","item_id":"item_1","delta":"{\\"target\\":\\"part1\\"}"}\n\n` +
      `data: {"type":"response.completed"}\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'muse-spark-1.3-contributor' })
    const events = []
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events).toContainEqual({ type: 'text', text: 'Hi' })
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'measure', input: { target: 'part1' } })
    expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'completed' })
  })

  it.each([
    ['response.failed', `{"type":"response.failed","response":{"error":{"code":"server_error","message":"model crashed"}}}`, /model crashed/],
    ['response.incomplete', `{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}`, /max_output_tokens/],
    ['error', `{"type":"error","code":"rate_limit_exceeded","message":"slow down"}`, /slow down/],
  ])('responses: %s ends the turn with an error', async (_name, event, message) => {
    const body = `data: {"type":"response.output_text.delta","delta":"Hi"}\n\n` + `data: ${event}\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'grok-4.6' })
    const drain = async () => {
      for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) void e
    }
    await expect(drain()).rejects.toThrow(message)
  })

  it('anthropic: moves system messages to the top-level system field', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody('')))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'minimax-m3' })
    const messages = [
      { role: 'system', content: 'You are a CAD agent.' },
      { role: 'user', content: 'hi' },
    ]
    for await (const e of provider.send(messages, TOOLS)) void e
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system).toBe('You are a CAD agent.')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('opencode-go routes qwen models to the messages endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody('')))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'qwen3.8-flash' })
    const events = []
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) events.push(e)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/messages',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events).toEqual([])
  })

  it('anthropic: maps effort to output_config.effort and omits when unset', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody('')))
    const p = createProvider({ kind: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test', effort: 'high' })
    for await (const e of p.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).output_config).toEqual({ effort: 'high' })
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(new Response(sseBody('')))
    const q = createProvider({ kind: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    for await (const e of q.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('output_config')
  })

  it('openai: maps effort to reasoning_effort and omits when unset', async () => {
    const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const p = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test', effort: 'medium' })
    for await (const e of p.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('medium')
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const q = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    for await (const e of q.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort')
  })

  it('responses: maps effort to reasoning.effort and omits when unset', async () => {
    const body = `data: {"type":"response.completed"}\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const p = createProvider({ kind: 'meta', apiKey: 'k', model: 'muse-spark-1.3', effort: 'low' })
    for await (const e of p.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual({ effort: 'low', summary: 'auto' })
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const q = createProvider({ kind: 'meta', apiKey: 'k', model: 'muse-spark-1.3' })
    for await (const e of q.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('reasoning')
  })

  it.each([400, 422])('responses: a %i naming summary is sent again without it, and the config stays without it', async (status) => {
    const completed = `data: {"type":"response.output_text.delta","delta":"Hi"}\n\ndata: {"type":"response.completed"}\n\n`
    const refusal = JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning.summary'", code: 'unsupported_parameter' } })
    fetchMock.mockImplementation(async (_url, init) =>
      JSON.parse(init.body).reasoning.summary ? new Response(refusal, { status }) : new Response(sseBody(completed)))
    const config = { kind: 'opencode-go', apiKey: 'k', model: 'grok-4.6', effort: 'high', baseUrl: `https://summary-${status}.test` }
    const drain = async (provider) => {
      const events = []
      for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) events.push(e)
      return events
    }
    expect(await drain(createProvider(config))).toContainEqual({ type: 'text', text: 'Hi' })
    const sent = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).reasoning)
    expect(sent()).toEqual([{ effort: 'high', summary: 'auto' }, { effort: 'high' }])
    await drain(createProvider(config))
    expect(sent().at(-1)).toEqual({ effort: 'high' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await drain(createProvider({ ...config, model: 'gpt-5.6-luna' }))
    expect(sent().at(-2)).toEqual({ effort: 'high', summary: 'auto' })
  })

  it('responses: a 400 that does not name summary ends the call without a second request', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad model' } }), { status: 400 }))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'grok-4.6', effort: 'high', baseUrl: 'https://no-summary.test' })
    const drain = async () => {
      for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
    }
    await expect(drain()).rejects.toThrow(/bad model.*status 400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('meta chat path: maps effort to reasoning_effort', async () => {
    const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const p = createProvider({ kind: 'meta', apiKey: 'k', model: 'some-chat-model', effort: 'xhigh' })
    for await (const e of p.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('xhigh')
  })
})

describe('fetchWithRetry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries once after an overloaded response, then succeeds', async () => {
    vi.useFakeTimers()
    const overloaded = new Response(JSON.stringify({ error: { code: 'service_overloaded', message: 'busy' } }), { status: 503 })
    const ok = new Response('done')
    const fetchImpl = vi.fn().mockResolvedValueOnce(overloaded).mockResolvedValueOnce(ok)
    const onRetry = vi.fn()
    const promise = fetchWithRetry(fetchImpl, 'https://x.test', {}, { onRetry })
    await vi.advanceTimersByTimeAsync(3000)
    const res = await promise
    expect(res).toBe(ok)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0][0]).toEqual(expect.objectContaining({ attempt: 1, maxAttempts: 4, status: 503 }))
  })

  it('honors Retry-After on a 429, capped and exact, then succeeds', async () => {
    vi.useFakeTimers()
    const limited = new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429, headers: { 'retry-after': '1' } })
    const ok = new Response('done')
    const fetchImpl = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(ok)
    const onRetry = vi.fn()
    const promise = fetchWithRetry(fetchImpl, 'https://x.test', {}, { onRetry })
    await vi.advanceTimersByTimeAsync(1000)
    const res = await promise
    expect(res).toBe(ok)
    expect(onRetry.mock.calls[0][0].delayMs).toBe(1000)
  })

  it('does not retry a 401 (auth error)', async () => {
    const unauthorized = new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'bad key' } }), { status: 401 })
    const fetchImpl = vi.fn().mockResolvedValue(unauthorized)
    const onRetry = vi.fn()
    const res = await fetchWithRetry(fetchImpl, 'https://x.test', {}, { onRetry })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(401)
    expect(res.text).toContain('bad key')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('gives up after 4 attempts and returns the last failure', async () => {
    vi.useFakeTimers()
    const failing = () => new Response(JSON.stringify({ error: { code: 'overloaded_error', message: 'still busy' } }), { status: 503 })
    const fetchImpl = vi.fn().mockImplementation(async () => failing())
    const onRetry = vi.fn()
    const promise = fetchWithRetry(fetchImpl, 'https://x.test', {}, { onRetry })
    await vi.advanceTimersByTimeAsync(30_000)
    const res = await promise
    expect(res.ok).toBe(false)
    expect(res.status).toBe(503)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(onRetry).toHaveBeenCalledTimes(3)
  })

  it('retries a network error (fetch rejection), then succeeds', async () => {
    vi.useFakeTimers()
    const ok = new Response('done')
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(ok)
    const onRetry = vi.fn()
    const promise = fetchWithRetry(fetchImpl, 'https://x.test', {}, { onRetry })
    await vi.advanceTimersByTimeAsync(3000)
    const res = await promise
    expect(res).toBe(ok)
    expect(onRetry.mock.calls[0][0]).toEqual(expect.objectContaining({ attempt: 1, status: null }))
  })
})

describe('providers: retry wiring', () => {
  it('anthropic: does not retry a mid-stream error, even with zero prior output', async () => {
    const midStreamError = `data: {"type":"error","error":{"code":"service_overloaded","message":"overloaded mid-stream"}}\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(midStreamError)))
    const provider = createProvider({ kind: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    const drain = async () => {
      for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
    }
    await expect(drain()).rejects.toThrow(/overloaded mid-stream/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('openai: surfaces a retry event before streaming, then completes', async () => {
    vi.useFakeTimers()
    try {
      const limited = new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'slow down' } }), { status: 429 })
      const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
      fetchMock.mockResolvedValueOnce(limited).mockResolvedValueOnce(new Response(sseBody(body)))
      const provider = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
      const promise = (async () => {
        const events = []
        for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) events.push(e)
        return events
      })()
      await vi.advanceTimersByTimeAsync(3000)
      const events = await promise
      expect(events[0]).toEqual(expect.objectContaining({ type: 'retry', attempt: 1, status: 429 }))
      expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'stop' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('yields a retry event while its backoff is still running, not after the retried request', async () => {
    const limited = new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429 })
    const fetchImpl = vi.fn().mockResolvedValueOnce(limited)
    const iterator = streamWithRetry('openai', 'https://relay.test', {}, parseOpenAIStream, { fetchImpl, sleep: () => new Promise(() => {}) })
    const { value } = await iterator.next()
    expect(value).toEqual(expect.objectContaining({ type: 'retry', attempt: 1, maxAttempts: 4, status: 429 }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 401 through the provider (no retry event, one fetch)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'bad key' } }), { status: 401 }))
    const provider = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    const drain = async () => {
      for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
    }
    await expect(drain()).rejects.toThrow(/bad key/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

const collect = async (iterable) => {
  const out = []
  for await (const event of iterable) out.push(event)
  return out
}

// undici's body read rejects this way when the socket closes mid-stream.
const terminated = () => new TypeError('terminated', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })

// Sends `text` (if any), then fails the next read with `error`.
const dyingBody = (text, error = terminated()) => {
  let sent = !text
  return new ReadableStream({
    pull(controller) {
      if (sent) controller.error(error)
      else {
        sent = true
        controller.enqueue(new TextEncoder().encode(text))
      }
    },
  })
}

const STREAMS = [
  {
    name: 'anthropic',
    config: { kind: 'anthropic', model: 'm' },
    metadata:
      `data: {"type":"message_start","message":{"usage":{"input_tokens":9}}}\n\n` +
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n` +
      `data: {"type":"ping"}\n\n`,
    content: `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n`,
    complete: `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n`,
  },
  {
    name: 'openai',
    config: { kind: 'openai', model: 'm' },
    metadata: `data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n`,
    content: `data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n`,
    complete: `data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`,
  },
  {
    name: 'responses',
    config: { kind: 'meta', model: 'muse-spark-1.3-contributor' },
    metadata:
      `data: {"type":"response.created","response":{"id":"r1"}}\n\n` +
      `data: {"type":"response.in_progress","response":{"id":"r1"}}\n\n` +
      `data: {"type":"response.output_item.added","item":{"id":"m1","type":"message"}}\n\n`,
    content: `data: {"type":"response.output_text.delta","delta":"Hi"}\n\n`,
    complete: `data: {"type":"response.output_text.delta","delta":"Hi"}\n\ndata: {"type":"response.completed"}\n\n`,
  },
]

describe.each(STREAMS)('$name: a stream that dies', ({ config, metadata, content, complete }) => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const send = () => {
    const provider = createProvider({ ...config, apiKey: 'k', baseUrl: 'https://relay.test' })
    const events = []
    const done = (async () => {
      for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
    })()
    done.catch(() => {})
    return { events, done }
  }

  it('before any event is retried, then completes', async () => {
    fetchMock.mockResolvedValueOnce(new Response(dyingBody(''))).mockResolvedValueOnce(new Response(sseBody(complete)))
    const { events, done } = send()
    await vi.advanceTimersByTimeAsync(30_000)
    await done
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retries = events.filter((e) => e.type === 'retry')
    expect(retries).toEqual([expect.objectContaining({ attempt: 1, maxAttempts: 4, status: null, reason: 'stream terminated before content (terminated)' })])
    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'Hi' }])
    expect(events.at(-1).type).toBe('done')
  })

  it('after only metadata events is retried, then completes', async () => {
    fetchMock.mockResolvedValueOnce(new Response(dyingBody(metadata))).mockResolvedValueOnce(new Response(sseBody(complete)))
    const { events, done } = send()
    await vi.advanceTimersByTimeAsync(30_000)
    await done
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(events.filter((e) => e.type === 'retry')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'Hi' }])
  })

  it('on a connection reset before content is retried too', async () => {
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    fetchMock.mockResolvedValueOnce(new Response(dyingBody(metadata, reset))).mockResolvedValueOnce(new Response(sseBody(complete)))
    const { done } = send()
    await vi.advanceTimersByTimeAsync(30_000)
    await done
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('after content is not retried and names the cut-off reply', async () => {
    fetchMock.mockResolvedValueOnce(new Response(dyingBody(metadata + content)))
    const { events, done } = send()
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(done).rejects.toThrow(/stream terminated after the reply began \(terminated\)/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(events.filter((e) => e.type === 'retry')).toEqual([])
  })

  it('every attempt gives up after the attempt budget', async () => {
    fetchMock.mockImplementation(async () => new Response(dyingBody(metadata)))
    const { events, done } = send()
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(done).rejects.toThrow(/stream terminated before content on all 4 attempts \(terminated\)/)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(events.filter((e) => e.type === 'retry').map((e) => e.attempt)).toEqual([1, 2, 3])
  })

  it('shares the attempt budget with retries before the response', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'service_overloaded' } }), { status: 503 }))
      .mockImplementation(async () => new Response(dyingBody('')))
    const { events, done } = send()
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(done).rejects.toThrow(/stream terminated before content/)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(events.filter((e) => e.type === 'retry').map((e) => [e.attempt, e.status])).toEqual([[1, 503], [2, null], [3, null]])
  })
})

describe('stream parsers', () => {
  it('anthropic: parses a recorded body without fetch', async () => {
    expect(await collect(parseAnthropicStream(sseBody(anthropicToolUse)))).toEqual([
      { type: 'tool_use', id: 'toolu_01', name: 'measure', input: { target: 'part1' } },
      { type: 'done', stopReason: 'tool_use' },
    ])
  })

  it('openai: parses a recorded body without fetch', async () => {
    const body =
      `data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n` +
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"measure","arguments":"{\\"target\\":\\"p\\"}"}}]}}]}\n\n` +
      `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n` +
      `data: [DONE]\n\n`
    expect(await collect(parseOpenAIStream(sseBody(body)))).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'tool_use', id: 'call_1', name: 'measure', input: { target: 'p' } },
      { type: 'done', stopReason: 'tool_calls' },
    ])
  })

  it('responses: parses a recorded body without fetch', async () => {
    const body =
      `data: {"type":"response.output_text.delta","delta":"Hi"}\n\n` +
      `data: {"type":"response.output_item.added","item":{"id":"item_1","type":"function_call","call_id":"call_1","name":"measure"}}\n\n` +
      `data: {"type":"response.function_call_arguments.delta","item_id":"item_1","delta":"{\\"target\\":\\"p\\"}"}\n\n` +
      `data: {"type":"response.completed"}\n\n`
    expect(await collect(parseResponsesStream(sseBody(body)))).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'tool_use', id: 'call_1', name: 'measure', input: { target: 'p' } },
      { type: 'done', stopReason: 'completed' },
    ])
  })

  it('yields streamed reasoning as reasoning events, apart from the reply text', async () => {
    const anthropic =
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n` +
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n` +
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"abc"}}\n\n` +
      `data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hi"}}\n\n` +
      `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n`
    const openai =
      `data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n` +
      `data: {"choices":[{"delta":{"reasoning":"ok"}}]}\n\n` +
      `data: {"choices":[{"delta":{"content":"Hi","reasoning_content":""}}]}\n\n` +
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
    const responses =
      `data: {"type":"response.reasoning_summary_text.delta","delta":"hmm"}\n\n` +
      `data: {"type":"response.reasoning_text.delta","delta":"ok"}\n\n` +
      `data: {"type":"response.output_text.delta","delta":"Hi"}\n\n` +
      `data: {"type":"response.completed"}\n\n`
    expect(await collect(parseAnthropicStream(sseBody(anthropic)))).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'text', text: 'Hi' },
      { type: 'done', stopReason: 'end_turn' },
    ])
    expect(await collect(parseOpenAIStream(sseBody(openai)))).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'reasoning', text: 'ok' },
      { type: 'text', text: 'Hi' },
      { type: 'done', stopReason: 'stop' },
    ])
    expect(await collect(parseResponsesStream(sseBody(responses)))).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'reasoning', text: 'ok' },
      { type: 'text', text: 'Hi' },
      { type: 'done', stopReason: 'completed' },
    ])
  })

  it('yields a refusal from each provider as a refusal event', async () => {
    // Meta's Responses API refuses with no deltas, only refusal content in the completed output.
    const completedRefusal =
      `data: {"type":"response.created","response":{"status":"in_progress","output":[]}}\n\n` +
      `data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"refusal","refusal":"I'm sorry, but I can't help with that request."}]}]}}\n\n` +
      `data: [DONE]\n\n`
    const streamedRefusal =
      `data: {"type":"response.refusal.delta","delta":"I can't "}\n\n` +
      `data: {"type":"response.refusal.delta","delta":"help."}\n\n` +
      `data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"refusal","refusal":"I can't help."}]}]}}\n\n`
    const openai =
      `data: {"choices":[{"delta":{"refusal":"I can't help."}}]}\n\n` +
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
    expect(await collect(parseResponsesStream(sseBody(completedRefusal)))).toEqual([
      { type: 'refusal', text: "I'm sorry, but I can't help with that request." },
      { type: 'done', stopReason: 'completed' },
    ])
    expect(await collect(parseResponsesStream(sseBody(streamedRefusal)))).toEqual([
      { type: 'refusal', text: "I can't " },
      { type: 'refusal', text: 'help.' },
      { type: 'done', stopReason: 'completed' },
    ])
    expect(await collect(parseOpenAIStream(sseBody(openai)))).toEqual([
      { type: 'refusal', text: "I can't help." },
      { type: 'done', stopReason: 'stop' },
    ])
  })

  it('openai: hands on arguments that are not JSON with their text and finish_reason, never throwing', async () => {
    const body =
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"measure","arguments":"{\\"parts\\":[\\"0\\"]}{\\"x"}}]}}]}\n\n` +
      `data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n` +
      `data: [DONE]\n\n`
    expect(await collect(parseOpenAIStream(sseBody(body)))).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'measure', input: {}, badArguments: '{"parts":["0"]}{"x', finishReason: 'length' },
      { type: 'done', stopReason: 'length' },
    ])
  })

  it('openai: keeps the first 300 characters of bad arguments, and names a missing finish_reason', async () => {
    const args = JSON.stringify('{' + 'a'.repeat(400)).slice(1, -1)
    const body = `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"run","arguments":"${args}"}}]}}]}\n\n`
    const [call] = await collect(parseOpenAIStream(sseBody(body)))
    expect(call.badArguments).toBe(`${'{' + 'a'.repeat(299)}… (101 more characters)`)
    expect(call.finishReason).toBeNull()
  })

  it('anthropic and responses: hand on bad arguments too', async () => {
    const anthropic =
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"check"}}\n\n` +
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"bed"}}\n\n` +
      `data: {"type":"content_block_stop","index":0}\n\n`
    expect(await collect(parseAnthropicStream(sseBody(anthropic)))).toEqual([{ type: 'tool_use', id: 't1', name: 'check', input: {}, badArguments: '{"bed' }])
    const responses =
      `data: {"type":"response.output_item.added","item":{"id":"i1","type":"function_call","call_id":"c1","name":"check"}}\n\n` +
      `data: {"type":"response.function_call_arguments.delta","item_id":"i1","delta":"{\\"bed"}\n\n` +
      `data: {"type":"response.completed"}\n\n`
    expect(await collect(parseResponsesStream(sseBody(responses)))).toEqual([
      { type: 'tool_use', id: 'c1', name: 'check', input: {}, badArguments: '{"bed' },
      { type: 'done', stopReason: 'completed' },
    ])
  })

  it('anthropic: yields usage from message_start and message_delta', async () => {
    const body =
      `data: {"type":"message_start","message":{"usage":{"input_tokens":42,"output_tokens":0}}}\n\n` +
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n` +
      `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n`
    expect(await collect(parseAnthropicStream(sseBody(body)))).toEqual([
      { type: 'usage', inputTokens: 42, outputTokens: null, reasoningTokens: null },
      { type: 'text', text: 'hi' },
      { type: 'usage', inputTokens: null, outputTokens: 7, reasoningTokens: null },
      { type: 'done', stopReason: 'end_turn' },
    ])
  })

  it('openai: yields usage from the final chunk', async () => {
    const body =
      `data: {"choices":[{"delta":{"content":"hi"}}]}\n\n` +
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\n` +
      `data: [DONE]\n\n`
    expect(await collect(parseOpenAIStream(sseBody(body)))).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'usage', inputTokens: 10, outputTokens: 3, reasoningTokens: null },
      { type: 'done', stopReason: 'stop' },
    ])
  })

  it('openai: yields reasoningTokens from usage.completion_tokens_details', async () => {
    const body =
      `data: {"choices":[{"delta":{"content":"hi"}}]}\n\n` +
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":23,"completion_tokens_details":{"reasoning_tokens":20}}}\n\n` +
      `data: [DONE]\n\n`
    expect(await collect(parseOpenAIStream(sseBody(body)))).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'usage', inputTokens: 10, outputTokens: 23, reasoningTokens: 20 },
      { type: 'done', stopReason: 'stop' },
    ])
  })

  it('openai: request body includes stream_options.include_usage', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody(`data: [DONE]\n\n`)))
    const provider = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true })
  })

  it('opencode-go chat-completions models: request body includes stream_options.include_usage', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody(`data: [DONE]\n\n`)))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'deepseek-v4.1-flash', baseUrl: 'https://relay.test' })
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true })
  })

  it('responses: yields usage from response.completed', async () => {
    const body =
      `data: {"type":"response.output_text.delta","delta":"hi"}\n\n` +
      `data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":2}}}\n\n`
    expect(await collect(parseResponsesStream(sseBody(body)))).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'usage', inputTokens: 5, outputTokens: 2, reasoningTokens: null },
      { type: 'done', stopReason: 'completed' },
    ])
  })

  it('responses: yields reasoningTokens from usage.output_tokens_details', async () => {
    const body =
      `data: {"type":"response.output_text.delta","delta":"hi"}\n\n` +
      `data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":30,"output_tokens_details":{"reasoning_tokens":25}}}}\n\n`
    expect(await collect(parseResponsesStream(sseBody(body)))).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'usage', inputTokens: 5, outputTokens: 30, reasoningTokens: 25 },
      { type: 'done', stopReason: 'completed' },
    ])
  })
})

describe('prior assistant turns without tool calls', () => {
  const messages = buildMessages({
    systemPrompt: 'S',
    transcript: [
      { role: 'user', content: 'a sphere' },
      { role: 'assistant', content: 'done' },
    ],
    message: 'bigger',
  })

  it.each([
    ['anthropic', { kind: 'anthropic', model: 'm' }, ''],
    ['openai', { kind: 'openai', model: 'm' }, `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`],
    ['opencode-go anthropic-protocol', { kind: 'opencode-go', model: 'minimax-m3' }, ''],
    ['opencode-go openai-protocol', { kind: 'opencode-go', model: 'deepseek-v4-flash' }, `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`],
    ['meta responses', { kind: 'meta', model: 'muse-spark-1.3-contributor' }, `data: {"type":"response.completed"}\n\n`],
  ])('%s: sends the prior assistant text without throwing', async (_name, config, body) => {
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const provider = createProvider({ ...config, apiKey: 'k', baseUrl: 'https://relay.test' })
    await expect((async () => {
      for await (const e of provider.send(messages, TOOLS)) void e
    })()).resolves.not.toThrow()
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const serialized = JSON.stringify(sentBody)
    expect(serialized).toContain('done')
  })
})

describe('chat id header', () => {
  it.each([
    ['anthropic', 'm'],
    ['openai', 'm'],
    ['meta', 'muse-spark-1.3'],
  ])('%s sends x-jscad-chat-id when chatId is set', async (kind, model) => {
    fetchMock.mockResolvedValue(new Response(sseBody('')))
    const provider = createProvider({ kind, apiKey: 'k', model, baseUrl: 'https://relay.test', chatId: 'chat-1' })
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) void e
    expect(fetchMock.mock.calls[0][1].headers['x-jscad-chat-id']).toBe('chat-1')
  })

  it('omits x-jscad-chat-id without a chatId', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody('')))
    const provider = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) void e
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-jscad-chat-id')
  })
})
