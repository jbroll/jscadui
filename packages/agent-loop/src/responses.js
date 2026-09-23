// OpenAI Responses API adapter (`/v1/responses`). Some Go models (Muse Spark,
// Grok, GPT Luna) are served here instead of `/v1/chat/completions`. Shape
// follows the public Responses API; verified against mocks only until budget
// allows a live run.
import { PROVIDER_BASE_URLS, ssePayloads } from './providers.js'

const toResponsesTool = (tool) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: tool.inputSchema,
})

const toResponsesInput = (messages) => {
  const input = []
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

export const responsesProvider = (config) => {
  const sessionId = config.sessionId ?? crypto.randomUUID()
  return {
    async *send(messages, tools) {
      const body = {
        model: config.model,
        stream: true,
        input: toResponsesInput(messages),
      }
      if (tools.length > 0) body.tools = tools.map(toResponsesTool)
      const headers = {
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
      const calls = new Map()
      for await (const payload of ssePayloads(res.body)) {
        let event
        try {
          event = JSON.parse(payload)
        } catch {
          continue
        }
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          yield { type: 'text', text: event.delta }
        } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
          calls.set(event.item.id, { id: event.item.call_id ?? event.item.id, name: event.item.name ?? '', args: '' })
        } else if (event.type === 'response.function_call_arguments.delta') {
          const acc = calls.get(event.item_id) ?? { id: event.item_id, name: '', args: '' }
          acc.args += event.delta ?? ''
          calls.set(event.item_id, acc)
        } else if (event.type === 'response.completed') {
          break
        } else if (event.type === 'response.failed') {
          throw new Error(`responses: ${event.response?.error?.message ?? 'response failed'}`)
        } else if (event.type === 'response.incomplete') {
          throw new Error(`responses: incomplete (${event.response?.incomplete_details?.reason ?? 'unknown reason'})`)
        } else if (event.type === 'error') {
          throw new Error(`responses: ${event.message ?? 'provider error'}`)
        }
      }
      for (const acc of calls.values()) {
        let input
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
