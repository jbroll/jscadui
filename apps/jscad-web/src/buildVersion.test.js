import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildHashOf, currentBuildHash, watchBuildHash } from './buildVersion.js'

const INDEX = (hash) => `<!doctype html><html><head><script src="/assets/main.${hash}.js"></script></head></html>`

describe('buildHashOf', () => {
  it('extracts the content hash of the main entry', () => {
    expect(buildHashOf(INDEX('940c3eec'))).toBe('940c3eec')
  })

  it('returns null for a dev page with unhashed entries', () => {
    expect(buildHashOf('<!doctype html><html><head><script src="/main.js"></script></head></html>')).toBeNull()
  })
})

describe('currentBuildHash', () => {
  it('fetches the served index without caching and reads its hash', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, text: async () => INDEX('940c3eec') }))
    await expect(currentBuildHash({ fetchFn, url: '/' })).resolves.toBe('940c3eec')
    expect(fetchFn).toHaveBeenCalledWith('/', { cache: 'no-store' })
  })

  it('returns null when the fetch fails or is not ok', async () => {
    await expect(currentBuildHash({ fetchFn: async () => { throw new Error('down') }, url: '/' })).resolves.toBeNull()
    await expect(currentBuildHash({ fetchFn: async () => ({ ok: false }), url: '/' })).resolves.toBeNull()
  })
})

describe('watchBuildHash', () => {
  afterEach(() => vi.useRealTimers())

  it('stays quiet while the served build matches', async () => {
    vi.useFakeTimers()
    const fetchFn = vi.fn(async () => ({ ok: true, text: async () => INDEX('940c3eec') }))
    const onNewVersion = vi.fn()
    const stop = watchBuildHash({ current: '940c3eec', intervalMs: 1000, fetchFn, url: '/', onNewVersion })
    await vi.advanceTimersByTimeAsync(5000)
    expect(onNewVersion).not.toHaveBeenCalled()
    stop()
  })

  it('reports once when a newer build is served, then stops polling', async () => {
    vi.useFakeTimers()
    const fetchFn = vi.fn(async () => ({ ok: true, text: async () => INDEX('ffb21482') }))
    const onNewVersion = vi.fn()
    watchBuildHash({ current: '940c3eec', intervalMs: 1000, fetchFn, url: '/', onNewVersion })
    await vi.advanceTimersByTimeAsync(1000)
    expect(onNewVersion).toHaveBeenCalledTimes(1)
    expect(onNewVersion).toHaveBeenCalledWith('ffb21482')
    const calls = fetchFn.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchFn.mock.calls.length).toBe(calls)
  })

  it('ignores unhashable responses instead of reporting them', async () => {
    vi.useFakeTimers()
    const fetchFn = vi.fn(async () => ({ ok: true, text: async () => 'no hashed entry here' }))
    const onNewVersion = vi.fn()
    const stop = watchBuildHash({ current: '940c3eec', intervalMs: 1000, fetchFn, url: '/', onNewVersion })
    await vi.advanceTimersByTimeAsync(3000)
    expect(onNewVersion).not.toHaveBeenCalled()
    stop()
  })
})
