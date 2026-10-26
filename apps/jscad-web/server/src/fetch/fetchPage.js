// The page fetch behind POST /api/fetch, shared by the production route
// (routes.ts) and the local launcher (scripts/local/fetchApi.js): plain JS so
// plain `node` loads it, and both get the same guards.
import { RelayRefusal, assertPublicUpstream } from '../relay/policy.js'

/** Characters of extracted text the answer keeps. */
export const MAX_CONTENT_CHARS = 8000
/** Raw upstream body bytes past which the page is refused, not truncated. */
export const MAX_BODY_BYTES = 2_000_000
/** Redirects followed before the chain is abandoned. */
export const MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 15_000

/** @param {string} text */
export const escapeFences = (text) => text.split('```').join('``​`')

/** @type {Record<string, string>} */
const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

// Named and numeric references, no HTML parser. An out-of-range numeric code
// point resolves to nothing rather than throwing.
/**
 * @param {number} code
 * @returns {string | null}
 */
const safeCodePoint = (code) =>
  Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null

/** @param {string} text */
const decodeEntities = (text) =>
  text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (/** @type {string} */ whole, /** @type {string} */ name) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      const code = parseInt(name.slice(2), 16)
      return safeCodePoint(code) ?? whole
    }
    if (name.startsWith('#')) {
      const code = parseInt(name.slice(1), 10)
      return safeCodePoint(code) ?? whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })

/** @param {string} html */
const titleOf = (html) => {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? decodeEntities(match[1]).trim() : ''
}

// The answer's URL never carries the fetch's query string or fragment: they are
// where a caller's secret token or session id often rides, and the model does
// not need them to cite the page.
/** @param {string} value */
const withoutQuery = (value) => {
  try {
    const parsed = new URL(value)
    parsed.search = ''
    parsed.hash = ''
    return parsed.href
  } catch {
    return value
  }
}

// Tag-strip + entity-decode, no HTML parser dependency. Script and style
// bodies are dropped whole (their text is not page content), block-level close
// tags become line breaks so the markdown-ish answer stays readable, and only
// then are entities decoded — so an escaped `&lt;b&gt;` stays text, not a tag.
/** @param {string} html */
export const toText = (html) =>
  decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|blockquote)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim(),
  )

/** @param {string} value */
export const isHttpUrl = (value) => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

// Reads a body of at most MAX_BODY_BYTES, aborting the stream the instant the
// cap is passed: a huge (or Content-Length-lying) upstream is never buffered
// whole. The Content-Length fast path in fetchPage catches the honest case.
/**
 * @param {Response} res
 * @returns {Promise<{ tooLarge: true } | { tooLarge: false, text: string }>}
 */
const readCapped = async (res) => {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text()
    return Buffer.byteLength(text) > MAX_BODY_BYTES ? { tooLarge: true } : { tooLarge: false, text }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        return { tooLarge: true }
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return { tooLarge: false, text }
  } finally {
    reader.releaseLock?.()
  }
}

/** @typedef {import('../relay/policy.js').DnsLookup} DnsLookup */
/** @typedef {{ status: number, body: Record<string, unknown> }} FetchPageResult */

/** @type {(status: number, error: string, name: string) => FetchPageResult} */
const failure = (status, error, name) => ({ status, body: { error, name } })

const UNREACHABLE = () => failure(502, 'fetch: upstream unreachable', 'FetchError')
const TOO_LARGE = () => failure(413, 'fetch: response too large', 'TooLargeError')

// Per-hop private-address refusal: a permitted public name can still point at
// a private address, and a public redirect can lead there.
/**
 * @param {unknown} err
 * @returns {FetchPageResult}
 */
const refusal = (err) => {
  if (!(err instanceof RelayRefusal)) throw err
  if (err.status === 400) return failure(400, 'fetch: refused a private address', 'BlockedHostError')
  return UNREACHABLE()
}

/**
 * Validates the request, follows redirects, reads the capped body and answers
 * with the HTTP status and JSON body the relay sends. Throws only an error from
 * the address check that is not a RelayRefusal.
 * @param {{
 *   url: unknown,
 *   format?: unknown,
 *   fetchFn?: typeof fetch,
 *   dnsLookup?: DnsLookup,
 *   timeoutMs?: number,
 *   logger?: (entry: Record<string, unknown>) => void,
 * }} options
 * @returns {Promise<FetchPageResult>}
 */
export const fetchPage = async ({
  url,
  format,
  fetchFn = fetch,
  dnsLookup,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = () => {},
}) => {
  if (typeof url !== 'string' || !isHttpUrl(url)) {
    return failure(400, 'fetch: url must be an http(s) URL', 'ValidationError')
  }
  if (format !== undefined && format !== 'markdown' && format !== 'text') {
    return failure(400, 'fetch: format must be markdown or text', 'ValidationError')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let currentUrl = url
  let follows = 0
  /** @type {Response} */
  let upstreamRes
  try {
    try {
      await assertPublicUpstream(url, dnsLookup)
    } catch (err) {
      return refusal(err)
    }
    for (;;) {
      try {
        upstreamRes = await fetchFn(currentUrl, { redirect: 'manual', signal: controller.signal })
      } catch {
        return UNREACHABLE()
      }
      if (upstreamRes.status < 300 || upstreamRes.status >= 400) break
      if (follows >= MAX_REDIRECTS) return failure(502, 'fetch: too many redirects', 'FetchError')
      const location = upstreamRes.headers.get('location')
      let next
      try {
        next = new URL(location ?? '', currentUrl)
      } catch {
        return failure(502, 'fetch: bad redirect target', 'FetchError')
      }
      if (!isHttpUrl(next.href)) return failure(400, 'fetch: redirect must stay http(s)', 'ValidationError')
      try {
        await assertPublicUpstream(next.href, dnsLookup)
      } catch (err) {
        return refusal(err)
      }
      currentUrl = next.href
      follows += 1
    }

    if (!upstreamRes.ok) return failure(502, 'fetch: upstream answered an error', 'FetchError')
    const declaredLength = Number(upstreamRes.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return TOO_LARGE()
    let read
    try {
      read = await readCapped(upstreamRes)
    } catch {
      return failure(502, 'fetch: upstream body unreadable', 'FetchError')
    }
    if (read.tooLarge) return TOO_LARGE()
    const body = read.text
    const bytes = Buffer.byteLength(body)
    const escaped = escapeFences(toText(body))
    const content = escaped.slice(0, MAX_CONTENT_CHARS)
    logger({ fetch: 'upstream', status: upstreamRes.status, bytes })
    return {
      status: 200,
      body: {
        ok: true,
        title: titleOf(body),
        finalUrl: withoutQuery(currentUrl),
        content,
        truncated: escaped.length > MAX_CONTENT_CHARS,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}
