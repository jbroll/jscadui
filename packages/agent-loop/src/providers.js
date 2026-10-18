// packages/agent-loop/src/providers.js
// Provider adapters over fetch. baseUrl points at the relay, which proxies
// path-preserving to the provider host, so no relay-specific code lives here.
// Anthropic default base is the provider itself for non-browser use.
import { responsesProvider } from './responses.js'
import { parseToolArguments } from './toolArguments.js'

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

// Models known to read images, so the loop may offer them `view`. This table
// answers first; a model it does not list is offered the tool only when its
// provider's own model metadata reports `vision: true` (the app carries that on
// the selection, the eval reads `vision` in eval/models.json), so metadata can
// add the tool but never silently take it away from a known-vision model. A
// text-only model here would get images it cannot read.
export const VISION_MODELS = new Set([
  'grok-4.6',
  'gpt-5.6-luna',
  'claude-sonnet-4-5',
  'gpt-4o',
  'muse-spark-1.3',
  'muse-spark-1.3-contributor',
  'muse-spark-1.2-contributor',
  'qwen3.8-max',
  'qwen3.8-flash',
])

// Provider error bodies that mean "try again", across Anthropic/OpenAI/relay
// shapes (`error.type` or `error.code`).
const RETRYABLE_ERROR_CODES = new Set([
  'service_overloaded',
  'overloaded_error',
  'rate_limit_exceeded',
  'rate_limit_error',
  'server_error',
  'internal_server_error',
])

// Exponential backoff before retries 2/3/4; retry 1 is immediate (the first attempt).
const RETRY_BACKOFF_MS = [2000, 5000, 12000]
const MAX_RETRY_DELAY_MS = 30_000
export const MAX_PROVIDER_ATTEMPTS = RETRY_BACKOFF_MS.length + 1

// +/-20% so concurrent retries don't all land on the same tick.
const jittered = (ms) => Math.round(ms * (0.8 + Math.random() * 0.4))

const parseErrorCode = (text) => {
  try {
    const body = JSON.parse(text)
    return body?.error?.code ?? body?.error?.type ?? null
  } catch {
    return null
  }
}

// A context-overflow failure must surface at once so the caller can compact,
// never burn retries on a request that cannot succeed unchanged.
const isContextOverflow = (text) => {
  let message = text
  let code = null
  try {
    const body = JSON.parse(text)
    code = body?.error?.code ?? body?.error?.type ?? null
    if (typeof body?.error?.message === 'string') message = body.error.message
  } catch {
    // Not JSON; match against the raw text below.
  }
  if (code === 'context_length_exceeded') return true
  return /context|token/i.test(message) && /too|exceed|maximum|large|long|limit/i.test(message)
}

const isRetryableStatus = (status, text) => {
  if (isContextOverflow(text)) return false
  if (status === 429) return true
  if (status >= 500 && status <= 599) return true
  const code = parseErrorCode(text)
  return code != null && RETRYABLE_ERROR_CODES.has(code)
}

// fetch() rejects (never resolves to a Response) on a network failure: a
// connection reset, DNS failure, or TLS error. `TypeError` is what both
// undici and browser fetch throw for these; there's no HTTP status to read.
const isRetryableNetworkError = (err) =>
  err?.code === 'ECONNRESET' || err?.cause?.code === 'ECONNRESET' || err instanceof TypeError

