import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProvider,
  type Provider,
  type ProviderEvent,
  type ProviderKind,
  type ProviderMessage,
  type ToolDefinition,
} from '../src/providers/types.js'

const TOOLS: ToolDefinition[] = [
  {
    name: 'measure',
    description: 'Measure the current model',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target'],
    },
  },
]

const MESSAGES: ProviderMessage[] = [{ role: 'user', content: 'Measure part1' }]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Recorded streaming fixtures — tests never touch the network.

function anthropicEvent(json: { type: string } & Record<string, unknown>): string {
  return `event: ${json.type}\ndata: ${JSON.stringify(json)}\n\n`
}

function openaiChunk(json: unknown): string {
  return `data: ${JSON.stringify(json)}\n\n`
}

const ANTHROPIC_PLAIN =
  anthropicEvent({
    type: 'message_start',
    message: { id: 'msg_01', type: 'message', role: 'assistant', content: [], stop_reason: null },
  }) +
  anthropicEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
  anthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Hello' },
  }) +
  anthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: ' there' },
  }) +
  anthropicEvent({ type: 'content_block_stop', index: 0 }) +
  anthropicEvent({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 4 },
  }) +
  anthropicEvent({ type: 'message_stop' })

const ANTHROPIC_ONE_TOOL =
  anthropicEvent({
    type: 'message_start',
    message: { id: 'msg_02', type: 'message', role: 'assistant', content: [], stop_reason: null },
  }) +
  anthropicEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id: 'toolu_01', name: 'measure', input: {} },
  }) +
  anthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '{"target":"' },
  }) +
  anthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: 'part1"}' },
  }) +
  anthropicEvent({ type: 'content_block_stop', index: 0 }) +
  anthropicEvent({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }) +
  anthropicEvent({ type: 'message_stop' })

const ANTHROPIC_TWO_TOOLS =
  anthropicEvent({
    type: 'message_start',
    message: { id: 'msg_03', type: 'message', role: 'assistant', content: [], stop_reason: null },
  }) +
  anthropicEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id: 'toolu_01', name: 'measure', input: {} },
  }) +
  anthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '{"target":"part1"}' },
  }) +
  anthropicEvent({ type: 'content_block_stop', index: 0 }) +
  anthropicEvent({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 'toolu_02', name: 'check', input: {} },
  }) +
  anthropicEvent({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"bed":"mk3"}' },
  }) +
  anthropicEvent({ type: 'content_block_stop', index: 1 }) +
  anthropicEvent({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }) +
  anthropicEvent({ type: 'message_stop' })

const ANTHROPIC_TOOL_ERROR = JSON.stringify({
  type: 'error',
  error: { type: 'invalid_request_error', message: 'tools are not supported by this model' },
})

const OPENAI_PLAIN =
  openaiChunk({
    id: 'chatcmpl_01',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'Hi' }, finish_reason: null }],
  }) +
  openaiChunk({
    id: 'chatcmpl_01',
    choices: [{ index: 0, delta: { content: ' there' }, finish_reason: null }],
  }) +
  openaiChunk({
    id: 'chatcmpl_01',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  }) +
  'data: [DONE]\n\n'

const OPENAI_ONE_TOOL =
  openaiChunk({
    id: 'chatcmpl_02',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: 'call_01', type: 'function', function: { name: 'measure', arguments: '' } },
          ],
        },
        finish_reason: null,
      },
    ],
  }) +
  openaiChunk({
    id: 'chatcmpl_02',
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"target":"part1"}' } }] },
        finish_reason: null,
      },
    ],
  }) +
  openaiChunk({
    id: 'chatcmpl_02',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  }) +
  'data: [DONE]\n\n'

