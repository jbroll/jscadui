// packages/agent-loop/test/providers.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProvider } from '../src/providers.js'

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
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/messages',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events).toEqual([])
  })
})
