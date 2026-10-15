import { describe, expect, it, vi } from 'vitest'
import { createSearchStores, createWebSearchHandler, searchStoreKey } from '../src/aiSearch.js'

const memStorage = () => {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

const mcpOk = (results) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ result: { results } }),
})

const mcpFail = (status = 429) => ({
  ok: false,
  status,
  headers: { get: () => null },
  json: async () => ({}),
})

describe('search stores', () => {
  it('keys one store per provider id', () => {
    expect(searchStoreKey('tavily')).toBe('jscad-studio.search.tavily')
    const stores = createSearchStores(memStorage())
    expect(Object.keys(stores).sort()).toEqual(['exa', 'firecrawl', 'parallel', 'tavily', 'tinyfish'])
  })
})

describe('page websearch handler', () => {
  it('keyless query hits the browser-direct pool without touching the relay', async () => {
    const fetchFn = vi.fn(async () => mcpOk([{ title: 't', url: 'https://example.com', snippet: 's' }]))
    const handler = createWebSearchHandler({ fetchFn, stores: createSearchStores(memStorage()), projectId: 'p1' })
    const res = await handler({ query: 'bearing 608' })
    expect(res.ok).toBe(true)
    expect(res.results[0].provider).toMatch(/^(exa|parallel|firecrawl)$/)
    for (const [url] of fetchFn.mock.calls) expect(String(url)).not.toContain('/api/search')
  })

  it('falls back to POST /api/search for Tavily when the direct pool is exhausted', async () => {
    const storage = memStorage()
    const stores = createSearchStores(storage)
    await stores.tavily.set('sk-tavily', 'session')
    const fetchFn = vi.fn(async (url) => {
      if (String(url).includes('/api/search')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, results: [{ title: 't', url: 'https://example.com', snippet: 's', provider: 'tavily' }] }) }
      }
      return mcpFail()
    })
    const handler = createWebSearchHandler({ fetchFn, stores, projectId: 'p1' })
    const res = await handler({ query: 'bearing 608' })
    expect(res.ok).toBe(true)
    expect(res.results[0]).toMatchObject({ provider: 'tavily' })
    expect(fetchFn.mock.calls.some(([url, init]) => String(url).includes('/api/search') && init?.method === 'POST')).toBe(true)
  })

  it('fails closed with SearchUnavailableError when everything is exhausted and no relay key', async () => {
    const fetchFn = vi.fn(async () => mcpFail())
    const handler = createWebSearchHandler({ fetchFn, stores: createSearchStores(memStorage()), projectId: 'p1' })
    const res = await handler({ query: 'bearing 608' })
    expect(res).toMatchObject({ ok: false, error: { name: 'SearchUnavailableError' } })
    for (const [url] of fetchFn.mock.calls) expect(String(url)).not.toContain('/api/search')
  })

  it('pinned Tavily goes straight to the relay without trying the direct pool', async () => {
    const storage = memStorage()
    const stores = createSearchStores(storage)
    await stores.tavily.set('sk-tavily', 'session')
    const fetchFn = vi.fn(async (url) => {
      if (String(url).includes('/api/search')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, results: [{ title: 't', url: 'https://example.com', snippet: 's', provider: 'tavily' }] }) }
      }
      return mcpFail()
    })
    const handler = createWebSearchHandler({ fetchFn, stores, projectId: 'p1', getPinned: () => 'tavily' })
    const res = await handler({ query: 'bearing 608' })
    expect(res.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(String(fetchFn.mock.calls[0][0])).toContain('/api/search')
  })
})
