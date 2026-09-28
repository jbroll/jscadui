// packages/agent-loop/test/providers.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProvider, parseAnthropicStream, parseOpenAIStream } from '../src/providers.js'
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
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual({ effort: 'low' })
  })

  it('meta chat path: maps effort to reasoning_effort', async () => {
    const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const p = createProvider({ kind: 'meta', apiKey: 'k', model: 'some-chat-model', effort: 'xhigh' })
    for await (const e of p.send([{ role: 'user', content: 'hi' }], [])) void e
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('xhigh')
  })
})

const collect = async (iterable) => {
  const out = []
  for await (const event of iterable) out.push(event)
  return out
}

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
