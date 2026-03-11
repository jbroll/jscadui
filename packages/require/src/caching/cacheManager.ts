/**
 * CacheManager - Centralized caching for the module loader
 *
 * Manages three types of caches:
 * 1. Local file cache (project files)
 * 2. Module cache with O(1) LRU eviction (CDN modules)
 * 3. Dependency tracking for cache invalidation
 * 4. Circular dependency detection
 */

/**
 * Node for doubly-linked list used in O(1) LRU implementation
 */
class LRUNode {
  constructor(
    public key: string,
    public value: unknown,
    public prev: LRUNode | null = null,
    public next: LRUNode | null = null
  ) {}
}

/**
 * O(1) LRU Cache implementation using doubly-linked list + Map
 * Replaces the O(n) array-based implementation
 */
class LRUCache {
  private cache: Map<string, LRUNode> = new Map()
  private head: LRUNode | null = null // Most recently used
  private tail: LRUNode | null = null // Least recently used
  private size = 0

  constructor(private maxSize: number) {}

  /**
   * Get value from cache and mark as recently used - O(1)
   */
  get(key: string): unknown | undefined {
    const node = this.cache.get(key)
    if (!node) return undefined

    // Move to head (most recently used)
    this.moveToHead(node)
    return node.value
  }

  /**
   * Set value in cache, evicting LRU if needed - O(1)
   * Returns the evicted key if an entry was removed, undefined otherwise
   */
  set(key: string, value: unknown): string | undefined {
    let node = this.cache.get(key)

    if (node) {
      // Update existing node
      node.value = value
      this.moveToHead(node)
      return undefined
    } else {
      // Create new node
      node = new LRUNode(key, value)
      this.cache.set(key, node)
      this.addToHead(node)
      this.size++

      // Evict LRU if over limit
      if (this.size > this.maxSize) {
        const removed = this.removeTail()
        if (removed) {
          this.cache.delete(removed.key)
          this.size--
          // Return the evicted key for cleanup
          return removed.key
        }
      }
      return undefined
    }
  }

  /**
   * Delete key from cache - O(1)
   */
  delete(key: string): boolean {
    const node = this.cache.get(key)
    if (!node) return false

    this.removeNode(node)
    this.cache.delete(key)
    this.size--
    return true
  }

  /**
   * Check if key exists - O(1)
   */
  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear()
    this.head = null
    this.tail = null
    this.size = 0
  }

  /**
   * Get current size
   */
  getSize(): number {
    return this.size
  }

  /**
   * Move node to head (most recently used)
   */
  private moveToHead(node: LRUNode): void {
    if (node === this.head) return
    this.removeNode(node)
    this.addToHead(node)
  }

  /**
   * Add node to head
   */
  private addToHead(node: LRUNode): void {
    node.next = this.head
    node.prev = null

    if (this.head) {
      this.head.prev = node
    }
    this.head = node

    if (!this.tail) {
      this.tail = node
    }
  }

  /**
   * Remove node from list
   */
  private removeNode(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      this.head = node.next
    }

    if (node.next) {
      node.next.prev = node.prev
    } else {
      this.tail = node.prev
    }
  }

  /**
   * Remove tail (least recently used)
   */
  private removeTail(): LRUNode | null {
    if (!this.tail) return null
    const node = this.tail
    this.removeNode(node)
    return node
  }
}

/**
 * Maximum number of modules to keep in cache (LRU eviction)
 */
const MAX_MODULE_CACHE_SIZE = 50

/**
 * Central cache manager for the module system
 */
export class CacheManager {
  // Local file cache (project files) - simple key-value, no LRU
  private localCache: Record<string, unknown> = Object.create(null)

  // Module cache with O(1) LRU eviction
  private moduleCache = new LRUCache(MAX_MODULE_CACHE_SIZE)

  // Dependency tracking: which modules depend on which
  private dependencies = new Map<string, Set<string>>()

  // Circular dependency detection: modules currently being loaded
  private loading = new Set<string>()

  // URL aliases for module resolution
  private aliases: Record<string, string> = Object.create(null)
  private bundleAliases: Record<string, string> = Object.create(null)

  /**
   * Get module from cache (local or module cache)
   */
  get(url: string, isRelativeFile: boolean): unknown | undefined {
    if (isRelativeFile) {
      return this.localCache[url]
    } else {
      return this.moduleCache.get(url)
    }
  }

