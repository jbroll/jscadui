import express from 'express'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { Agent } from 'undici'
import { MAX_BODY_BYTES, MAX_CONTENT_CHARS, mountFetchRoutes } from '../src/fetch/routes.js'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const PUBLIC_DNS = async () => [{ address: '93.184.216.34' }]

const fetchApp = (logs: unknown[], options: Record<string, unknown> = {}) => {
  const app = express()
  app.use(express.json())
  mountFetchRoutes(app, {
    trustedOrigins: ['https://app.test'],
    logger: (entry) => logs.push(entry),
    fetchFn: fetchMock,
    dnsLookup: PUBLIC_DNS,
    ...options,
  })
  return app
}

const streamOf = (parts: string[]) => {
  const chunks = parts.map((part) => new TextEncoder().encode(part));
  let at = 0;
  return {
    getReader: () => ({
      read: async () => (at < chunks.length ? { done: false, value: chunks[at++] } : { done: true, value: undefined }),
      cancel: async () => {},
      releaseLock: () => {},
    }),
  };
};

// A body that lies about its size: no Content-Length, an endless stream of
// chunks. Only an early abort keeps this from running forever, so the reader's
// read/cancel state is the assertion.
const endlessStream = () => {
  const state = { reads: 0, cancelled: false };
  const chunk = new Uint8Array(500_000);
  return {
    state,
    response: {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      body: {
        getReader: () => ({
          read: async () => {
            state.reads += 1;
            return { done: false, value: chunk };
          },
          cancel: async () => {
            state.cancelled = true;
          },
          releaseLock: () => {},
        }),
      },
      text: async () => {
        throw new Error('the route must stream, not buffer the whole body');
      },
    } as unknown as Response,
  };
};

const htmlResponse = (body: string, status = 200, headers: Record<string, string> = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8', ...headers }),
    body: streamOf([body]),
    text: async () => body,
  }) as unknown as Response

const redirectResponse = (location: string) =>
  ({
    ok: false,
    status: 302,
    headers: new Headers({ location }),
    text: async () => '',
  }) as unknown as Response

const post = (app: express.Express, body: unknown) =>
  request(app).post('/api/fetch').set('Origin', 'https://app.test').send(body as object)

