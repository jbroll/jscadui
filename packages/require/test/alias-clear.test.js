import { describe, it, expect } from 'vitest'
import { requireCache, jscadClearTempCache, clearAllCaches } from '../src/require.js'
import { cacheManager } from '../src/caching/cacheManager.js'

describe('alias survives clear', () => {
  it('writes via requireCache.alias after clearTempCache are visible', () => {
    jscadClearTempCache()
    requireCache.alias['@test/foo'] = '/foo.js'
    expect(cacheManager.getAlias('@test/foo')).toBe('/foo.js')
  })
  it('writes via requireCache.alias after clearAllCaches are visible', () => {
    clearAllCaches()
    requireCache.alias['@test/bar'] = '/bar.js'
    expect(cacheManager.getAlias('@test/bar')).toBe('/bar.js')
  })
  it('writes via requireCache.local after clearAllCaches are visible', () => {
    clearAllCaches()
    requireCache.local['/test.js'] = { exports: 'test' }
    expect(cacheManager.get('/test.js', true)).toEqual({ exports: 'test' })
  })
})
