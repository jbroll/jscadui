// apps/jscad-web/scripts/local/fetchApi.test.js
import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { createFetchHandler } from './fetchApi.js'

const PUBLIC = async () => [{ address: '93.184.216.34' }]
const PRIVATE = async () => [{ address: '127.0.0.1' }]

const page = (html, init = {}) => new Response(html, { status: 200, headers: { 'content-type': 'text/html' }, ...init })

const withServer = async (t, options = {}) => {
  const calls = []
  const fetchFn = 'fetchFn' in options ? options.fetchFn : (async (url) => {
    calls.push(url)
    return page('<title>Gears</title><p>Involute teeth</p>')
  })
  const handler = createFetchHandler({ trustedOrigins: ['http://app.test'], dnsLookup: PUBLIC, ...options, fetchFn })
  const front = http.createServer((req, res) => {
    handler(req, res).then((handled) => {
      if (!handled) { res.writeHead(404); res.end() }
    })
  })
  await new Promise((r) => front.listen(0, '127.0.0.1', r))
  try {
    await t(`http://127.0.0.1:${front.address().port}`, calls)
  } finally {
    front.closeAllConnections(); front.close()
  }
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/api/fetch`, {
    method: 'POST',
    headers: { origin: 'http://app.test', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('local /api/fetch', () => {
  it('fetches a public page for a trusted origin', async () => {
    await withServer(async (base, calls) => {
      const res = await post(base, { url: 'https://example.com/gears?token=s', format: 'markdown' })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('http://app.test')
      expect(await res.json()).toEqual({
        ok: true,
        title: 'Gears',
        finalUrl: 'https://example.com/gears',
        content: 'Gears\nInvolute teeth',
        truncated: false,
      })
      expect(calls).toEqual(['https://example.com/gears?token=s'])
    })
  })

  it('refuses an untrusted origin with 403', async () => {
    await withServer(async (base, calls) => {
      const res = await post(base, { url: 'https://example.com/' }, { origin: 'https://evil.test' })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'untrusted origin' })
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
      expect(calls).toEqual([])
    })
  })

  it('refuses a private address', async () => {
    await withServer(async (base, calls) => {
      const res = await post(base, { url: 'https://intranet.example/' })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ name: 'BlockedHostError' })
      expect(calls).toEqual([])
    }, { dnsLookup: PRIVATE })
  })

  it('refuses a name that resolves public for the check and private for the connection', async () => {
    let lookups = 0
    const rebinding = async () => (++lookups === 1 ? [{ address: '93.184.216.34' }] : [{ address: '127.0.0.1' }])
    await withServer(async (base) => {
      const res = await post(base, { url: 'http://rebind.test/' })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ name: 'BlockedHostError' })
      expect(lookups).toBe(2)
    }, { dnsLookup: rebinding, fetchFn: undefined })
  })

  it('refuses a redirect that leads to a private address', async () => {
    const calls = []
    const fetchFn = async (url) => {
      calls.push(url)
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } })
    }
    await withServer(async (base) => {
      const res = await post(base, { url: 'https://example.com/' })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ name: 'BlockedHostError' })
      expect(calls).toEqual(['https://example.com/'])
    }, { fetchFn })
  })

  it('answers a missing url with the validation error', async () => {
    await withServer(async (base) => {
      const res = await post(base, 'not json')
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ name: 'ValidationError' })
    })
  })

  it('refuses a request body over 16 KB with 413', async () => {
    await withServer(async (base, calls) => {
      const res = await post(base, { url: `https://example.com/${'a'.repeat(17 * 1024)}` })
      expect(res.status).toBe(413)
      expect(await res.json()).toEqual({ error: 'payload too large' })
      expect(calls).toEqual([])
    })
  })

  it('rate limits a burst with 429 and Retry-After', async () => {
    await withServer(async (base) => {
      const statuses = []
      let retryAfter = null
      for (let i = 0; i < 11; i++) {
        const res = await post(base, { url: 'https://example.com/' })
        statuses.push(res.status)
        if (res.status === 429) retryAfter = res.headers.get('retry-after')
        await res.text()
      }
      expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
      expect(statuses[10]).toBe(429)
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1)
    })
  })

  it('answers a trusted preflight with the allowed method and header', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/fetch`, {
        method: 'OPTIONS',
        headers: { origin: 'http://app.test', 'access-control-request-method': 'POST' },
      })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('http://app.test')
      expect(res.headers.get('access-control-allow-methods')).toBe('POST,OPTIONS')
      expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type')
    })
  })

  it('answers an untrusted preflight without CORS headers', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/fetch`, { method: 'OPTIONS', headers: { origin: 'https://evil.test' } })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
      expect(res.headers.get('access-control-allow-methods')).toBeNull()
    })
  })

  it('answers 404 for another path', async () => {
    await withServer(async (base) => {
      const other = await fetch(`${base}/api/fetchx`, { method: 'POST', headers: { origin: 'http://app.test' }, body: '{}' })
      expect(other.status).toBe(404)
      const get = await fetch(`${base}/api/fetch`, { headers: { origin: 'http://app.test' } })
      expect(get.status).toBe(404)
    })
  })
})
