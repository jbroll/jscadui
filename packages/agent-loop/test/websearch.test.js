import { describe, expect, it, vi } from 'vitest'
import { buildPool, createWebSearch, mcpCall, SNIPPET_MAX_CHARS } from '../src/websearch.js'

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
  it('keyless node pool is Exa and Parallel only (Firecrawl is keyed since 2026-10)', () => {
    expect(buildPool({ keys: {}, context: 'node' }).map((p) => p.id)).toEqual(['exa', 'parallel'])
  })

  it('keyed node pool adds Firecrawl, TinyFish and Tavily after the keyless providers', () => {
    const ids = buildPool({ keys: { firecrawl: 'k0', tinyfish: 'k1', tavily: 'k2' }, context: 'node' }).map((p) => p.id)
    expect(ids.slice(0, 2)).toEqual(['exa', 'parallel'])
    expect(ids).toContain('firecrawl')
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

  it('sends Accept for JSON + SSE so Exa does not 406', async () => {
    let sentHeaders = null
    const fetchFn = vi.fn(async (url, init) => {
      sentHeaders = init?.headers
      return searchResults(resultsFor(providerOf(String(url))))
    })
    const handler = createWebSearch({ fetchFn, context: 'node', projectId: 'accept-probe' })
    await handler({ query: 'willys mb wheelbase' })
    expect(sentHeaders?.Accept ?? sentHeaders?.accept).toMatch(/application\/json.*text\/event-stream/)
  })

  it('omits User-Agent in browser context so CORS preflight passes', async () => {
    let sentHeaders = null
    const fetchFn = vi.fn(async (url, init) => {
      sentHeaders = init?.headers
      return searchResults(resultsFor(providerOf(String(url))))
    })
    const handler = createWebSearch({ fetchFn, context: 'browser', projectId: 'cors-probe' })
    await handler({ query: 'willys mb wheelbase' })
    expect(sentHeaders).not.toMatchObject({ 'User-Agent': expect.anything() })
  })

  it('sends User-Agent in node context', async () => {
    let sentHeaders = null
    const fetchFn = vi.fn(async (url, init) => {
      sentHeaders = init?.headers
      return searchResults(resultsFor(providerOf(String(url))))
    })
    const handler = createWebSearch({ fetchFn, context: 'node', projectId: 'ua-probe', version: '9.9.9' })
    await handler({ query: 'willys mb wheelbase' })
    expect(sentHeaders?.['User-Agent']).toBe('jscadui/9.9.9')
  })

  it('maps query to Parallel objective+search_queries', async () => {
    let sentBody = null
    const fetchFn = vi.fn(async (url, init) => {
      if (String(url).includes('parallel')) {
        sentBody = JSON.parse(init.body).params.arguments
        return searchResults([{ title: 't', url: 'https://example.com', snippet: 's' }])
      }
      return jsonResponse(500, {})
    })
    const handler = createWebSearch({ fetchFn, context: 'node', projectId: 'parallel-args', pinned: 'parallel' })
    const res = await handler({ query: 'Willys MB wheelbase' })
    expect(res.ok).toBe(true)
    expect(sentBody).toMatchObject({ objective: expect.stringContaining('Willys MB'), search_queries: expect.any(Array) })
  })

  it('maps query to Exa query+objective+numResults', async () => {
    let sentBody = null
    const fetchFn = vi.fn(async (url, init) => {
      if (String(url).includes('exa.ai')) {
        sentBody = JSON.parse(init.body).params.arguments
        return searchResults([{ title: 't', url: 'https://example.com', snippet: 's' }])
      }
      return jsonResponse(500, {})
    })
    const handler = createWebSearch({ fetchFn, context: 'node', projectId: 'exa-args', pinned: 'exa' })
    const res = await handler({ query: 'Willys MB wheelbase', count: 5 })
    expect(res.ok).toBe(true)
    expect(sentBody).toMatchObject({ query: 'Willys MB wheelbase', objective: expect.any(String), numResults: 5 })
  })

  it('parses Parallel excerpts into snippets', async () => {
    const parallelBody = {
      result: { content: [{ type: 'text', text: JSON.stringify({ results: [{ url: 'https://example.com', title: 'T', excerpts: ['first excerpt', 'second'] }] }) }] },
    }
    const fetchFn = vi.fn(async (url) => {
      if (String(url).includes('parallel')) return jsonResponse(200, parallelBody)
      return jsonResponse(500, {})
    })
    const handler = createWebSearch({ fetchFn, context: 'node', projectId: 'parallel-excerpts', pinned: 'parallel' })
    const res = await handler({ query: 'Willys MB' })
    expect(res.ok).toBe(true)
    expect(res.results[0]).toMatchObject({ title: 'T', url: 'https://example.com', snippet: expect.stringContaining('first excerpt') })
  })

  it('parses Exa markdown highlights into results', async () => {
    const exaText = 'Title: Willys MB\nURL: https://example.com/mb\nHighlights:\nWheelbase 80 in vintage jeep\n\nTitle: Second\nURL: https://example.com/2\nHighlights:\nsecond snippet'
    const fetchFn = vi.fn(async (url) => {
      if (String(url).includes('exa.ai')) return jsonResponse(200, { result: { content: [{ type: 'text', text: exaText }] } })
      return jsonResponse(500, {})
    })
    const handler = createWebSearch({ fetchFn, context: 'node', projectId: 'exa-md', pinned: 'exa' })
    const res = await handler({ query: 'Willys MB' })
    expect(res.ok).toBe(true)
    expect(res.results[0]).toMatchObject({ title: 'Willys MB', url: 'https://example.com/mb', provider: 'exa' })
  })

  it('parses SSE event-stream bodies', async () => {
    const inner = JSON.stringify({ result: { results: [{ title: 't', url: 'https://example.com', snippet: 's' }] } })
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, text: async () => `event: message\ndata: ${inner}\n\n` }))
    const out = await mcpCall('https://mcp.exa.ai/mcp', 'web_search_exa', { query: 'x', objective: 'x' }, { fetchFn })
    expect(out.ok).toBe(true)
    expect(out.body?.result?.results?.[0]?.title).toBe('t')
  })

  it('reports per-provider failure detail instead of claiming cooldown', async () => {
    const handler = createWebSearch({ fetchFn: vi.fn(async () => jsonResponse(406, { error: { code: -32000 } })), context: 'node' })
    const res = await handler({ query: 'willys mb' })
    expect(res.ok).toBe(false)
    expect(res.error.name).toBe('SearchUnavailableError')
    expect(res.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ provider: expect.any(String), status: 406 })]))
    expect(res.error.message).not.toMatch(/cooling down/)
  })

  it('cooldown skips report the causing failure and retry-in, not bare cooldown', async () => {
    const fetchFn = vi.fn(async () => {
      return jsonResponse(429, {}, { 'retry-after': '55' })
    })
    const handler = createWebSearch({ fetchFn, context: 'node', projectId: 'cool-cause' })
    const first = await handler({ query: 'willys mb' })
    expect(first.ok).toBe(false)
    const before = fetchFn.mock.calls.length
    const second = await handler({ query: 'willys mb' })
    // Both providers cooling: no new network, but the cause survives.
    expect(fetchFn.mock.calls.length).toBe(before)
    expect(second.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: expect.any(String), status: 'cooldown', causedBy: expect.objectContaining({ status: 429 }) }),
      ]),
    )
    for (const entry of second.error.details) {
      expect(entry.retryInMs).toEqual(expect.any(Number))
      expect(entry.retryInMs).toBeGreaterThan(0)
    }
    expect(second.error.message).toMatch(/429/)
  })

  it('recovers after the cooldown expires', async () => {
    let mode = 'fail'
    const fetchFn = vi.fn(async (url) => {
      if (mode === 'fail') return jsonResponse(429, {})
      return searchResults(resultsFor(providerOf(String(url))))
    })
    const handler = createWebSearch({ fetchFn, context: 'node', projectId: 'cool-recover' })
    expect((await handler({ query: 'willys mb' })).ok).toBe(false)
    mode = 'ok'
    // Fast-forward past the 60 s cooldown.
    const realNow = Date.now
    try {
      const jumped = realNow() + 61_000
      Date.now = () => jumped
      const res = await handler({ query: 'willys mb' })
      expect(res.ok).toBe(true)
    } finally {
      Date.now = realNow
    }
  })
})
