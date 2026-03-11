import { describe, it, expect, beforeEach } from 'vitest'
import { CacheManager } from '../src/caching/cacheManager.js'

describe('CacheManager', () => {
  let cache

  beforeEach(() => {
    cache = new CacheManager()
  })

  describe('basic get/set operations', () => {
    it('should store and retrieve local files', () => {
      cache.set('/path/to/file.js', { exports: 'test' }, true)
      const result = cache.get('/path/to/file.js', true)
      expect(result).toEqual({ exports: 'test' })
    })

    it('should store and retrieve modules', () => {
      cache.set('https://cdn.com/module.js', { exports: 'module' }, false)
      const result = cache.get('https://cdn.com/module.js', false)
      expect(result).toEqual({ exports: 'module' })
    })

    it('should return undefined for non-existent keys', () => {
      const result = cache.get('/nonexistent.js', true)
      expect(result).toBeUndefined()
    })

    it('should keep local and module caches separate', () => {
      const url = 'test.js'
      cache.set(url, { local: true }, true)
      cache.set(url, { module: true }, false)

      expect(cache.get(url, true)).toEqual({ local: true })
      expect(cache.get(url, false)).toEqual({ module: true })
    })
  })

  describe('LRU eviction', () => {
    it('should evict least recently used module when limit reached', () => {
      // Fill cache to limit (50 modules)
      for (let i = 0; i < 50; i++) {
        cache.set(`https://cdn.com/module${i}.js`, { id: i }, false)
      }

      // Don't access the cache here - accessing would update LRU order
      // Just add the 51st module which should evict the oldest (module0)
      cache.set('https://cdn.com/module50.js', { id: 50 }, false)

      // module0 should be evicted (it was the first added, so least recently used)
      expect(cache.get('https://cdn.com/module0.js', false)).toBeUndefined()
      // module50 should be cached
      expect(cache.get('https://cdn.com/module50.js', false)).toEqual({ id: 50 })
      // module1 should still be cached
      expect(cache.get('https://cdn.com/module1.js', false)).toEqual({ id: 1 })
    })

    it('should update LRU order on cache hit', () => {
      // Fill cache
      for (let i = 0; i < 50; i++) {
        cache.set(`https://cdn.com/module${i}.js`, { id: i }, false)
      }

      // Access module0 (making it most recently used)
      cache.get('https://cdn.com/module0.js', false)

      // Add new module - should evict module1 (now least recently used)
      cache.set('https://cdn.com/module50.js', { id: 50 }, false)

      // module0 should still be cached (was accessed recently)
      expect(cache.get('https://cdn.com/module0.js', false)).toEqual({ id: 0 })
      // module1 should be evicted
      expect(cache.get('https://cdn.com/module1.js', false)).toBeUndefined()
    })

    it('should not evict local files (no LRU limit)', () => {
      // Add 100 local files (more than module cache limit)
      for (let i = 0; i < 100; i++) {
        cache.set(`/local/file${i}.js`, { id: i }, true)
      }

      // All should still be cached
      expect(cache.get('/local/file0.js', true)).toEqual({ id: 0 })
      expect(cache.get('/local/file99.js', true)).toEqual({ id: 99 })
    })
  })

  describe('circular dependency detection', () => {
    it('should detect when a module is loading', () => {
      const url = 'https://cdn.com/circular.js'

      cache.markLoading(url)
      expect(cache.isLoading(url)).toBe(true)

      cache.unmarkLoading(url)
      expect(cache.isLoading(url)).toBe(false)
    })

    it('should handle multiple concurrent loads', () => {
      cache.markLoading('https://cdn.com/a.js')
      cache.markLoading('https://cdn.com/b.js')

      expect(cache.isLoading('https://cdn.com/a.js')).toBe(true)
      expect(cache.isLoading('https://cdn.com/b.js')).toBe(true)

      cache.unmarkLoading('https://cdn.com/a.js')

      expect(cache.isLoading('https://cdn.com/a.js')).toBe(false)
      expect(cache.isLoading('https://cdn.com/b.js')).toBe(true)
    })
  })

  describe('dependency tracking', () => {
    it('should track dependencies', () => {
      cache.trackDependency('https://cdn.com/main.js', 'https://cdn.com/dep1.js')
      cache.trackDependency('https://cdn.com/main.js', 'https://cdn.com/dep2.js')

      const deps = cache.getDependencies('https://cdn.com/main.js')
      expect(deps).toBeInstanceOf(Set)
      expect(deps.has('https://cdn.com/dep1.js')).toBe(true)
      expect(deps.has('https://cdn.com/dep2.js')).toBe(true)
    })

    it('should clear dependencies for a module', () => {
      cache.trackDependency('https://cdn.com/main.js', 'https://cdn.com/dep1.js')

      cache.clearDependencies('https://cdn.com/main.js')

      const deps = cache.getDependencies('https://cdn.com/main.js')
      expect(deps).toBeInstanceOf(Set)
      expect(deps.size).toBe(0)
    })

    it('should not track dependencies when base is undefined', () => {
      cache.trackDependency(undefined, 'https://cdn.com/dep1.js')

      expect(cache.getDependencies(undefined)).toBeUndefined()
    })
  })

  describe('cache clearing', () => {
    beforeEach(() => {
      // Setup: Add some cached data
      cache.set('/local/file.js', { local: true }, true)
      cache.set('https://cdn.com/module.js', { module: true }, false)
      cache.setAlias('/alias', '/real/path')
      cache.trackDependency('/local/file.js', '/local/dep.js')
      cache.trackDependency('https://cdn.com/module.js', 'https://cdn.com/dep.js')
      cache.markLoading('/local/loading.js')
    })

    it('should clear temp cache (local files, aliases, loading state)', () => {
      cache.clearTempCache()

      expect(cache.get('/local/file.js', true)).toBeUndefined()
      expect(cache.getAlias('/alias')).toBeUndefined()
      expect(cache.isLoading('/local/loading.js')).toBe(false)

      // Module cache should still exist
      expect(cache.get('https://cdn.com/module.js', false)).toEqual({ module: true })

      // HTTP dependencies should still exist
      expect(cache.getDependencies('https://cdn.com/module.js')).toBeDefined()

      // Local dependencies should be cleared
      expect(cache.getDependencies('/local/file.js')).toBeUndefined()
    })

    it('should clear all caches', () => {
      cache.clearAllCaches()

      expect(cache.get('/local/file.js', true)).toBeUndefined()
      expect(cache.get('https://cdn.com/module.js', false)).toBeUndefined()
      expect(cache.getAlias('/alias')).toBeUndefined()
      expect(cache.isLoading('/local/loading.js')).toBe(false)
      expect(cache.getDependencies('/local/file.js')).toBeUndefined()
      expect(cache.getDependencies('https://cdn.com/module.js')).toBeUndefined()
    })

    it('should clear file cache with dependency chain', () => {
      // Setup dependency chain with full URLs: a -> b -> c
      const root = 'http://localhost/'
      const aUrl = new URL('./a.js', root).toString()
      const bUrl = new URL('./b.js', root).toString()
      const cUrl = new URL('./c.js', root).toString()

      cache.set(aUrl, { id: 'a' }, true)
      cache.set(bUrl, { id: 'b' }, true)
      cache.set(cUrl, { id: 'c' }, true)

      // Track: a depends on b, b depends on c
      cache.trackDependency(aUrl, bUrl)
      cache.trackDependency(bUrl, cUrl)

      // Clear /c.js - should also clear /b.js and /a.js (which depend on it)
      cache.clearFileCache(['/c.js'], root)

      // All should be cleared due to dependency chain
      expect(cache.get(aUrl, true)).toBeUndefined()
      expect(cache.get(bUrl, true)).toBeUndefined()
      expect(cache.get(cUrl, true)).toBeUndefined()
    })
  })

  describe('LRU performance characteristics', () => {
    it('should perform O(1) get operations', () => {
      // Fill cache
      for (let i = 0; i < 50; i++) {
        cache.set(`https://cdn.com/module${i}.js`, { id: i }, false)
      }

      // Time 1000 cache hits
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        cache.get('https://cdn.com/module25.js', false)
      }
      const duration = performance.now() - start

      // Should complete in < 10ms (O(1) operations)
      expect(duration).toBeLessThan(10)
    })

    it('should perform O(1) set operations', () => {
      // Time 1000 cache sets
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        cache.set(`https://cdn.com/module${i % 50}.js`, { id: i }, false)
      }
      const duration = performance.now() - start

      // Should complete in < 20ms (O(1) operations with eviction)
      expect(duration).toBeLessThan(20)
    })
  })

  describe('backward compatibility', () => {
    it('should provide legacy cache objects', () => {
      const legacy = cache.getLegacyCacheObjects()

      expect(legacy).toHaveProperty('local')
      expect(legacy).toHaveProperty('alias')
      expect(legacy).toHaveProperty('bundleAlias')
      expect(legacy).toHaveProperty('module')
      expect(legacy).toHaveProperty('knownDependencies')
      expect(legacy).toHaveProperty('moduleAccessOrder')
      expect(legacy).toHaveProperty('loading')
    })

    it('should allow setting deprecated properties without throwing', () => {
      const legacy = cache.getLegacyCacheObjects()

      // Should not throw, but will warn
      expect(() => {
        legacy.module = {}
        legacy.moduleAccessOrder = []
      }).not.toThrow()
    })
  })
})
