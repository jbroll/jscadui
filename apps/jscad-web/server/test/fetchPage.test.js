import { describe, expect, it, vi } from 'vitest'
import { MAX_BODY_BYTES, fetchPage } from '../src/fetch/fetchPage.js'

const PUBLIC_DNS = async () => [{ address: '93.184.216.34' }]

const htmlResponse = (body) => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
  text: async () => body,
})

const redirectResponse = (location) => ({
  ok: false,
  status: 302,
  headers: new Headers({ location }),
  text: async () => '',
})

describe('fetchPage', () => {
  it('refuses a host that resolves to a private address', async () => {
    const fetchFn = vi.fn()
    const out = await fetchPage({
      url: 'https://internal.test/page',
      fetchFn,
      dnsLookup: async () => [{ address: '10.0.0.5' }],
    })
    expect(out.status).toBe(400)
    expect(out.body).toEqual({ error: 'fetch: refused a private address', name: 'BlockedHostError' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('gives up on a redirect chain longer than five hops', async () => {
    const fetchFn = vi.fn(async () => redirectResponse('https://example.com/loop'))
    const out = await fetchPage({ url: 'https://example.com/start', fetchFn, dnsLookup: PUBLIC_DNS })
    expect(out.status).toBe(502)
    expect(out.body).toEqual({ error: 'fetch: too many redirects', name: 'FetchError' })
    expect(fetchFn).toHaveBeenCalledTimes(6)
  })

  it('answers 413 TooLargeError for a body past the hard cap', async () => {
    const fetchFn = vi.fn(async () => htmlResponse('x'.repeat(MAX_BODY_BYTES + 100_000)))
    const out = await fetchPage({ url: 'https://example.com/huge', fetchFn, dnsLookup: PUBLIC_DNS })
    expect(out.status).toBe(413)
    expect(out.body).toEqual({ error: 'fetch: response too large', name: 'TooLargeError' })
  })

  it('rejects a non-http(s) URL before fetching', async () => {
    const fetchFn = vi.fn()
    const out = await fetchPage({ url: 'file:///etc/passwd', fetchFn, dnsLookup: PUBLIC_DNS })
    expect(out).toEqual({ status: 400, body: { error: 'fetch: url must be an http(s) URL', name: 'ValidationError' } })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('answers the page with its title, final URL without the query, and the upstream log entry', async () => {
    const fetchFn = vi.fn(async () => htmlResponse('<title>T</title><p>body</p>'))
    const logs = []
    const out = await fetchPage({
      url: 'https://example.com/page?token=secret',
      fetchFn,
      dnsLookup: PUBLIC_DNS,
      logger: (entry) => logs.push(entry),
    })
    expect(out).toEqual({
      status: 200,
      body: { ok: true, title: 'T', finalUrl: 'https://example.com/page', content: 'T\nbody', truncated: false },
    })
    expect(logs).toEqual([{ fetch: 'upstream', status: 200, bytes: 27 }])
  })
})
