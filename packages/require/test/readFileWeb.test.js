import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileWeb, resetReadFileRateLimit } from '../src/readFileWeb.js'

const okXhr = () => ({
  open: vi.fn(),
  overrideMimeType: vi.fn(),
  send: vi.fn(),
  status: 200,
  statusText: 'OK',
  responseText: 'content',
})

describe('readFileWeb rate limit', () => {
  beforeEach(() => {
    resetReadFileRateLimit()
    vi.stubGlobal('XMLHttpRequest', function () { return okXhr() })
    vi.stubGlobal('self', { location: { origin: 'http://localhost' } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('fetches normally under the burst limit', () => {
    expect(readFileWeb('a.js', { base: 'http://cdn/' })).toBe('content')
    expect(readFileWeb('b.js', { base: 'http://cdn/' })).toBe('content')
  })

  it('fails fast when a runaway model bursts requests', () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    let threw = false
    try {
      for (let i = 0; i < 500; i++) readFileWeb(`${i}.js`, { base: 'http://cdn/' })
    } catch (err) {
      threw = true
      expect(err.message).toMatch(/rate/)
    } finally {
      vi.restoreAllMocks()
    }
    expect(threw).toBe(true)
  })
})
