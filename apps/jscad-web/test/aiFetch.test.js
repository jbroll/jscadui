import { describe, expect, it, vi } from 'vitest'
import { createWebFetchHandler, FETCH_CONTENT_CHARS } from '../src/aiFetch.js'

const relay = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
})

describe('page webfetch handler', () => {
  it('posts url and format to POST /api/fetch and answers the relay page', async () => {
    const fetchFn = vi.fn(async () =>
      relay({ ok: true, title: 'T', finalUrl: 'https://example.com/a', content: 'hello', truncated: false }),
    )
    const handler = createWebFetchHandler({ fetchFn })
    const res = await handler({ url: 'https://example.com/a' })
    expect(res).toEqual({ ok: true, title: 'T', finalUrl: 'https://example.com/a', content: 'hello', truncated: false })
    const [url, init] = fetchFn.mock.calls[0]
    expect(String(url)).toBe('/api/fetch')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ url: 'https://example.com/a', format: 'markdown' })
    // The browser never holds a provider key for fetch, and must never attach one.
    expect(init.headers?.Authorization).toBeUndefined()
  })

  it('passes the requested text format through', async () => {
    const fetchFn = vi.fn(async () => relay({ ok: true, title: '', finalUrl: 'https://e/x', content: 'x', truncated: false }))
    await createWebFetchHandler({ fetchFn })({ url: 'https://e/x', format: 'text' })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ url: 'https://e/x', format: 'text' })
  })

  it('maps a relay too-large error to TooLargeError', async () => {
    const fetchFn = vi.fn(async () => relay({ error: 'fetch: response too large', name: 'TooLargeError' }, 413))
    const res = await createWebFetchHandler({ fetchFn })({ url: 'https://e/x' })
    expect(res).toMatchObject({ ok: false, error: { name: 'TooLargeError', message: 'fetch: response too large' } })
  })

  it('maps a private-IP redirect refusal to BlockedHostError', async () => {
    const fetchFn = vi.fn(async () => relay({ error: 'fetch: refused a redirect to a private address', name: 'BlockedHostError' }, 400))
    const res = await createWebFetchHandler({ fetchFn })({ url: 'https://e/x' })
    expect(res).toMatchObject({ ok: false, error: { name: 'BlockedHostError' } })
  })

  it('falls back to FetchError for an unnamed relay failure', async () => {
    const fetchFn = vi.fn(async () => relay({ error: 'upstream unreachable' }, 502))
    const res = await createWebFetchHandler({ fetchFn })({ url: 'https://e/x' })
    expect(res).toMatchObject({ ok: false, error: { name: 'FetchError', message: 'upstream unreachable' } })
  })

  it('escapes fence tokens and caps the content at the 8000-char limit', async () => {
    const long = '```\n' + 'x'.repeat(9000)
    const fetchFn = vi.fn(async () => relay({ ok: true, title: '', finalUrl: 'https://e/x', content: long, truncated: false }))
    const res = await createWebFetchHandler({ fetchFn })({ url: 'https://e/x' })
    expect(res.content.length).toBe(FETCH_CONTENT_CHARS)
    expect(res.content).not.toContain('```')
    expect(res.truncated).toBe(true)
  })

  it('honors a relay marked truncated even under the cap', async () => {
    const fetchFn = vi.fn(async () => relay({ ok: true, title: '', finalUrl: 'https://e/x', content: 'short', truncated: true }))
    expect((await createWebFetchHandler({ fetchFn })({ url: 'https://e/x' })).truncated).toBe(true)
  })

  it('rejects a url that is not http(s) without touching the network', async () => {
    const fetchFn = vi.fn()
    for (const url of ['ftp://x', 'file:///etc/passwd', 'not a url', '']) {
      const res = await createWebFetchHandler({ fetchFn })({ url })
      expect(res, url).toMatchObject({ ok: false, error: { name: 'ValidationError' } })
    }
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('answers FetchError when the relay is unreachable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network down')
    })
    const res = await createWebFetchHandler({ fetchFn })({ url: 'https://e/x' })
    expect(res).toMatchObject({ ok: false, error: { name: 'FetchError' } })
    expect(res.error.message).toMatch(/network down/)
  })

  it('returns exactly the documented fields, reflecting no other relay key', async () => {
    const fetchFn = vi.fn(async () => relay({ ok: true, title: 'T', finalUrl: 'https://e/x', content: 'c', truncated: false, secret: 'sk-leak' }))
    const res = await createWebFetchHandler({ fetchFn })({ url: 'https://e/x' })
    expect(Object.keys(res).sort()).toEqual(['content', 'finalUrl', 'ok', 'title', 'truncated'])
    expect(JSON.stringify(res)).not.toContain('sk-leak')
  })
})
