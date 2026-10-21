import { GO_BASE_URL } from './roles.js'

export function createGoClient({ apiKey, fetchImpl = fetch, session, timeoutMs = 120000 }) {
  // A provider can echo the request, key included, into its error text.
  const redact = (text) => (apiKey ? text.replaceAll(apiKey, '[key]') : text)

  async function post(model, body) {
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      const res = await fetchImpl(`${GO_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'x-opencode-session': session,
        },
        body: JSON.stringify(body),
        signal,
      })
      return { res, raw: await res.text() }
    } catch (e) {
      if (signal.aborted) throw Object.assign(new Error(`${model}: timeout after ${timeoutMs} ms`), { name: 'TimeoutError' })
      const message = String(e?.message ?? e)
      throw apiKey && message.includes(apiKey) ? new Error(redact(message)) : e
    }
  }

  async function complete({ model, messages, temperature, maxTokens, reasoningEffort }) {
    const body = { model, messages }
    if (temperature !== undefined) body.temperature = temperature
    if (maxTokens !== undefined) body.max_tokens = maxTokens
    if (reasoningEffort !== undefined) body.reasoning_effort = reasoningEffort
    const started = Date.now()
    const { res, raw } = await post(model, body)
    let json
    try {
      json = JSON.parse(raw)
    } catch {
      json = undefined
    }
    const choice = json?.choices?.[0]
    const text = choice?.message?.content
    // A model that reasons before it answers can spend the whole budget thinking.
    if (res.ok && choice?.finish_reason === 'length' && !text) {
      throw Object.assign(new Error(`${model}: the reply ran out of its ${maxTokens} tokens before answering`), { name: 'LengthError' })
    }
    if (!res.ok || typeof text !== 'string') {
      const detail = json?.error?.message ?? json?.error ?? raw.slice(0, 300)
      throw new Error(redact(`${model}: HTTP ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`))
    }
    return {
      text,
      ms: Date.now() - started,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      status: res.status,
    }
  }
  return { complete }
}
