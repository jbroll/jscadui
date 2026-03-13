/**
 * ModuleResolver - Centralized module and file resolution with memoization
 *
 * Responsibilities:
 * - URL resolution (relative, absolute, module)
 * - Memoization for performance
 * - Works with cacheManager for alias resolution
 *
 * Enables OPTIMIZATION-PLAN.md 2.2 (Memoize Path Resolution)
 */

import { resolveUrl as resolveUrlCore, MODULE_BASE } from '../resolveUrl.js'
import { cacheManager } from '../caching/cacheManager.js'

/**
 * ModuleResolver class with built-in memoization
 * Delegates alias management to cacheManager
 */
export class ModuleResolver {
  constructor() {
    /**
     * Memoization cache for resolution results
     * Key: `${url}|${base}|${root}|${moduleBase}`
     * Value: { url, isRelativeFile, isModule }
     *
     * O(1) lookup for repeated resolutions
     * @type {Map<string, {url: string, isRelativeFile: boolean, isModule: boolean}>}
     */
    this.resolutionCache = new Map()

    /**
     * Maximum number of cached resolutions
     * Prevents unbounded memory growth in long-running workers
     * @type {number}
     */
    this.maxCacheSize = 500
  }

  /**
   * Resolve a module or file URL with memoization
   *
   * @param {string} url - The URL to resolve
   * @param {string} base - Base URL for relative resolution
   * @param {string} root - Root URL (local file boundary)
   * @param {string} [moduleBase] - NPM module base URL
   * @returns {{url: string, isRelativeFile: boolean, isModule: boolean}}
   */
  resolve(url, base, root, moduleBase = MODULE_BASE) {
    // Check aliases first (delegated to cacheManager)
    const bundleAlias = cacheManager.getBundleAlias(url)
    const aliasedUrl = bundleAlias ?? cacheManager.getAlias(url) ?? url

    // Create cache key from all parameters
    const cacheKey = `${aliasedUrl}|${base}|${root}|${moduleBase}`

    // Check memoization cache
    const cached = this.resolutionCache.get(cacheKey)
    if (cached) {
      return cached
    }

    // Resolve using core logic
    const result = resolveUrlCore(aliasedUrl, base, root, moduleBase)

    // Cache the result for future lookups
    this.cacheResolution(cacheKey, result)

    return result
  }

  /**
   * Cache a resolution result with LRU eviction
   * @param {string} key - Cache key
   * @param {Object} result - Resolution result
   * @private
   */
  cacheResolution(key, result) {
    // Simple FIFO eviction when cache is full
    if (this.resolutionCache.size >= this.maxCacheSize) {
      // Remove oldest entries (first entries in Map)
      const toRemove = Math.floor(this.maxCacheSize * 0.2) // Remove 20%
      let removed = 0
      for (const key of this.resolutionCache.keys()) {
        this.resolutionCache.delete(key)
        if (++removed >= toRemove) break
      }
    }

    this.resolutionCache.set(key, result)
  }

  /**
   * Clear the resolution memoization cache
   * Call this when aliases change (via cacheManager) or for testing
   */
  clearCache() {
    this.resolutionCache.clear()
  }

  /**
   * Get cache statistics for debugging
   * @returns {{size: number, maxSize: number, hitRate: number}}
   */
  getCacheStats() {
    return {
      size: this.resolutionCache.size,
      maxSize: this.maxCacheSize,
      // Hit rate would need separate tracking in production use
      hitRate: 0,
    }
  }
}

/**
 * Singleton instance for the module system
 */
export const moduleResolver = new ModuleResolver()
