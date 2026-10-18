// Web search over hosted MCP endpoints: keyless free tiers first, user keys
// upgrade the pool. Bare fetch + JSON-RPC, no new dependencies. Failures are
// results, never throws; keys never leave headers for logs or transcripts.
import { toolError } from './dispatchTool.js'

export const SEARCH_TIMEOUT_MS = 25_000
export const COOLDOWN_MS = 60_000
export const SNIPPET_MAX_CHARS = 500
export const DEFAULT_COUNT = 8
export const MAX_COUNT = 20

const PROVIDERS = [
  { id: 'exa', endpoint: 'https://mcp.exa.ai/mcp', tool: 'web_search_exa', needsKey: false, browserDirect: true },
  { id: 'parallel', endpoint: 'https://search.parallel.ai/mcp', tool: 'web_search', needsKey: false, browserDirect: true },
  // Firecrawl now requires OAuth (401 keyless since 2026-10); keyed only.
  {
    id: 'firecrawl',
    endpoint: 'https://mcp.firecrawl.dev/v2/mcp-search',
    tool: 'firecrawl_search',
    needsKey: true,
    browserDirect: true,
  },
  // TinyFish needs a key and its search tool name is resolved live via
  // tools/list — never hardcoded (spec open decision 4).
  { id: 'tinyfish', endpoint: 'https://agent.tinyfish.ai/mcp', tool: null, needsKey: true, browserDirect: true },
  // Tavily answers no CORS preflight, so browsers can only reach it through
  // POST /api/search; Node uses the documented ?tavilyApiKey= query param.
  { id: 'tavily', endpoint: 'https://mcp.tavily.com/mcp/', tool: 'tavily-search', needsKey: true, browserDirect: false },
]

const ENV_KEYS = { exa: 'JSCADUI_EXA_API_KEY', parallel: 'JSCADUI_PARALLEL_API_KEY', firecrawl: 'JSCADUI_FIRECRAWL_API_KEY', tinyfish: 'JSCADUI_TINYFISH_API_KEY', tavily: 'JSCADUI_TAVILY_API_KEY' }

const envKeys = () => {
  const keys = {}
  const env = globalThis.process?.env ?? {}
  for (const [id, name] of Object.entries(ENV_KEYS)) {
    if (env[name]) keys[id] = env[name]
  }
  return keys
}

// djb2: stable sticky pick per conversation, mirroring opencode's checksum trick.
const hashId = (text) => {
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
  return hash
}

// Ordered pool usable in this context with these keys: keyless first (spend
// the user's money last), a pinned provider first when usable.
export const buildPool = ({ keys = {}, context = 'node', pinned } = {}) => {
  const usable = PROVIDERS.filter(
    (provider) => (!provider.needsKey || keys[provider.id]) && (context !== 'browser' || provider.browserDirect),
  )
  const keyless = usable.filter((provider) => !provider.needsKey)
  const keyed = usable.filter((provider) => provider.needsKey)
  const pool = [...keyless, ...keyed]
  if (pinned && pinned !== 'random') {
    const at = pool.findIndex((provider) => provider.id === pinned)
    if (at > 0) pool.unshift(...pool.splice(at, 1))
  }
  return pool.map((provider) => ({ ...provider }))
}

const retryAfterMs = (headers) => {
  const raw = headers?.get?.('retry-after')
  const seconds = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : COOLDOWN_MS
}

// Streamable-HTTP tools/call. { error } bodies become failures, never throws.
// Sends Accept for both JSON and SSE: Exa answers 406 without it and streams
// `text/event-stream` (event:/data: lines) on success.
export const mcpCall = async (url, tool, args, { fetchFn = globalThis.fetch, headers = {}, timeoutMs = SEARCH_TIMEOUT_MS } = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'jscadui-search', method: 'tools/call', params: { name: tool, arguments: args } }),
      signal: controller.signal,
    })
    const contentType = response.headers?.get?.('content-type') ?? ''
    let body = null
    if (contentType.includes('text/event-stream')) {
      try {
        const text = await response.text()
        const dataLine = text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trim())
          .find((line) => line && line !== '[DONE]')
        body = dataLine ? JSON.parse(dataLine) : null
      } catch {
        return { ok: false, status: response.status, retryable: response.status === 429, headers: response.headers }
      }
    } else {
      try {
        body = await response.json()
      } catch {
        return { ok: false, status: response.status, retryable: response.status === 429, headers: response.headers }
      }
    }
    if (!response.ok || body?.error) {
      return { ok: false, status: response.status, retryable: response.status === 429, headers: response.headers }
    }
    if (body?.result?.isError) {
      return { ok: false, status: response.status, retryable: false, headers: response.headers, body }
    }
    return { ok: true, status: response.status, body }
  } catch {
    return { ok: false, status: 0, retryable: true }
  } finally {
    clearTimeout(timer)
  }
}

