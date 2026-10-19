import { GO_BASE_URL } from './roles.js'

export function createGoClient({ apiKey, fetchImpl = fetch, session }) {
  async function complete({ model, messages, temperature, maxTokens }) {
    const body = { model, messages }
    if (temperature !== undefined) body.temperature = temperature
    if (maxTokens !== undefined) body.max_tokens = maxTokens
    const started = Date.now()
    const res = await fetchImpl(`${GO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'x-opencode-session': session,
      },
      body: JSON.stringify(body),
    })
    const raw = await res.text()
    let json
    try {
      json = JSON.parse(raw)
    } catch {
      json = undefined
    }
    const text = json?.choices?.[0]?.message?.content
    if (!res.ok || typeof text !== 'string') {
      const detail = json?.error?.message ?? json?.error ?? raw.slice(0, 300)
      throw new Error(`${model}: HTTP ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
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
