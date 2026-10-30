// Tavily MCP search shared by the production route (routes.ts) and the local
// launcher (scripts/local/searchApi.js). Plain JS with JSDoc and no node:
// imports, so plain `node` loads it and tsc (allowJs) type-checks and emits it
// into dist/. The operator key rides only the upstream request: it is never
// logged, never echoed, and never returned to the page.
const TAVILY_MCP = 'https://mcp.tavily.com/mcp/'
const SNIPPET_MAX_CHARS = 500

/** @param {unknown} snippet */
const capSnippet = (snippet) =>
  String(snippet ?? '')
    .split('```')
    .join('``\u200b`')
    .slice(0, SNIPPET_MAX_CHARS)

/**
 * A relay answer: `body` is exactly what the page receives, and `upstream` is
 * the provider status when the upstream was reached (for log lines).
 * @typedef {{ status: number, body: Record<string, unknown>, upstream?: number }} SearchReply
 */

/**
 * @param {{ tavilyKey: string, query: string, count?: number, fetchFn?: typeof fetch }} options
 * @returns {Promise<SearchReply>}
 */
export const searchTavily = async ({ tavilyKey, query, count, fetchFn = fetch }) => {
  /** @type {globalThis.Response} */
  let upstreamRes
  try {
    upstreamRes = await fetchFn(`${TAVILY_MCP}?tavilyApiKey=${encodeURIComponent(tavilyKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'jscadui-search-relay',
        method: 'tools/call',
        params: { name: 'tavily-search', arguments: { query, count: count ?? 8 } },
      }),
    })
  } catch {
    return { status: 502, body: { error: 'upstream unreachable' } }
  }
  /** @type {any} */
  let body = null
  try {
    body = await upstreamRes.json()
  } catch {
    return { status: 502, body: { error: 'upstream answered without JSON' }, upstream: upstreamRes.status }
  }
  if (!upstreamRes.ok || body?.error || !Array.isArray(body?.result?.results)) {
    return { status: 502, body: { error: 'search: provider failed' }, upstream: upstreamRes.status }
  }
  const results = body.result.results.map((/** @type {any} */ hit) => ({
    title: String(hit?.title ?? ''),
    url: String(hit?.url ?? ''),
    snippet: capSnippet(hit?.snippet),
    provider: 'tavily',
  }))
  return { status: 200, body: { ok: true, results }, upstream: upstreamRes.status }
}
