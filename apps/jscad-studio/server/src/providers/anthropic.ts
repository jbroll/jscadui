import type { Provider, ProviderConfig, ProviderMessage, ToolDefinition } from './types.js'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

// Yields every `data:` payload of an SSE stream; `event:` names and blank separators are noise.
async function* ssePayloads(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
  if (buffer.startsWith('data:')) yield buffer.slice(5).trim()
}

function toAnthropicMessage(message: ProviderMessage) {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }],
    }
  }
  if (message.role === 'assistant') {
    const content: unknown[] = []
    if (message.content) content.push({ type: 'text', text: message.content })
    for (const call of message.toolCalls) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
    }
    return { role: 'assistant', content }
  }
  return { role: message.role, content: message.content }
}

function toAnthropicTool(tool: ToolDefinition) {
  return { name: tool.name, description: tool.description, input_schema: tool.inputSchema }
}

interface StreamEvent {
  type?: string
  index?: number
  content_block?: { type?: string; id?: string; name?: string }
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
  error?: { message?: string }
}

export function anthropicProvider(config: ProviderConfig): Provider {
  return {
    async *send(messages, tools) {
      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: 4096,
        stream: true,
        messages: messages.map(toAnthropicMessage),
      }
      if (tools.length > 0) body.tools = tools.map(toAnthropicTool)

      const res = await fetch(`${config.baseUrl ?? DEFAULT_BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(`anthropic: ${detail} (status ${res.status})`)
      }

      // Tool input JSON arrives split across input_json_delta events; hold it per block until stop.
      const toolInputs = new Map<number, { id: string; name: string; json: string }>()
      for await (const payload of ssePayloads(res.body)) {
        let event: StreamEvent
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
            let input: unknown
            try {
              input = JSON.parse(acc.json || '{}')
            } catch {
              throw new Error(`anthropic: unparseable tool input for ${acc.name}`)
            }
            yield { type: 'tool_use', id: acc.id, name: acc.name, input }
          }
        } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
          const stopReason = event.delta.stop_reason
          yield { type: 'done', stopReason }
        } else if (event.type === 'error') {
          throw new Error(`anthropic: ${event.error?.message ?? 'provider error'}`)
        }
      }
    },
  }
}