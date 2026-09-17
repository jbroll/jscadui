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
})