const retryAfterMs = (headers) => {
  const raw = headers?.get?.('retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null
}

const backoffDelayMs = (attempt, headerDelayMs) => {
  const base = headerDelayMs ?? jittered(RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS.at(-1))
  return Math.min(base, MAX_RETRY_DELAY_MS)
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Retries a fetch that has not yet produced a response body: a 429/5xx status,
 * a provider error code meaning overloaded/rate-limited, or a network error.
 * On success returns the real Response (body unread, ready to stream); on a
 * non-retryable or exhausted failure returns `{ok: false, status, text}` with
 * the body already read, so callers format the same error message either way.
 * `onRetry` fires once per retry, before the backoff sleep, so callers can
 * trace and count retries. `firstAttempt` continues a budget `streamWithRetry`
 * has partly spent.
 */
export async function fetchWithRetry(fetchImpl, url, init, { onRetry, sleep = defaultSleep, maxAttempts = MAX_PROVIDER_ATTEMPTS, firstAttempt = 1 } = {}) {
  for (let attempt = firstAttempt; ; attempt += 1) {
    let res
    try {
      res = await fetchImpl(url, init)
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryableNetworkError(err)) throw err
      const delayMs = backoffDelayMs(attempt, null)
      onRetry?.({ attempt, maxAttempts, status: null, reason: err.message, delayMs })
      await sleep(delayMs)
      continue
    }
    if (res.ok) return res
    const text = await res.text()
    if (attempt >= maxAttempts || !isRetryableStatus(res.status, text)) return { ok: false, status: res.status, text }
    const delayMs = backoffDelayMs(attempt, retryAfterMs(res.headers))
    onRetry?.({ attempt, maxAttempts, status: res.status, reason: text, delayMs })
    await sleep(delayMs)
  }
}

export const STREAM_TERMINATED = 'stream terminated before content'

const isContent = (event) => event.type === 'text' || event.type === 'tool_use'

/**
 * POSTs through `fetchWithRetry` and yields `parse(res.body)`. A body that
 * fails with a network error (undici's `TypeError: terminated`, a reset)
 * before any text or tool call has been yielded is requested again, within
 * the same attempt budget and backoff; one that fails after is not, since the
 * caller has already shown that output. Every retry is yielded as a `retry`
 * event. A refused request throws an Error carrying its `status` and `body`.
 */
export async function* streamWithRetry(label, url, init, parse, { fetchImpl = fetch, sleep = defaultSleep, maxAttempts = MAX_PROVIDER_ATTEMPTS } = {}) {
  let attempt = 1
  for (;;) {
    // Each retry is yielded as it happens, during its backoff, so a caller can show it.
    const retries = []
    let wake = () => {}
    const response = fetchWithRetry(fetchImpl, url, init, {
      onRetry: (event) => {
        retries.push(event)
        wake()
      },
      sleep,
      maxAttempts,
      firstAttempt: attempt,
    }).then((value) => ({ value }))
    let res
    while (!res) {
      const woken = new Promise((resolve) => {
        wake = resolve
      })
      if (retries.length === 0) res = (await Promise.race([response, woken]))?.value
      while (retries.length > 0) {
        attempt += 1
        yield { type: 'retry', ...retries.shift() }
      }
    }
    if (!res.ok) throw Object.assign(new Error(`${label}: ${res.text} (status ${res.status})`), { status: res.status, body: res.text })
    let replied = false
    try {
      for await (const event of parse(res.body)) {
        if (isContent(event)) replied = true
        yield event
      }
      return
    } catch (err) {
      if (!isRetryableNetworkError(err)) throw err
      if (replied) throw new Error(`${label}: stream terminated after the reply began (${err.message})`, { cause: err })
      if (attempt >= maxAttempts) throw new Error(`${label}: ${STREAM_TERMINATED} on all ${maxAttempts} attempts (${err.message})`, { cause: err })
      const delayMs = backoffDelayMs(attempt, null)
      yield { type: 'retry', attempt, maxAttempts, status: null, reason: `${STREAM_TERMINATED} (${err.message})`, delayMs }
      await sleep(delayMs)
      attempt += 1
    }
  }
}

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

const isFailureContent = (content) => {
  if (typeof content !== 'string') return false
  try {
    return JSON.parse(content)?.ok === false
  } catch {
    return false
  }
}

// A data URL's base64 body, which is what both Anthropic and OpenAI accept for
// inline image bytes. A bare base64 string (no comma) passes through.
const imageBase64 = (dataUrl) => {
  const comma = String(dataUrl).indexOf(',')
  return comma === -1 ? String(dataUrl) : String(dataUrl).slice(comma + 1)
}

// A tool result carrying image parts becomes text + image content blocks; one
// without images stays the plain string it always was.
const anthropicToolResult = (message) => {
  const images = Array.isArray(message.images) ? message.images : []
  const content =
    images.length === 0
      ? message.content
      : [
          { type: 'text', text: message.content },
          ...images.map((image) => ({
            type: 'image',
            source: { type: 'base64', media_type: image.mime, data: imageBase64(image.dataUrl) },
          })),
        ]
  const result = { type: 'tool_result', tool_use_id: message.toolCallId, content }
  if (isFailureContent(message.content)) result.is_error = true
  return result
}

const toAnthropicMessage = (message) => {
  if (message.role === 'tool') {
    return { role: 'user', content: [anthropicToolResult(message)] }
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

// Exported for tests only; not part of the package's public surface.
export const toAnthropicMessages = (messages) => {
  // Consecutive tool results ride in one user message, results before any
  // text, or the model learns to avoid parallel tool calls.
  const out = []
  let batch = null
  for (const message of messages) {
    if (message.role === 'tool') {
      const result = anthropicToolResult(message)
      if (batch) batch.push(result)
      else {
        batch = [result]
        out.push({ role: 'user', content: batch })
      }
    } else {
      batch = null
      out.push(toAnthropicMessage(message))
    }
  }
  return out
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
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
      const text = event.delta.thinking
      if (typeof text === 'string' && text !== '') yield { type: 'reasoning', text }
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const acc = toolInputs.get(event.index ?? 0)
      if (acc) acc.json += event.delta.partial_json ?? ''
    } else if (event.type === 'content_block_stop') {
      const acc = toolInputs.get(event.index ?? 0)
      if (acc) {
        toolInputs.delete(event.index ?? 0)
        yield { type: 'tool_use', id: acc.id, name: acc.name, ...parseToolArguments(acc.json) }
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
    async *send(messages, tools, { toolChoice } = {}) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      const body = {
        model: config.model,
        max_tokens: 4096,
        stream: true,
        messages: toAnthropicMessages(messages.filter((m) => m.role !== 'system')),
      }
      if (system) body.system = system
      if (tools.length > 0) body.tools = tools.map(toAnthropicTool)
      if (toolChoice === 'none') body.tool_choice = { type: 'none' }
      else if (toolChoice === 'any') body.tool_choice = { type: 'any' }
      if (config.effort) body.output_config = { effort: config.effort }
      const headers = {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      }
      // Free jscad-web models are zen-served, like opencode-go; the relay
      // forwards this header upstream.
      if (config.kind === 'opencode-go' || config.kind === 'jscad-web') headers['x-opencode-session'] = sessionId
      if (config.chatId) headers['x-jscad-chat-id'] = config.chatId
      yield* streamWithRetry(
        'anthropic',
        `${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind] ?? PROVIDER_BASE_URLS.anthropic}/v1/messages`,
        { method: 'POST', headers, body: JSON.stringify(body) },
        parseAnthropicStream,
      )
    },
  }
}

// Chat-completions has no image content on a tool message, so a batch's view
// images follow it as ONE user message of image_url parts, after the last tool
// row of that assistant batch (tool, tool, user), which strict relays accept.
// Exported for tests only; not part of the package's public surface.
export const toOpenAIMessages = (messages) => {
  const out = []
  let images = []
  const flushImages = () => {
    if (images.length === 0) return
    out.push({ role: 'user', content: images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })) })
    images = []
  }
  for (const message of messages) {
    if (message.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content })
      if (Array.isArray(message.images)) images.push(...message.images)
      continue
    }
    flushImages()
    if (message.role === 'assistant' && (message.toolCalls ?? []).length > 0) {
      out.push({
        role: 'assistant',
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input) },
        })),
      })
    } else {
      out.push({ role: message.role, content: message.content })
    }
  }
  flushImages()
  return out
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
    // opencode's open models stream their reasoning as `reasoning_content`, some routers as `reasoning`.
    const reasoning = delta.reasoning_content || delta.reasoning
    if (typeof reasoning === 'string' && reasoning !== '') yield { type: 'reasoning', text: reasoning }
    if (typeof delta.refusal === 'string' && delta.refusal !== '') yield { type: 'refusal', text: delta.refusal }
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
    const parsed = parseToolArguments(acc.args)
    yield { type: 'tool_use', id: acc.id, name: acc.name, ...parsed, ...(parsed.badArguments !== undefined ? { finishReason: stopReason || null } : {}) }
  }
  yield { type: 'done', stopReason: stopReason || 'stop' }
}

