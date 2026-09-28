// packages/agent-loop/src/providers.js
// Provider adapters over fetch. baseUrl points at the relay, which proxies
// path-preserving to the provider host, so no relay-specific code lives here.
// Anthropic default base is the provider itself for non-browser use.
import { responsesProvider } from './responses.js'

const ANTHROPIC_API_VERSION = '2023-06-01'

export const PROVIDER_BASE_URLS = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'opencode-go': 'https://opencode.ai/zen/go',
  // Meta Model API host; adapters append /v1/responses, /v1/chat/completions,
  // or /v1/messages, matching Meta's documented surfaces.
  meta: 'https://api.meta.ai',
}

// Go serves these models on other protocols; route by model id.
export const RESPONSES_MODELS = new Set(['grok-4.6', 'gpt-5.6-luna', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor', 'muse-spark-1.3'])
export const MESSAGES_MODELS = new Set(['minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus'])

// Yields every `data:` payload of an SSE stream.
export async function* ssePayloads(body) {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
  if (buffer.startsWith('data:')) yield buffer.slice(5).trim()
}

const toAnthropicMessage = (message) => {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }],
    }
  }
  if (message.role === 'assistant') {
    const content = []
    if (message.content) content.push({ type: 'text', text: message.content })
    for (const call of message.toolCalls ?? []) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
    }
    return { role: 'assistant', content }
  }
  return { role: message.role, content: message.content }
}

const toAnthropicTool = (tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })

export async function* parseAnthropicStream(body) {
  // Tool input JSON arrives split across input_json_delta events; hold it per block until stop.
  const toolInputs = new Map()
  for await (const payload of ssePayloads(body)) {
    let event
    try {
      event = JSON.parse(payload)
    } catch {
      continue
    }
    if (event.type === 'message_start') {
      const inputTokens = event.message?.usage?.input_tokens
      if (typeof inputTokens === 'number') yield { type: 'usage', inputTokens, outputTokens: null, reasoningTokens: null }
    } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      toolInputs.set(event.index ?? 0, {
        id: event.content_block.id ?? '',
        name: event.content_block.name ?? '',
        json: '',
      })
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const text = event.delta.text
      if (typeof text === 'string') yield { type: 'text', text }
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const acc = toolInputs.get(event.index ?? 0)
      if (acc) acc.json += event.delta.partial_json ?? ''
    } else if (event.type === 'content_block_stop') {
      const acc = toolInputs.get(event.index ?? 0)
      if (acc) {
        toolInputs.delete(event.index ?? 0)
        let input
        try {
          input = JSON.parse(acc.json || '{}')
        } catch {
          throw new Error(`anthropic: unparseable tool input for ${acc.name}`)
        }
        yield { type: 'tool_use', id: acc.id, name: acc.name, input }
      }
    } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
      const outputTokens = event.usage?.output_tokens
      if (typeof outputTokens === 'number') yield { type: 'usage', inputTokens: null, outputTokens, reasoningTokens: null }
      yield { type: 'done', stopReason: event.delta.stop_reason }
    } else if (event.type === 'error') {
      throw new Error(`anthropic: ${event.error?.message ?? 'provider error'}`)
    }
  }
}

const anthropicProvider = (config) => {
  const sessionId = config.sessionId ?? crypto.randomUUID()
  return {
    async *send(messages, tools) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      const body = {
        model: config.model,
        max_tokens: 4096,
        stream: true,
        messages: messages.filter((m) => m.role !== 'system').map(toAnthropicMessage),
      }
      if (system) body.system = system
      if (tools.length > 0) body.tools = tools.map(toAnthropicTool)
      if (config.effort) body.output_config = { effort: config.effort }
      const headers = {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      }
      if (config.kind === 'opencode-go') headers['x-opencode-session'] = sessionId
      if (config.chatId) headers['x-jscad-chat-id'] = config.chatId
      const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind] ?? PROVIDER_BASE_URLS.anthropic}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(`anthropic: ${detail} (status ${res.status})`)
      }
      yield* parseAnthropicStream(res.body)
    },
  }
}

const toOpenAIMessage = (message) => {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
  if (message.role === 'assistant' && (message.toolCalls ?? []).length > 0) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      })),
    }
  }
  return { role: message.role, content: message.content }
}

const toOpenAITool = (tool) => ({
  type: 'function',
  function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
})

export async function* parseOpenAIStream(body) {
  // Function arguments arrive split across chunks; hold each tool call by index until done.
  const toolCalls = new Map()
  let stopReason = ''
  let usage = null
  for await (const payload of ssePayloads(body)) {
    if (payload === '[DONE]') break
    let chunk
    try {
      chunk = JSON.parse(payload)
    } catch {
      continue
    }
    const choice = chunk.choices?.[0]
    const delta = choice?.delta ?? {}
    if (typeof delta.content === 'string' && delta.content !== '') {
      yield { type: 'text', text: delta.content }
    }
    if (delta.tool_calls) {
      for (const call of delta.tool_calls) {
        const acc = toolCalls.get(call.index ?? 0) ?? { id: '', name: '', args: '' }
        if (call.id) acc.id = call.id
        if (call.function?.name) acc.name = call.function.name
        if (call.function?.arguments) acc.args += call.function.arguments
        toolCalls.set(call.index ?? 0, acc)
      }
    }
    if (choice?.finish_reason) stopReason = choice.finish_reason
    if (chunk.usage) usage = chunk.usage
  }
  if (usage) {
    yield {
      type: 'usage',
      inputTokens: usage.prompt_tokens ?? null,
      outputTokens: usage.completion_tokens ?? null,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
    }
  }
  for (const acc of toolCalls.values()) {
    let input
    try {
      input = JSON.parse(acc.args || '{}')
    } catch {
      throw new Error(`openai: unparseable tool arguments for ${acc.name}`)
    }
    yield { type: 'tool_use', id: acc.id, name: acc.name, input }
  }
  yield { type: 'done', stopReason: stopReason || 'stop' }
}

const openaiProvider = (config) => {
  const sessionId = config.sessionId ?? crypto.randomUUID()
  return {
    async *send(messages, tools) {
      const body = {
        model: config.model,
        stream: true,
        messages: messages.map(toOpenAIMessage),
      }
      if (tools.length > 0) body.tools = tools.map(toOpenAITool)
      if (config.effort) body.reasoning_effort = config.effort
      if (config.kind === 'openai' || config.kind === 'opencode-go') body.stream_options = { include_usage: true }
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      }
      if (config.kind === 'opencode-go') headers['x-opencode-session'] = sessionId
      if (config.chatId) headers['x-jscad-chat-id'] = config.chatId
      const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind]}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(`openai: ${detail} (status ${res.status})`)
      }
      yield* parseOpenAIStream(res.body)
    },
  }
}

/**
 * @param {{kind:'anthropic'|'openai'|'opencode-go'|'meta',apiKey:string,model:string,baseUrl?:string,sessionId?:string,effort?:string,chatId?:string}} config
 */
export const createProvider = (config) => {
  if (!config.apiKey) throw new Error('createProvider: apiKey is required')
  switch (config.kind) {
    case 'anthropic':
      return anthropicProvider(config)
    case 'openai':
      return openaiProvider(config)
    case 'opencode-go':
    case 'meta':
      if (RESPONSES_MODELS.has(config.model)) return responsesProvider(config)
      if (MESSAGES_MODELS.has(config.model)) return anthropicProvider(config)
      return openaiProvider(config)
    default:
      throw new Error(`createProvider: unknown kind '${config.kind}'`)
  }
}
