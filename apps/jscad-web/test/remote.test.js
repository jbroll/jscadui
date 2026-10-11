import { afterEach, describe, expect, it, vi } from 'vitest'
import { gzipSync } from 'fflate'
import { fetchUrl, isValidRemoteUrl } from '../src/remote.js'

afterEach(() => vi.unstubAllGlobals())

const gzipDataUrl = (bytes) =>
  'data:application/gzip;base64,' + Buffer.from(gzipSync(bytes)).toString('base64')

describe('fetchUrl', () => {
  it('decodes a gzip data URL', async () => {
    const url = gzipDataUrl(new TextEncoder().encode('main()'))
    expect(await fetchUrl(url)).toBe('main()')
  })

  it('rejects a gzip data URL that inflates past the output cap', async () => {
    const url = gzipDataUrl(new Uint8Array(32 * 1024 * 1024))
    // Catch by hand: on a missing cap fetchUrl resolves the whole inflated
    // string, which is too large for the assertion reporter to format.
    const error = await fetchUrl(url).then(
      () => null,
      (err) => err,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/inflates past the 16 MiB limit/)
  })


  it('sends no credentials with a hash fetch', async () => {
    const fetch = vi.fn(async () => new Response('main()', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchUrl('https://example.com/model.js')).toBe('main()')
    expect(fetch).toHaveBeenCalledWith('https://example.com/model.js', { credentials: 'omit' })
  })

  it('treats a protocol-relative hash as remote, never same-origin', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(fetchUrl('//evil.example/model.js')).rejects.toThrow(/Invalid URL/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fails with a CORS hint and never falls back to a /remote proxy', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', fetch)
    await expect(fetchUrl('https://example.com/model.js')).rejects.toThrow(/CORS/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a private host before fetching', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(fetchUrl('http://192.168.1.1/admin')).rejects.toThrow(/Invalid URL/)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('isValidRemoteUrl', () => {
  it.each([
    'https://example.com/a.js',
    'http://93.184.216.34/a.js',
    'https://[2606:4700::1111]/a.js',
  ])('allows %s', (url) => {
    expect(isValidRemoteUrl(url)).toBe(true)
  })

  it.each([
    'ftp://example.com/a.js',
    'http://localhost/a.js',
    'http://127.0.0.5/a.js',
    'http://10.0.0.1/a.js',
    'http://172.16.0.1/a.js',
    'http://169.254.169.254/latest',
    'http://[::1]/a.js',
    'http://[fe80::1]/a.js',
    'http://[fd00::1]/a.js',
    'http://[::ffff:192.168.0.1]/a.js',
    'http://[::]/a.js',
  ])('blocks %s', (url) => {
    expect(isValidRemoteUrl(url)).toBe(false)
  })
})
