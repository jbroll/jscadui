import { PROVIDER_BASE_URLS, ssePayloads } from './types.js'
import type { Provider, ProviderConfig, ProviderMessage, ToolDefinition } from './types.js'

function toResponsesTool(tool: ToolDefinition) {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }
}

function toResponsesInput(messages: ProviderMessage[]) {
  const input: unknown[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content })
    } else if (message.role === 'assistant') {
      if (message.content) input.push({ role: 'assistant', content: message.content })
      for (const call of message.toolCalls ?? []) {
        input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.input) })
      }
    } else {
      input.push({ role: message.role, content: message.content })
    }
  }
  return input
}

interface ResponsesEvent {
  type?: string
  delta?: string
  item_id?: string
  item?: { id?: string; type?: string; call_id?: string; name?: string }
}

export function responsesProvider(config: ProviderConfig): Provider {
  const sessionId = config.sessionId ?? crypto.randomUUID()
  return {
    async *send(messages, tools) {
      const body: Record<string, unknown> = {
        model: config.model,
        stream: true,
        input: toResponsesInput(messages),
      }
      if (tools.length > 0) body.tools = tools.map(toResponsesTool)

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      }
      if (config.kind === 'opencode-go') headers['x-opencode-session'] = sessionId

      const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind]}/v1/responses`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(`responses: ${detail} (status ${res.status})`)
      }
      const calls = new Map<string, { id: string; name: string; args: string }>()
      for await (const payload of ssePayloads(res.body)) {
        let event: ResponsesEvent
        try {
          event = JSON.parse(payload)
        } catch {
          continue
        }
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          yield { type: 'text', text: event.delta }
        } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
          calls.set(event.item.id ?? '', {
            id: event.item.call_id ?? event.item.id ?? '',
            name: event.item.name ?? '',
            args: '',
          })
        } else if (event.type === 'response.function_call_arguments.delta') {
          const key = event.item_id ?? ''
          const acc = calls.get(key) ?? { id: key, name: '', args: '' }
          acc.args += event.delta ?? ''
          calls.set(key, acc)
        } else if (event.type === 'response.completed') {
          break
        }
      }
      for (const acc of calls.values()) {
        let input: unknown
        try {
          input = JSON.parse(acc.args || '{}')
        } catch {
          throw new Error(`responses: unparseable tool arguments for ${acc.name}`)
        }
        yield { type: 'tool_use', id: acc.id, name: acc.name, input }
      }
      yield { type: 'done', stopReason: 'completed' }
    },
  }
}
