import { parseAnthropicStream, parseOpenAIStream } from '../src/providers.js'
import { parseResponsesStream } from '../src/responses.js'

const parseArgs = (text) => {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return { unparsed: text }
  }
}

const blocksText = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')

const fromAnthropic = (request) => {
  const out = []
  if (request.system) out.push({ role: 'system', content: typeof request.system === 'string' ? request.system : blocksText(request.system) })
  for (const m of request.messages ?? []) {
    if (typeof m.content === 'string') {
      out.push(m.role === 'assistant' ? { role: 'assistant', content: m.content, toolCalls: [] } : { role: m.role, content: m.content })
    } else if (m.role === 'assistant') {
      const toolCalls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }))
      out.push({ role: 'assistant', content: blocksText(m.content) || null, toolCalls })
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          out.push({ role: 'tool', toolCallId: b.tool_use_id, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) })
        } else if (b.type === 'text') {
          out.push({ role: 'user', content: b.text })
        }
      }
    }
  }
  return out
}

const fromOpenAI = (request) =>
  (request.messages ?? []).map((m) => {
    if (m.role === 'tool') return { role: 'tool', toolCallId: m.tool_call_id, content: m.content }
    if (m.role === 'assistant') {
      const toolCalls = (m.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }))
      return { role: 'assistant', content: m.content ?? null, toolCalls }
    }
    return { role: m.role, content: m.content }
  })

const fromResponses = (request) => {
  const out = []
  if (request.instructions) out.push({ role: 'system', content: request.instructions })
  for (const item of request.input ?? []) {
    if (item.type === 'function_call_output') {
      out.push({ role: 'tool', toolCallId: item.call_id, content: item.output })
    } else if (item.type === 'function_call') {
      const call = { id: item.call_id, name: item.name, input: parseArgs(item.arguments) }
      const last = out.at(-1)
      if (last?.role === 'assistant') last.toolCalls.push(call)
      else out.push({ role: 'assistant', content: null, toolCalls: [call] })
    } else if (item.role === 'assistant') {
      out.push({ role: 'assistant', content: item.content, toolCalls: [] })
    } else {
      out.push({ role: item.role, content: item.content })
    }
  }
  return out
}

export const protocolOf = (path) => {
  if (path.endsWith('v1/messages')) return 'anthropic'
  if (path.endsWith('v1/chat/completions')) return 'openai'
  if (path.endsWith('v1/responses')) return 'responses'
  return null
}

const READERS = { anthropic: fromAnthropic, openai: fromOpenAI, responses: fromResponses }
const PARSERS = { anthropic: parseAnthropicStream, openai: parseOpenAIStream, responses: parseResponsesStream }

export const requestMessages = (record) => READERS[protocolOf(record.path)]?.(record.request) ?? []

// The prompt's own first `## ` heading names the style it teaches
// (packages/agent-loop/prompt/fluent.md, modeling.md); a log from before the
// two-style split carries the older prompt that taught both, and matches
// neither.
const STYLE_HEADINGS = {
  fluent: /^## jscad-fluent style$/m,
  modeling: /^## @jscad\/modeling style$/m,
}

export const apiStyleOf = (record) => {
  const system = requestMessages(record).find((m) => m.role === 'system')?.content
  if (typeof system !== 'string') return 'unknown'
  const matches = Object.keys(STYLE_HEADINGS).filter((api) => STYLE_HEADINGS[api].test(system))
  return matches.length === 1 ? matches[0] : 'unknown'
}

export const responseMessage = async (record) => {
  const parse = PARSERS[protocolOf(record.path)]
  if (!parse || record.status >= 400) return { error: record.response }
  const text = []
  const toolCalls = []
  try {
    for await (const event of parse(new Response(record.response).body)) {
      if (event.type === 'text') text.push(event.text)
      else if (event.type === 'tool_use') toolCalls.push({ id: event.id, name: event.name, input: event.input })
    }
  } catch (err) {
    return { error: err.message }
  }
  return { message: { role: 'assistant', content: text.join('') || null, toolCalls } }
}