  /**
   * Set module in cache (local or module cache)
   */
  set(url: string, value: unknown, isRelativeFile: boolean): void {
    if (isRelativeFile) {
      this.localCache[url] = value
    } else {
      const evictedKey = this.moduleCache.set(url, value)
      // Clean up dependencies for evicted module
      if (evictedKey) {
        this.dependencies.delete(evictedKey)
      }
    }
  }

  /**
   * Check if currently loading (for circular dependency detection)
   */
  isLoading(url: string): boolean {
    return this.loading.has(url)
  }

  /**
   * Mark module as loading
   */
  markLoading(url: string): void {
    this.loading.add(url)
  }

  /**
   * Unmark module as loading
   */
  unmarkLoading(url: string): void {
    this.loading.delete(url)
  }

  /**
   * Track dependency: baseUrl depends on dependencyUrl
   */
  trackDependency(baseUrl: string | undefined, dependencyUrl: string): void {
    if (!baseUrl) return

    if (!this.dependencies.has(baseUrl)) {
      this.dependencies.set(baseUrl, new Set())
    }
    this.dependencies.get(baseUrl)!.add(dependencyUrl)
  }

  /**
   * Get dependencies of a module
   */
  getDependencies(url: string): Set<string> | undefined {
    return this.dependencies.get(url)
  }

  /**
   * Clear dependencies for a module
   */
  clearDependencies(url: string): void {
    this.dependencies.set(url, new Set())
  }

  /**
   * Get URL alias
   */
  getAlias(url: string): string | undefined {
    return this.aliases[url]
  }

  /**
   * Set URL alias
   */
  setAlias(url: string, alias: string): void {
    this.aliases[url] = alias
  }

  /**
   * Get bundle alias
   */
  getBundleAlias(url: string): string | undefined {
    return this.bundleAliases[url]
  }

  /**
   * Clear file cache for specific files with dependency tracking
   */
  clearFileCache(files: string[], root?: string): void {
    const clearDependencies = (url: string) => {
      delete this.localCache[url]

      // Find all modules that depend on this url
      const dependents = [...this.dependencies.entries()]
        .filter(([_, deps]) => deps.has(url))

      for (const [dependent, _] of dependents) {
        clearDependencies(dependent)
      }
    }

    for (const file of files) {
      delete this.localCache[file]

      if (root !== undefined) {
        const path = file.startsWith("/") ? `.${file}` : file
        const url = new URL(path, root).toString()
        clearDependencies(url)
      }
    }
  }

  /**
   * Clear project-specific cache (local files, aliases, loading state)
   * Keep module cache for reuse across script runs
   */
  clearTempCache(): void {
    this.localCache = Object.create(null)
    this.aliases = Object.create(null)
    this.loading.clear()

    // Clear dependency tracking for local files to prevent memory leaks
    // Keep only module dependencies (entries starting with http)
    for (const key of this.dependencies.keys()) {
      if (!key.startsWith('http')) {
        this.dependencies.delete(key)
      }
    }
  }

  /**
   * Clear all caches including module cache
   * Use for long-running applications to prevent unbounded memory growth
   */
  clearAllCaches(): void {
    this.localCache = Object.create(null)
    this.aliases = Object.create(null)
    this.moduleCache.clear()
    this.dependencies.clear()
    this.loading.clear()
  }

  /**
   * Get legacy cache objects for backward compatibility
   * TODO: Remove once all code migrated to CacheManager methods
   */
  getLegacyCacheObjects() {
    return {
      local: this.localCache,
      alias: this.aliases,
      bundleAlias: this.bundleAliases,
      // Backward compatibility: allow setting module cache for tests
      // but it's a no-op since we use LRU now
      get module() {
        // Return empty object for compatibility
        return Object.create(null)
      },
      set module(_value: unknown) {
        // Ignore attempts to set module cache directly
        // Tests should use clearAllCaches() instead
        console.warn('Setting requireCache.module is deprecated - use cacheManager.clearAllCaches()')
      },
      knownDependencies: this.dependencies,
      // Backward compatibility: allow setting moduleAccessOrder for tests
      get moduleAccessOrder() {
        return []
      },
      set moduleAccessOrder(_value: unknown) {
        // Ignore - LRU order is managed internally
        console.warn('Setting requireCache.moduleAccessOrder is deprecated')
      },
      loading: this.loading,
    }
  }
}

/**
 * Singleton instance for the module system
 */
export const cacheManager = new CacheManager()
