import { describe, expect, it, vi } from 'vitest'
import { buildPool, createWebSearch, SNIPPET_MAX_CHARS } from '../src/websearch.js'

const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
})

const searchResults = (results) => jsonResponse(200, { result: { results } })

const resultsFor = (provider) => [{ title: `${provider} hit`, url: 'https://example.com/hit', snippet: 'a snippet' }]

const providerOf = (url) => {
  if (url.includes('exa.ai')) return 'exa'
  if (url.includes('parallel')) return 'parallel'
  if (url.includes('firecrawl')) return 'firecrawl'
  return 'other'
}

const successFetch = (seen = []) =>
  vi.fn(async (url) => {
    seen.push(url)
    return searchResults(resultsFor(providerOf(url)))
  })

describe('buildPool', () => {
  it('keyless node pool is Exa, Parallel, Firecrawl only', () => {
    expect(buildPool({ keys: {}, context: 'node' }).map((p) => p.id)).toEqual(['exa', 'parallel', 'firecrawl'])
  })

  it('keyed node pool adds TinyFish and Tavily after the keyless providers', () => {
    const ids = buildPool({ keys: { tinyfish: 'k1', tavily: 'k2' }, context: 'node' }).map((p) => p.id)
    expect(ids.slice(0, 3)).toEqual(['exa', 'parallel', 'firecrawl'])
    expect(ids).toContain('tinyfish')
    expect(ids).toContain('tavily')
  })

  it('browser pool never contains Tavily, even with a Tavily key', () => {
    const ids = buildPool({ keys: { tinyfish: 'k1', tavily: 'k2' }, context: 'browser' }).map((p) => p.id)
    expect(ids).not.toContain('tavily')
    expect(ids).toContain('tinyfish')
  })
})

describe('createWebSearch', () => {
  it('sticks to one provider per conversation id', async () => {
    const seenA = []
    const handlerA = createWebSearch({ fetchFn: successFetch(seenA), context: 'node', projectId: 'proj-1' })
    await handlerA({ query: 'bearing 608' })
    await handlerA({ query: 'bearing 608' })
    const seenB = []
    const handlerB = createWebSearch({ fetchFn: successFetch(seenB), context: 'node', projectId: 'proj-1' })
    await handlerB({ query: 'bearing 608' })
    expect(seenA[0]).toBe(seenA[1])
    expect(seenB[0]).toBe(seenA[0])
  })

  it('fails over from a 429 to the next provider and tags the serving provider', async () => {
    let calls = 0
    const fetchFn = vi.fn(async (url) => {
      calls += 1
      if (calls === 1) return jsonResponse(429, {})
      return searchResults(resultsFor(providerOf(url)))
    })
    const handler = createWebSearch({ fetchFn, context: 'node', projectId: 'any-conversation' })
    const res = await handler({ query: 'linear rail' })
    expect(res.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    const [firstUrl, secondUrl] = fetchFn.mock.calls.map(([url]) => url)
    expect(secondUrl).not.toBe(firstUrl)
    expect(res.results[0]).toMatchObject({ provider: providerOf(secondUrl) })
  })

  it('answers SearchUnavailableError when every provider cools down', async () => {
    const handler = createWebSearch({ fetchFn: vi.fn(async () => jsonResponse(429, {})), context: 'node' })
    const res = await handler({ query: ' timing belt' })
    expect(res).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'SearchUnavailableError' }) }))
  })

  it('caps snippet chars and escapes fence tokens', async () => {
    const long = `x${'```'}y${'o'.repeat(SNIPPET_MAX_CHARS + 100)}`
    const handler = createWebSearch({
      fetchFn: vi.fn(async () => searchResults([{ title: 't', url: 'https://example.com', snippet: long }])),
      context: 'node',
    })
    const res = await handler({ query: 'fence' })
    expect(res.ok).toBe(true)
    expect(res.results[0].snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 8)
    expect(res.results[0].snippet).not.toContain('```')
  })

  it('rejects an empty query without touching the network', async () => {
    const fetchFn = vi.fn(async () => searchResults([]))
    const handler = createWebSearch({ fetchFn, context: 'node' })
    const res = await handler({ query: '   ' })
    expect(res).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'ValidationError' }) }))
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('works in browser globals without process', async () => {
    const saved = globalThis.process
    // @ts-expect-error simulate browser where Node process is undefined
    delete globalThis.process
    try {
      const handler = createWebSearch({ fetchFn: successFetch(), context: 'browser', projectId: 'browser-proj' })
      const res = await handler({ query: 'Ford F-150 14th generation styling cues' })
      expect(res.ok).toBe(true)
    } finally {
      if (saved !== undefined) globalThis.process = saved
    }
  })
})
