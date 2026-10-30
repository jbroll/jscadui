// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'
import { createSearchStores, createWebSearchHandler, searchStoreKey } from '../src/aiSearch.js'
import { createSearchHandler } from '../scripts/local/searchApi.js'
import { startLocal } from '../scripts/local/server.js'
import { tempDir } from './tempDir.js'

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

  it("pinned off fails closed without touching the network", async () => {
    const fetchFn = vi.fn(async () => mcpOk([{ title: 't', url: 'https://example.com', snippet: 's' }]))
    const handler = createWebSearchHandler({ fetchFn, stores: createSearchStores(memStorage()), projectId: 'p1', getPinned: () => 'off' })
    const res = await handler({ query: 'bearing 608' })
    expect(res).toMatchObject({ ok: false, error: { name: 'SearchUnavailableError' } })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('search store custody', () => {
  it('main.js reuses the account dialog store instead of a second copy', () => {
    // Session-custody keys live in page memory, so a second createSearchStores
    // instance sees none of them; the handler must share the dialog's stores.
    const source = readFileSync(join(import.meta.dirname, '..', 'main.js'), 'utf8')
    expect(source).toMatch(/import \{[^}]*\bsearchStores\b[^}]*\} from '\.\/src\/aiAccount\.js'/)
    expect(source).not.toContain('createSearchStores(')
  })

  it('a session-custody Tavily key reaches a handler sharing the account stores', async () => {
    const storage = memStorage()
    globalThis.localStorage = storage
    const { searchStores } = await import('../src/aiAccount.js')
    await searchStores.tavily.set('sk-tavily', 'session')
    expect(createSearchStores(storage).tavily.get()).toBe(null)
    const fetchFn = vi.fn(async (url) => {
      if (String(url).includes('/api/search')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, results: [{ title: 't', url: 'https://example.com', snippet: 's', provider: 'tavily' }] }) }
      }
      return mcpFail()
    })
    const handler = createWebSearchHandler({ fetchFn, stores: searchStores, projectId: 'p1' })
    const res = await handler({ query: 'bearing 608' })
    expect(res.ok).toBe(true)
    expect(res.results[0]).toMatchObject({ provider: 'tavily' })
  })
})

const tavilyOk = (results) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ result: { results } }),
})

const withSearchServer = async (t, options = {}) => {
  const calls = []
  const handler = createSearchHandler({
    trustedOrigins: ['http://app.test'],
    tavilyKey: 'local-tavily-key',
    fetchFn: async (url, init) => {
      calls.push([url, init])
      return tavilyOk([{ title: 't', url: 'https://example.com', snippet: 's' }])
    },
    ...options,
  })
  const front = http.createServer((req, res) => {
    handler(req, res).then((handled) => {
      if (!handled) { res.writeHead(404); res.end() }
    })
  })
  await new Promise((resolve) => front.listen(0, '127.0.0.1', resolve))
  try {
    await t(`http://127.0.0.1:${front.address().port}`, calls)
  } finally {
    front.closeAllConnections(); front.close()
  }
}

const postSearch = (base, body, headers = {}) =>
  fetch(`${base}/api/search`, {
    method: 'POST',
    headers: { origin: 'http://app.test', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('local /api/search relay', () => {
  it('relays Tavily for a trusted origin without echoing the operator key', async () => {
    await withSearchServer(async (base, calls) => {
      const res = await postSearch(base, { query: 'bearing 608' })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('http://app.test')
      const text = await res.text()
      expect(JSON.parse(text)).toEqual({ ok: true, results: [{ title: 't', url: 'https://example.com', snippet: 's', provider: 'tavily' }] })
      expect(text).not.toContain('local-tavily-key')
      const [url, init] = calls[0]
      expect(url).toContain('https://mcp.tavily.com/mcp/')
      expect(JSON.parse(init.body).params.name).toBe('tavily-search')
    })
  })

  it('answers 503 without an operator key so the page falls back to the direct pool', async () => {
    await withSearchServer(async (base, calls) => {
      const res = await postSearch(base, { query: 'bearing 608' })
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'search: no provider key configured' })
      expect(calls).toHaveLength(0)
    }, { tavilyKey: undefined })
  })

  it('refuses an untrusted origin with 403 before touching Tavily', async () => {
    await withSearchServer(async (base, calls) => {
      const res = await postSearch(base, { query: 'x' }, { origin: 'https://evil.test' })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'untrusted origin' })
      expect(calls).toHaveLength(0)
    })
  })

  it('routes POST /api/search in the launcher instead of a static 404', async () => {
    const root = tempDir('jscad-search-')
    mkdirSync(join(root, 'frame'), { recursive: true })
    mkdirSync(join(root, 'models'), { recursive: true })
    writeFileSync(join(root, 'index.html'), '<h1>app</h1>')
    const searchHandler = createSearchHandler({ trustedOrigins: [] })
    const { appServer, frameServer, url } = await startLocal({
      appDir: root, frameDir: join(root, 'frame'), modelDir: join(root, 'models'), searchHandler, port: 0,
    })
    try {
      const res = await fetch(`${url}/api/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ query: 'x' }),
      })
      expect(res.status).toBe(503)
    } finally {
      appServer.close(); frameServer.close()
    }
  })
})
