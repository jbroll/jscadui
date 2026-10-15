import { createWebSearch, toolError } from '@jscadui/agent-loop'
import { createKeyStore } from '@jscadui/key-store'

// One key store per search provider; the gear dialog (aiAccount.js) owns the
// UI, this module owns the ids and the page-side handler.
export const SEARCH_PROVIDERS = ['exa', 'parallel', 'firecrawl', 'tavily', 'tinyfish']

export const searchStoreKey = (id) => `jscad-studio.search.${id}`

export const createSearchStores = (storage) =>
  Object.fromEntries(SEARCH_PROVIDERS.map((id) => [id, createKeyStore({ storage, key: searchStoreKey(id) })]))

const readStoreKeys = (stores = {}) => {
  const keys = {}
  for (const [id, store] of Object.entries(stores)) {
    const key = store?.get?.()
    if (typeof key === 'string' && key) keys[id] = key
  }
  return keys
}

/**
 * Page-side web_search: the browser-direct pool first, Tavily (relay-only)
 * via POST /api/search when the direct pool is exhausted and a Tavily key is
 * set. Keys live in the per-provider stores, memory only, never logged.
 */
export const createWebSearchHandler = ({
  fetchFn = globalThis.fetch,
  stores = {},
  getKeys,
  projectId = '',
  relayUrl = '/api/search',
  version = '0.0.0',
} = {}) => {
  const keysOf = () => ({ ...readStoreKeys(stores), ...(getKeys?.() ?? {}) })
  const direct = createWebSearch({ fetchFn, getKeys: keysOf, context: 'browser', projectId, version })

  const relaySearch = async ({ query, count }) => {
    const res = await fetchFn(relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, count }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || body?.error) throw new Error(body?.error ?? `relay search failed with ${res.status}`)
    if (!Array.isArray(body?.results)) throw new Error('relay search answered without results')
    return body.results.map((hit) => ({ ...hit, provider: 'tavily' }))
  }

  return async (args) => {
    const out = await direct(args)
    if (out?.ok) return out
    if (out?.error?.name !== 'SearchUnavailableError') return out
    if (!keysOf().tavily) return out
    try {
      const count = args?.count ?? 8
      const results = await relaySearch({ query: args?.query, count })
      return { ok: true, results }
    } catch (error) {
      return toolError('SearchUnavailableError', `web_search: relay fallback failed (${error?.message ?? error})`)
    }
  }
}