const mcpList = async (url, { fetchFn, headers, timeoutMs }) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'jscadui-tools', method: 'tools/list', params: {} }),
      signal: controller.signal,
    })
    const contentType = response.headers?.get?.('content-type') ?? ''
    if (contentType.includes('text/event-stream')) {
      const text = await response.text()
      const dataLine = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .find((line) => line && line !== '[DONE]')
      const body = dataLine ? JSON.parse(dataLine) : null
      return body?.result?.tools ?? []
    }
    const body = await response.json()
    return body?.result?.tools ?? []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

const capSnippet = (snippet) =>
  String(snippet ?? '')
    .split('```')
    .join('``\u200b`')
    .slice(0, SNIPPET_MAX_CHARS)

// Per-provider arg shapes (upstream drift 2026-10): Exa requires
// query+objective (+numResults), Parallel requires objective+search_queries.
export const buildArgs = (providerId, query, count) => {
  if (providerId === 'exa') return { query, objective: query, numResults: count }
  if (providerId === 'parallel') return { objective: query, search_queries: [query] }
  return { query, count }
}

const parseExaMarkdown = (text) => {
  const blocks = String(text ?? '').split(/\n-{3,}\n|\n(?=Title: )/)
  const hits = []
  for (const block of blocks) {
    const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim()
    const url = block.match(/^URL:\s*(.+)$/m)?.[1]?.trim()
    if (!title || !url) continue
    const highlights = block.split(/Highlights:\s*/)[1] ?? ''
    hits.push({ title, url, snippet: highlights.trim() })
  }
  return hits.length ? hits : null
}

const normalizeResults = (body, provider) => {
  if (Array.isArray(body?.result?.results)) {
    const raw = body.result.results
    return raw.map((hit) => ({
      title: String(hit?.title ?? ''),
      url: String(hit?.url ?? ''),
      snippet: capSnippet(hit?.snippet ?? (Array.isArray(hit?.excerpts) ? hit.excerpts.join('\n') : '')),
      provider,
    }))
  }
  const text = body?.result?.content?.find?.((block) => block?.type === 'text')?.text
  if (typeof text === 'string') {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed?.results)) {
        return parsed.results.map((hit) => ({
          title: String(hit?.title ?? ''),
          url: String(hit?.url ?? ''),
          snippet: capSnippet(hit?.snippet ?? (Array.isArray(hit?.excerpts) ? hit.excerpts.join('\n') : '')),
          provider,
        }))
      }
    } catch {
      // Not JSON: fall through to Exa markdown below.
    }
    const md = parseExaMarkdown(text)
    if (md) return md.map((hit) => ({ ...hit, snippet: capSnippet(hit.snippet), provider }))
  }
  return null
}

// Keyed auth per provider: TinyFish documents X-API-Key; the rest take a
// bearer token. Keyless requests carry no Authorization. User-Agent is
// Node-only: browsers forbid setting it and Exa/Parallel omit it from
// Access-Control-Allow-Headers, so sending it breaks the CORS preflight.
const authHeaders = (provider, key, version, context) => {
  const base = context === 'browser' ? {} : { 'User-Agent': `jscadui/${version}` }
  if (!provider.needsKey) return base
  if (provider.id === 'tinyfish') return { ...base, 'X-API-Key': key }
  return { ...base, Authorization: `Bearer ${key}` }
}

/**
 * Page/Node websearch handler factory. Keys from `getKeys()` (or `keys`,
 * or `JSCADUI_<PROVIDER>_API_KEY` env at construction); `relaySearch` serves
 * relay-only traffic in browser wiring (Task 5).
 */