const OPENAI_TWO_TOOLS =
  openaiChunk({
    id: 'chatcmpl_03',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: 'call_01', type: 'function', function: { name: 'measure', arguments: '' } },
            { index: 1, id: 'call_02', type: 'function', function: { name: 'check', arguments: '' } },
          ],
        },
        finish_reason: null,
      },
    ],
  }) +
  openaiChunk({
    id: 'chatcmpl_03',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, function: { arguments: '{"target":"part1"}' } },
            { index: 1, function: { arguments: '{"bed":"mk3"}' } },
          ],
        },
        finish_reason: null,
      },
    ],
  }) +
  openaiChunk({
    id: 'chatcmpl_03',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  }) +
  'data: [DONE]\n\n'

const OPENAI_TOOL_ERROR = JSON.stringify({
  error: { message: 'Unrecognized request argument supplied: tools', type: 'invalid_request_error' },
})

function streamResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function collect(provider: Provider): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = []
  for await (const event of provider.send(MESSAGES, TOOLS)) events.push(event)
  return events
}

describe('createProvider', () => {
  it('throws on an unknown kind', () => {
    expect(() =>
      createProvider({ kind: 'gemini' as ProviderKind, apiKey: 'sk-test', model: 'x' }),
    ).toThrow(/kind/)
  })

  it('opencode-go posts to the Zen URL through the openai adapter', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(OPENAI_PLAIN))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'sk-test', model: 'deepseek-v4-flash' })
    await collect(provider)
    expect(fetchMock.mock.calls[0][0]).toBe('https://opencode.ai/zen/go/v1/chat/completions')
  })

  it('an explicit baseUrl overrides the lookup table', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(OPENAI_PLAIN))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'sk-test', model: 'm', baseUrl: 'https://provider.test' })
    await collect(provider)
    expect(fetchMock.mock.calls[0][0]).toBe('https://provider.test/v1/chat/completions')
  })

  it('throws when the apiKey is missing', () => {
    expect(() => createProvider({ kind: 'openai', model: 'm', baseUrl: 'https://provider.test' })).toThrow(/apiKey/)
  })

  it('opencode-go sends a stable session header that openai omits', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(streamResponse(OPENAI_PLAIN)))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'sk-test', model: 'm' })
    await collect(provider)
    await collect(provider)
    const first = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers['x-opencode-session']
    expect(typeof first).toBe('string')
    expect((fetchMock.mock.calls[1][1] as { headers: Record<string, string> }).headers['x-opencode-session']).toBe(first)
    const plain = createProvider({ kind: 'openai', apiKey: 'sk-test', model: 'm', baseUrl: 'https://provider.test' })
    await collect(plain)
    expect((fetchMock.mock.calls[2][1] as { headers: Record<string, string> }).headers['x-opencode-session']).toBeUndefined()
  })

  it('opencode-go routes spark models to the responses endpoint', async () => {
    const spark =
      openaiChunk({ type: 'response.output_text.delta', delta: 'Hi' }) +
      openaiChunk({
        type: 'response.output_item.added',
        item: { id: 'item_1', type: 'function_call', call_id: 'call_1', name: 'measure' },
      }) +
      openaiChunk({ type: 'response.function_call_arguments.delta', item_id: 'item_1', delta: '{"target":"part1"}' }) +
      openaiChunk({ type: 'response.completed' })
    fetchMock.mockResolvedValueOnce(streamResponse(spark))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'sk-test', model: 'muse-spark-1.3-contributor' })
    const events = await collect(provider)
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe('https://opencode.ai/zen/go/v1/responses')
    expect(init.headers['x-opencode-session']).toEqual(expect.any(String))
    expect(JSON.parse(init.body).model).toBe('muse-spark-1.3-contributor')
    expect(events).toContainEqual({ type: 'text', text: 'Hi' })
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'measure', input: { target: 'part1' } })
    expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'completed' })
  })

  it('opencode-go routes qwen models to the messages endpoint', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(ANTHROPIC_PLAIN))
    const provider = createProvider({ kind: 'opencode-go', apiKey: 'sk-test', model: 'qwen3.8-flash' })
    await collect(provider)
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://opencode.ai/zen/go/v1/messages')
    expect(init.headers['x-opencode-session']).toEqual(expect.any(String))
  })
})