describe('fetch routes', () => {
  it('refuses an untrusted origin with 403 before touching the network', async () => {
    const res = await request(fetchApp([])).post('/api/fetch').set('Origin', 'https://evil.test').send({ url: 'https://example.com' })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [{}, 'missing url'],
    [{ url: 'ftp://example.com' }, 'ftp scheme'],
    [{ url: 'file:///etc/passwd' }, 'file scheme'],
    [{ url: 'https://example.com', format: 'pdf' }, 'bad format'],
  ])('rejects %o (%s) with a ValidationError before fetching', async (body) => {
    const res = await post(fetchApp([]), body)
    expect(res.status).toBe(400)
    expect(res.body.name).toBe('ValidationError')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a host that resolves to a private address', async () => {
    const app = fetchApp([], { dnsLookup: async () => [{ address: '10.0.0.5' }] })
    const res = await post(app, { url: 'https://internal.test/page' })
    expect(res.status).toBe(400)
    expect(res.body.name).toBe('BlockedHostError')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a name that re-resolves private between the check and the connection', async () => {
    // The global fetch, which the old route fell back to, would happily return a
    // page — only the connect-time dispatcher lookup can catch the rebind.
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(async () => htmlResponse('<title>internal</title><p>secret</p>'))
    let resolutions = 0
    const flippingDns = async () => [{ address: resolutions++ === 0 ? '93.184.216.34' : '10.0.0.1' }]
    const res = await post(fetchApp([], { fetchFn: undefined, dnsLookup: flippingDns }), { url: 'https://rebind.test/page' })
    expect(res.status).toBe(400)
    expect(res.body.name).toBe('BlockedHostError')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches a public page, strips tags, decodes entities and returns the title', async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse(
        '<!doctype html><html><head><title>Hello &amp; World</title><style>p{}</style><script>evil()</script></head><body><h1>Head</h1><p>One &lt;two&gt; &amp; three</p><p>Second</p></body></html>',
      ),
    )
    const res = await post(fetchApp([]), { url: 'https://example.com/a' })
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Hello & World')
    expect(res.body.finalUrl).toBe('https://example.com/a')
    expect(res.body.truncated).toBe(false)
    expect(res.body.content).toContain('Head')
    expect(res.body.content).toContain('One <two> & three')
    expect(res.body.content).toContain('Second')
    expect(res.body.content).not.toContain('evil()')
    expect(res.body.content).not.toContain('p{}')
    expect(res.body.content).not.toContain('<p>')
  })

  it('accepts http as well as https', async () => {
    fetchMock.mockImplementation(async () => htmlResponse('<title>x</title><p>plain</p>'))
    const res = await post(fetchApp([]), { url: 'http://example.com/a' })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('http://example.com/a', expect.objectContaining({ redirect: 'manual' }))
  })

  it('escapes fence tokens and caps the content, flagging truncation', async () => {
    fetchMock.mockImplementation(async () => htmlResponse('```\n' + 'x'.repeat(9000)))
    const res = await post(fetchApp([]), { url: 'https://example.com/long' })
    expect(res.status).toBe(200)
    expect(res.body.content.length).toBe(MAX_CONTENT_CHARS)
    expect(res.body.content).not.toContain('```')
    expect(res.body.truncated).toBe(true)
  })

  it('follows a public redirect and reports the final URL', async () => {
    fetchMock
      .mockImplementationOnce(async () => redirectResponse('https://example.com/final'))
      .mockImplementationOnce(async () => htmlResponse('<title>Final</title><p>done</p>'))
    const res = await post(fetchApp([]), { url: 'https://example.com/start' })
    expect(res.status).toBe(200)
    expect(res.body.finalUrl).toBe('https://example.com/final')
    expect(res.body.title).toBe('Final')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a redirect that leaves http(s)', async () => {
    fetchMock.mockImplementationOnce(async () => redirectResponse('ftp://example.com/x'))
    const res = await post(fetchApp([]), { url: 'https://example.com/start' })
    expect(res.status).toBe(400)
    expect(res.body.name).toBe('ValidationError')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a redirect to a private address, per hop', async () => {
    fetchMock
      .mockImplementationOnce(async () => redirectResponse('https://example.com/next'))
      .mockImplementationOnce(async () => redirectResponse('http://127.0.0.1/admin'))
    const res = await post(fetchApp([]), { url: 'https://example.com/start' })
    expect(res.status).toBe(400)
    expect(res.body.name).toBe('BlockedHostError')
    // The first public hop fetched; the private hop was refused before fetching.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up on a redirect chain longer than five hops', async () => {
    fetchMock.mockImplementation(async () => redirectResponse('https://example.com/loop'))
    const res = await post(fetchApp([]), { url: 'https://example.com/start' })
    expect(res.status).toBe(502)
    expect(res.body.name).toBe('FetchError')
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('answers 502 FetchError when the upstream is not ok', async () => {
    fetchMock.mockImplementation(async () => htmlResponse('nope', 500))
    const res = await post(fetchApp([]), { url: 'https://example.com/x' })
    expect(res.status).toBe(502)
    expect(res.body.name).toBe('FetchError')
  })

  it('answers 502 FetchError when the upstream is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    const res = await post(fetchApp([]), { url: 'https://example.com/x' })
    expect(res.status).toBe(502)
    expect(res.body.name).toBe('FetchError')
  })

  it('answers 413 TooLargeError for a body past the hard cap', async () => {
    fetchMock.mockImplementation(async () => htmlResponse('x'.repeat(MAX_BODY_BYTES + 1)))
    const res = await post(fetchApp([]), { url: 'https://example.com/huge' })
    expect(res.status).toBe(413)
    expect(res.body.name).toBe('TooLargeError')
  })

  it('streams an endless, Content-Length-less body and aborts once past the cap', async () => {
    const { state, response } = endlessStream()
    fetchMock.mockImplementation(async () => response)
    const res = await post(fetchApp([]), { url: 'https://example.com/endless' })
    expect(res.status).toBe(413)
    expect(res.body.name).toBe('TooLargeError')
    // The reader was cancelled mid-stream, not drained to the end.
    expect(state.cancelled).toBe(true)
    // 2,000,000 / 500,000 = 4 chunks fit; the 5th crosses the cap and cancels.
    expect(state.reads).toBeLessThanOrEqual(5)
  })

  it('times out a hanging upstream and answers FetchError', async () => {
    fetchMock.mockImplementation(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        }),
    )
    const res = await post(fetchApp([], { timeoutMs: 15 }), { url: 'https://example.com/slow' })
    expect(res.status).toBe(502)
    expect(res.body.name).toBe('FetchError')
  })

  it('logs status and bytes and never a URL query secret', async () => {
    fetchMock.mockImplementation(async () => htmlResponse('<title>T</title><p>body</p>'))
    const logs: unknown[] = []
    const res = await post(fetchApp(logs), { url: 'https://example.com/page?token=super-secret' })
    expect(res.status).toBe(200)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ fetch: 'upstream', status: 200 })
    expect((logs[0] as { bytes: number }).bytes).toBeGreaterThan(0)
    expect(JSON.stringify(logs)).not.toContain('super-secret')
    expect(JSON.stringify(res.body)).not.toContain('super-secret')
  })

  it('never echoes a query secret in a failure body', async () => {
    fetchMock.mockRejectedValue(new Error('cannot reach https://example.com/page?token=super-secret'))
    const logs: unknown[] = []
    const res = await post(fetchApp(logs), { url: 'https://example.com/page?token=super-secret' })
    expect(res.status).toBe(502)
    expect(JSON.stringify(res.body)).not.toContain('super-secret')
    expect(JSON.stringify(logs)).not.toContain('super-secret')
  })

  it('exposes a close that shuts the public-only dispatcher', async () => {
    const closeSpy = vi.spyOn(Agent.prototype, 'close')
    const routes = mountFetchRoutes(express(), { trustedOrigins: ['https://app.test'], dnsLookup: PUBLIC_DNS })
    await routes.close()
    expect(closeSpy).toHaveBeenCalled()
    closeSpy.mockRestore()
  })
})
