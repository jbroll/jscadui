import { PROVIDER_BASE_URLS, ssePayloads } from './types.js'
import type { Provider, ProviderConfig, ProviderMessage, ToolDefinition } from './types.js'

function toOpenAIMessage(message: ProviderMessage) {
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

function toOpenAITool(tool: ToolDefinition) {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

export function openaiProvider(config: ProviderConfig): Provider {
  return {
    async *send(messages, tools) {
      const body: Record<string, unknown> = {
        model: config.model,
        stream: true,
        messages: messages.map(toOpenAIMessage),
      }
      if (tools.length > 0) body.tools = tools.map(toOpenAITool)

      const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind]}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(`openai: ${detail} (status ${res.status})`)
      }

      // Function arguments arrive split across chunks; hold each tool call by index until done.
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      let stopReason = ''
      for await (const payload of ssePayloads(res.body)) {
        if (payload === '[DONE]') break
        let chunk: StreamChunk
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
        let input: unknown
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
