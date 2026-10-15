import { toolError } from '@jscadui/agent-loop'

// The relay caps the extracted text server-side; the page caps again as
// defense-in-depth, so a relay bug can never hand the model an unbounded page.
export const FETCH_CONTENT_CHARS = 8000

// Page-side webfetch: browsers cannot read an arbitrary cross-origin page
// (the response is opaque), so every fetch goes through POST /api/fetch. No
// provider key rides this call — the relay holds none for arbitrary pages.
const isHttpUrl = (value) => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const escapeFences = (text) => String(text).split('```').join('``\u200b`')

/**
 * Builds the `webfetch` handler. `{ url, format? }` in; the relay's capped page
 * out as `{ ok, title, finalUrl, content, truncated }`, or a `toolError` for a
 * refusal, an oversize page or an unreachable relay. Never throws.
 */
export const createWebFetchHandler = ({ fetchFn = globalThis.fetch, relayUrl = '/api/fetch' } = {}) => async (args) => {
  const url = args?.url
  if (typeof url !== 'string' || !isHttpUrl(url)) {
    return toolError('ValidationError', 'webfetch: url must be an http(s) URL')
  }
  const format = args?.format === 'text' ? 'text' : 'markdown'
  let res
  try {
    res = await fetchFn(relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format }),
    })
  } catch (error) {
    return toolError('FetchError', `webfetch: relay unreachable (${error?.message ?? error})`)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.error) {
    const name = typeof body?.name === 'string' ? body.name : 'FetchError'
    const message = typeof body?.error === 'string' ? body.error : `webfetch: relay failed with ${res.status}`
    return toolError(name, message)
  }
  // A 200 with an unparseable body is a broken relay, not an empty page.
  if (!body) return toolError('FetchError', 'webfetch: relay answered without JSON')
  const escaped = escapeFences(body?.content ?? '')
  return {
    ok: true,
    title: String(body?.title ?? ''),
    finalUrl: String(body?.finalUrl ?? url),
    content: escaped.slice(0, FETCH_CONTENT_CHARS),
    truncated: body?.truncated === true || escaped.length > FETCH_CONTENT_CHARS,
  }
}