const openaiProvider = (config) => {
  const sessionId = config.sessionId ?? crypto.randomUUID()
  return {
    async *send(messages, tools, { toolChoice } = {}) {
      const body = {
        model: config.model,
        stream: true,
        messages: toOpenAIMessages(messages),
      }
      if (tools.length > 0) body.tools = tools.map(toOpenAITool)
      if (toolChoice === 'none') body.tool_choice = 'none'
      else if (toolChoice === 'any') body.tool_choice = 'required'
      if (config.effort) body.reasoning_effort = config.effort
      if (config.temperature !== undefined) body.temperature = config.temperature
      if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens
      if (config.kind === 'openai' || config.kind === 'opencode-go' || config.kind === 'jscad-web') body.stream_options = { include_usage: true }
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      }
      // Free jscad-web models are zen-served, like opencode-go; the relay
      // forwards this header upstream.
      if (config.kind === 'opencode-go' || config.kind === 'jscad-web') headers['x-opencode-session'] = sessionId
      if (config.chatId) headers['x-jscad-chat-id'] = config.chatId
      yield* streamWithRetry(
        'openai',
        `${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind]}/v1/chat/completions`,
        { method: 'POST', headers, body: JSON.stringify(body) },
        parseOpenAIStream,
      )
    },
  }
}

/**
 * @param {{kind:'anthropic'|'openai'|'opencode-go'|'meta'|'jscad-web',apiKey:string,model:string,baseUrl?:string,sessionId?:string,effort?:string,chatId?:string,temperature?:number,maxTokens?:number}} config
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
    case 'jscad-web':
      if (RESPONSES_MODELS.has(config.model)) return responsesProvider(config)
      if (MESSAGES_MODELS.has(config.model)) return anthropicProvider(config)
      return openaiProvider(config)
    default:
      throw new Error(`createProvider: unknown kind '${config.kind}'`)
  }
}
