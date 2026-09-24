import { describe, it, expect, vi } from 'vitest'
import { createObjectCache } from './objectCache.js'

const scene = (cache, entities, build) => {
  cache.begin(false)
  const out = entities.map((e) => cache.get(e, build))
  cache.end()
  return out
}

describe('object cache', () => {
  it('builds only entities it has not seen', () => {
    vi.useFakeTimers()
    const dispose = vi.fn()
    const cache = createObjectCache(dispose)
    const build = vi.fn((e) => ({ from: e }))
    const a = {}, b = {}
    const [first] = scene(cache, [a], build)
    const [again, _second] = scene(cache, [a, b], build)
    expect(again).toBe(first)
    expect(build).toHaveBeenCalledTimes(2)
    vi.runAllTimers()
    expect(dispose).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('disposes objects whose entity is gone', () => {
    vi.useFakeTimers()
    const dispose = vi.fn()
    const cache = createObjectCache(dispose)
    const a = {}, b = {}
    const [objA] = scene(cache, [a, b], (e) => ({ e }))
    scene(cache, [b], (e) => ({ e }))
    vi.runAllTimers()
    expect(dispose).toHaveBeenCalledWith(objA)
    expect(dispose).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('rebuilds everything after a reset', () => {
    const dispose = vi.fn()
    const cache = createObjectCache(dispose)
    const a = {}
    const [before] = scene(cache, [a], (e) => ({ e }))
    cache.begin(true)
    expect(dispose).toHaveBeenCalledWith(before)
    expect(cache.get(a, (e) => ({ e }))).not.toBe(before)
    cache.end()
  })

  it('gives a repeated entity its own object', () => {
    const cache = createObjectCache(vi.fn())
    const a = {}
    const [x, y] = scene(cache, [a, a], (e) => ({ e }))
    expect(x).not.toBe(y)
  })

  it('flushes the earlier stale list when end() runs again before its timer fires', () => {
    vi.useFakeTimers()
    const dispose = vi.fn()
    const cache = createObjectCache(dispose)
    const a = {}, b = {}, c = {}
    const [objA] = scene(cache, [a, b], (e) => ({ e }))
    // second scene drops a, still pending disposal when the third scene starts
    cache.begin(false)
    cache.get(b, (e) => ({ e }))
    cache.end()
    // third scene, before the first setTimeout(0) has run, drops b too
    cache.begin(false)
    const objC = cache.get(c, (e) => ({ e }))
    cache.end()
    const disposed = () => dispose.mock.calls.map((call) => call[0])
    expect(disposed()).toContain(objA)
    vi.runAllTimers()
    expect(disposed()).not.toContain(objC)
    vi.useRealTimers()
  })

  it('disposes everything kept, pending, and in flight on clear()', () => {
    vi.useFakeTimers()
    const dispose = vi.fn()
    const cache = createObjectCache(dispose)
    const a = {}, b = {}
    const [objA] = scene(cache, [a], (e) => ({ e }))
    cache.begin(false)
    const objB = cache.get(b, (e) => ({ e }))
    cache.clear()
    expect(dispose).toHaveBeenCalledWith(objA)
    expect(dispose).toHaveBeenCalledWith(objB)
    vi.runAllTimers()
    expect(dispose).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