describe('anthropic provider', () => {
  const provider = createProvider({ kind: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-5' })

  it('streams a plain answer as text events then done', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(ANTHROPIC_PLAIN))

    expect(await collect(provider)).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' there' },
      { type: 'done', stopReason: 'end_turn' },
    ])
  })

  it('emits one tool_use event for a tool request', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(ANTHROPIC_ONE_TOOL))

    expect(await collect(provider)).toEqual([
      { type: 'tool_use', id: 'toolu_01', name: 'measure', input: { target: 'part1' } },
      { type: 'done', stopReason: 'tool_use' },
    ])
  })

  it('emits two tool_use events when a turn requests two tools', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(ANTHROPIC_TWO_TOOLS))

    expect(await collect(provider)).toEqual([
      { type: 'tool_use', id: 'toolu_01', name: 'measure', input: { target: 'part1' } },
      { type: 'tool_use', id: 'toolu_02', name: 'check', input: { bed: 'mk3' } },
      { type: 'done', stopReason: 'tool_use' },
    ])
  })

  it('surfaces a tool-capability error naming the provider instead of continuing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(ANTHROPIC_TOOL_ERROR, { status: 400 }))

    await expect(collect(provider)).rejects.toThrow(/anthropic/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws when the stream reports an error mid-turn', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse(
        anthropicEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
          anthropicEvent({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'sorry' },
          }) +
          anthropicEvent({
            type: 'error',
            error: { type: 'overloaded_error', message: 'overloaded' },
          }),
      ),
    )

    await expect(collect(provider)).rejects.toThrow(/anthropic/)
  })

  it('posts messages and tools to the messages endpoint with the api key', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(ANTHROPIC_PLAIN))
    await collect(provider)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('sk-test')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')

    const body = JSON.parse(init.body)
    expect(body.model).toBe('claude-sonnet-4-5')
    expect(body.stream).toBe(true)
    expect(body.messages).toEqual([{ role: 'user', content: 'Measure part1' }])
    expect(body.tools[0]).toEqual({
      name: 'measure',
      description: 'Measure the current model',
      input_schema: TOOLS[0].inputSchema,
    })
  })
})

describe('openai provider', () => {
  const provider = createProvider({
    kind: 'openai',
    apiKey: 'sk-test',
    model: 'gpt-4o',
    baseUrl: 'https://provider.test',
  })

  it('streams a plain answer as text events then done', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(OPENAI_PLAIN))

    expect(await collect(provider)).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'text', text: ' there' },
      { type: 'done', stopReason: 'stop' },
    ])
  })

  it('emits one tool_use event for a tool request', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(OPENAI_ONE_TOOL))

    expect(await collect(provider)).toEqual([
      { type: 'tool_use', id: 'call_01', name: 'measure', input: { target: 'part1' } },
      { type: 'done', stopReason: 'tool_calls' },
    ])
  })

  it('emits two tool_use events when a turn requests two tools', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(OPENAI_TWO_TOOLS))

    expect(await collect(provider)).toEqual([
      { type: 'tool_use', id: 'call_01', name: 'measure', input: { target: 'part1' } },
      { type: 'tool_use', id: 'call_02', name: 'check', input: { bed: 'mk3' } },
      { type: 'done', stopReason: 'tool_calls' },
    ])
  })

  it('surfaces a tool-capability error naming the provider instead of continuing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(OPENAI_TOOL_ERROR, { status: 400 }))

    await expect(collect(provider)).rejects.toThrow(/openai/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('posts messages and tools to the chat completions endpoint with the api key', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(OPENAI_PLAIN))
    await collect(provider)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://provider.test/v1/chat/completions')
    expect(init.headers.authorization).toBe('Bearer sk-test')

    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-4o')
    expect(body.stream).toBe(true)
    expect(body.messages).toEqual([{ role: 'user', content: 'Measure part1' }])
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'measure',
        description: 'Measure the current model',
        parameters: TOOLS[0].inputSchema,
      },
    })
  })
})