export const createWebSearch = ({
  fetchFn = globalThis.fetch,
  keys,
  getKeys,
  context = 'node',
  projectId,
  sessionId,
  version = '0.0.0',
  relaySearch,
  pinned,
} = {}) => {
  const resolvedKeys = { ...envKeys(), ...(keys ?? {}), ...(getKeys?.() ?? {}) }
  const cooldowns = new Map()
  const lastFailure = new Map()
  const tinyfishTools = new Map()

  const searchVia = async (provider, query, count) => {
    const key = resolvedKeys[provider.id]
    const args = buildArgs(provider.id, query, count)
    if (provider.id === 'tavily' && context === 'node' && key) {
      const url = `${provider.endpoint}?tavilyApiKey=${encodeURIComponent(key)}`
      const call = await mcpCall(url, provider.tool, { query, count }, { fetchFn, headers: authHeaders(provider, key, version, context) })
      return { ...call, provider: provider.id }
    }
    if (!provider.browserDirect && context === 'browser') {
      if (typeof relaySearch !== 'function') return { ok: false, retryable: false, status: 0, provider: provider.id }
      try {
        const results = await relaySearch({ query, count })
        return { ok: true, body: { result: { results } }, provider: provider.id }
      } catch {
        return { ok: false, retryable: true, status: 0, provider: provider.id }
      }
    }
    let tool = provider.tool
    if (provider.id === 'tinyfish' && !tinyfishTools.has(provider.endpoint)) {
      const tools = await mcpList(provider.endpoint, { fetchFn, headers: authHeaders(provider, key, version, context) })
      const match = tools.find((tool) => /search/i.test(tool?.name ?? ''))
      if (!match?.name) return { ok: false, retryable: false, status: 0, provider: provider.id }
      tinyfishTools.set(provider.endpoint, match.name)
    }
    if (provider.id === 'tinyfish') tool = tinyfishTools.get(provider.endpoint)
    const call = await mcpCall(provider.endpoint, tool, args, { fetchFn, headers: authHeaders(provider, key, version, context) })
    return { ...call, provider: provider.id }
  }

  return async (args) => {
    const query = args?.query
    if (typeof query !== 'string' || !query.trim()) {
      return toolError('ValidationError', "websearch: missing required property 'query'")
    }
    const count = args?.count ?? DEFAULT_COUNT
    if (!Number.isInteger(count)) return toolError('ValidationError', "websearch: property 'count' should be integer")
    const pool = buildPool({ keys: resolvedKeys, context, pinned })
    if (!pool.length) return toolError('SearchUnavailableError', 'websearch: no usable search provider')
    const start = hashId(String(projectId ?? sessionId ?? '')) % pool.length
    const now = Date.now()
    const failures = []
    let cooling = 0
    for (let step = 0; step < pool.length; step++) {
      const provider = pool[(start + step) % pool.length]
      const until = cooldowns.get(provider.id) ?? 0
      if (until > now) {
        cooling += 1
        failures.push({
          provider: provider.id,
          status: 'cooldown',
          retryable: true,
          retryInMs: until - now,
          ...(lastFailure.has(provider.id) ? { causedBy: lastFailure.get(provider.id) } : {}),
        })
        continue
      }
      const attempt = await searchVia(provider, query.trim(), Math.min(Math.max(count, 1), MAX_COUNT))
      if (attempt.ok) {
        const results = normalizeResults(attempt.body, provider.id)
        if (results) return { ok: true, results: results.slice(0, Math.min(Math.max(count, 1), MAX_COUNT)) }
        failures.push({ provider: provider.id, status: attempt.status ?? 200, retryable: false, note: 'unparseable response' })
        continue
      }
      failures.push({ provider: provider.id, status: attempt.status ?? 0, retryable: !!attempt.retryable })
      lastFailure.set(provider.id, { status: attempt.status ?? 0, retryable: !!attempt.retryable })
      if (attempt.retryable) cooldowns.set(provider.id, Date.now() + retryAfterMs(attempt.headers))
    }
    const summary = failures.map((f) => (f.status === 'cooldown' && f.causedBy ? `${f.provider}:cooldown(caused by ${f.causedBy.status})` : `${f.provider}:${f.status}`)).join(', ')
    const suffix = cooling > 0 ? ` (${cooling} cooling)` : ''
    return toolError('SearchUnavailableError', `websearch: all providers failed [${summary}]${suffix}`, failures)
  }
}
