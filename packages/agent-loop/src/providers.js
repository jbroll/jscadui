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
}

// Go serves these models on other protocols; route by model id.
export const RESPONSES_MODELS = new Set(['grok-4.6', 'gpt-5.6-luna', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor'])
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
    for (const call of message.toolCalls) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
    }
    return { role: 'assistant', content }
  }
  return { role: message.role, content: message.content }
}

const toAnthropicTool = (tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })

const anthropicProvider = (config) => {
  const sessionId = config.sessionId ?? crypto.randomUUID()
  return {
    async *send(messages, tools) {
    const body = {
      model: config.model,
      max_tokens: 4096,
      stream: true,
      messages: messages.map(toAnthropicMessage),
    }
    if (tools.length > 0) body.tools = tools.map(toAnthropicTool)
    const headers = {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    }
    if (config.kind === 'opencode-go') headers['x-opencode-session'] = sessionId
    const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind] ?? PROVIDER_BASE_URLS.anthropic}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`anthropic: ${detail} (status ${res.status})`)
    }
    // Tool input JSON arrives split across input_json_delta events; hold it per block until stop.
    const toolInputs = new Map()
    for await (const payload of ssePayloads(res.body)) {
      let event
      try {
        event = JSON.parse(payload)
      } catch {
        continue
      }
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
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
        yield { type: 'done', stopReason: event.delta.stop_reason }
      } else if (event.type === 'error') {
        throw new Error(`anthropic: ${event.error?.message ?? 'provider error'}`)
      }
    }
    },
  }
}

const toOpenAIMessage = (message) => {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
  if (message.role === 'assistant' && message.toolCalls.length > 0) {
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
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    }
    if (config.kind === 'opencode-go') headers['x-opencode-session'] = sessionId
    const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind]}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`openai: ${detail} (status ${res.status})`)
    }
    // Function arguments arrive split across chunks; hold each tool call by index until done.
    const toolCalls = new Map()
    let stopReason = ''
    for await (const payload of ssePayloads(res.body)) {
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
    },
  }
}

/**
 * @param {{kind:'anthropic'|'openai'|'opencode-go',apiKey:string,model:string,baseUrl?:string,sessionId?:string}} config
 */
export const createProvider = (config) => {
  if (!config.apiKey) throw new Error('createProvider: apiKey is required')
  switch (config.kind) {
    case 'anthropic':
      return anthropicProvider(config)
    case 'openai':
      return openaiProvider(config)
    case 'opencode-go':
      if (RESPONSES_MODELS.has(config.model)) return responsesProvider(config)
      if (MESSAGES_MODELS.has(config.model)) return anthropicProvider(config)
      return openaiProvider(config)
    default:
      throw new Error(`createProvider: unknown kind '${config.kind}'`)
  }
}
