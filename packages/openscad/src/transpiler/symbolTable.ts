/**
 * Unified symbol table for tracking module, function, and variable definitions.
 *
 * Single source of truth for all symbol information, consolidating what were previously
 * multiple overlapping Sets and Maps scattered across TranspileContext.
 *
 * Design principles:
 * 1. Single source of truth for each symbol
 * 2. Query by kind (module/function/variable) or source (local/imported/included)
 * 3. Support for dual-defined names (function and module with same name)
 * 4. Parameter list tracking integrated with symbol info
 */

/**
 * The kind of symbol being tracked
 */
export type SymbolKind = 'module' | 'function' | 'variable'

/**
 * Where the symbol came from
 * - 'local': defined in the current file
 * - 'imported': explicitly imported via use <...>
 * - 'included': explicitly included via include <...>
 * - 'inherited': passed from parent context for named-arg reordering (NOT explicitly imported)
 */
export type SymbolSource = 'local' | 'imported' | 'included' | 'inherited'

/**
 * Information about a tracked symbol
 */
export interface SymbolInfo {
  kind: SymbolKind
  source: SymbolSource
  /** Parameter names for modules/functions (for named argument reordering) */
  params?: string[]
}

/**
 * Information about a dual-defined symbol (both module and function)
 */
export interface DualSymbolInfo {
  isDual: true
  module: SymbolInfo
  function: SymbolInfo
}

/**
 * Internal storage type - either a single symbol or dual symbol
 */
type StoredSymbol = SymbolInfo | DualSymbolInfo

/**
 * Type guard to check if a symbol is dual-defined
 */
function isDualSymbol(symbol: StoredSymbol): symbol is DualSymbolInfo {
  return 'isDual' in symbol && symbol.isDual === true
}

/**
 * Source priority for symbol definitions.
 * Higher number = higher priority.
 * 'local' always wins over 'included', 'imported', 'inherited'.
 */
const SOURCE_PRIORITY: Record<SymbolSource, number> = {
  local: 4,
  included: 3,
  imported: 2,
  inherited: 1,
}

/**
 * Returns true if newSource should replace existingSource.
 * Only replaces if new priority >= existing priority
 * (equal priority allows parameter updates for the same source level).
 */
function shouldUpdateSource(existingSource: SymbolSource, newSource: SymbolSource): boolean {
  return SOURCE_PRIORITY[newSource] >= SOURCE_PRIORITY[existingSource]
}

/**
 * Unified symbol table for tracking definitions during transpilation.
 *
 * Handles the case where a name can have both a module AND function version
 * (common in BOSL2 where many modules also have function forms).
 *
 * Internal storage uses a union type (StoredSymbol) that can represent
 * either a single-kind symbol or a dual-defined symbol, eliminating the
 * need for separate storage structures and swap logic.
 */
export class SymbolTable {
  /** Symbol storage - single Map for both regular and dual-defined symbols */
  private symbols = new Map<string, StoredSymbol>()

  /**
   * Param-only storage for cases where params are needed for argument reordering
   * but the symbol isn't defined in the main table (e.g., USE imports add params
   * for modules but don't define them as modules since they use require() semantics)
   */
  private moduleParams = new Map<string, string[]>()
  private functionParams = new Map<string, string[]>()

  /**
   * Lazy caches for getByKind() and getDualDefined().
   * Invalidated on every define() call; rebuilt on first query after invalidation.
   * Reduces repeated O(N) symbol-map scans to a single O(N) build + O(1) lookups.
   */
  private kindCache: Map<SymbolKind, string[]> | null = null
  private dualCache: string[] | null = null

  /**
   * Define a symbol in the table
   *
   * If a name already exists with a different kind, marks it as dual-defined
   * and stores both versions.
   */
  define(name: string, info: SymbolInfo): void {
    // Invalidate lazy caches on any mutation
    this.kindCache = null
    this.dualCache = null

    const existing = this.symbols.get(name)

    if (existing) {
      // If already dual-defined, update the appropriate version
      if (isDualSymbol(existing)) {
        if (info.kind === 'module') {
          // Only update if new source has equal or higher priority
          if (shouldUpdateSource(existing.module.source, info.source)) {
            existing.module = info
          }
          return
        } else if (info.kind === 'function') {
          // Only update if new source has equal or higher priority
          if (shouldUpdateSource(existing.function.source, info.source)) {
            existing.function = info
          }
          return
        }
        // Variable kind falls through to replace the whole entry below
      } else {
        // Single-kind symbol exists
        // Check if this creates a dual-defined name (module + function)
        if (existing.kind !== info.kind) {
          if (
            (existing.kind === 'module' && info.kind === 'function') ||
            (existing.kind === 'function' && info.kind === 'module')
          ) {
            // Create dual-defined entry - no swap logic needed!
            const dual: DualSymbolInfo = {
              isDual: true,
              module: existing.kind === 'module' ? existing : info,
              function: existing.kind === 'function' ? existing : info,
            }
            this.symbols.set(name, dual)
            return
          }
          // Different incompatible kinds - replace (variables can be shadowed)
        } else {
          // Same kind: only update if new source has equal or higher priority
          if (!shouldUpdateSource(existing.source, info.source)) {
            return
          }
        }
      }
    }

    this.symbols.set(name, info)
  }

  /**
   * Look up a symbol by name
   *
   * @param name - The symbol name
   * @param preferKind - For dual-defined names, which kind to return
   */
  lookup(name: string, preferKind?: 'module' | 'function'): SymbolInfo | undefined {
    const stored = this.symbols.get(name)
    if (!stored) return undefined

    if (isDualSymbol(stored)) {
      // For dual-defined, return the preferred kind (default to module)
      return preferKind === 'function' ? stored.function : stored.module
    }

    return stored
  }

  /**
   * Check if a name is defined
   */
  isDefined(name: string): boolean {
    return this.symbols.has(name)
  }

  /**
   * Check if a name is dual-defined (has both module and function versions)
   */
  isDualDefined(name: string): boolean {
    const stored = this.symbols.get(name)
    return stored ? isDualSymbol(stored) : false
  }

  /**
   * Check if a name is defined as a specific kind
   */
  isKind(name: string, kind: SymbolKind): boolean {
    const stored = this.symbols.get(name)
    if (!stored) return false

    if (isDualSymbol(stored)) {
      // Check if either version matches
      return stored.module.kind === kind || stored.function.kind === kind
    }

    return stored.kind === kind
  }

  /**
   * Check if a name came from a specific source
   * For dual-defined symbols, `kind` selects which version to check.
   * If `kind` is omitted, defaults to checking the module version.
   */
  isFromSource(name: string, source: SymbolSource, kind?: 'module' | 'function'): boolean {
    const stored = this.symbols.get(name)
    if (!stored) return false

    if (isDualSymbol(stored)) {
      if (kind === 'function') return stored.function.source === source
      return stored.module.source === source
    }

    return stored.source === source
  }

  /**
   * Get all symbols of a specific kind.
   * Uses a lazy cache: built once on first call after any define(), O(1) on subsequent calls.
   */
  getByKind(kind: SymbolKind): string[] {
    if (!this.kindCache) {
      this.kindCache = new Map<SymbolKind, string[]>([
        ['module', []],
        ['function', []],
        ['variable', []],
      ])
      for (const [name, stored] of this.symbols) {
        if (isDualSymbol(stored)) {
          this.kindCache.get('module')!.push(name)
          this.kindCache.get('function')!.push(name)
        } else {
          this.kindCache.get(stored.kind)!.push(name)
        }
      }
    }
    return this.kindCache.get(kind) ?? []
  }

  /**
   * Get all symbols from a specific source
   */
  getBySource(source: SymbolSource): string[] {
    const result: string[] = []
    for (const [name, stored] of this.symbols) {
      if (isDualSymbol(stored)) {
        // For dual-defined, check module version's source
        if (stored.module.source === source) {
          result.push(name)
        }
      } else if (stored.source === source) {
        result.push(name)
      }
    }
    return result
  }

  /**
   * Get all dual-defined names.
   * Uses a lazy cache: built once on first call after any define(), O(1) on subsequent calls.
   */
  getDualDefined(): string[] {
    if (!this.dualCache) {
      this.dualCache = []
      for (const [name, stored] of this.symbols) {
        if (isDualSymbol(stored)) {
          this.dualCache.push(name)
        }
      }
    }
    return this.dualCache
  }

  /**
   * Get parameter list for a symbol.
   *
   * Checks in order:
   * 1. Defined symbols (from define() calls)
   * 2. Param-only storage (from registerParams() calls)
   */
  getParams(name: string, preferKind?: 'module' | 'function'): string[] | undefined {
    // First check defined symbols
    const info = this.lookup(name, preferKind)
    if (info?.params) return info.params

    // Fall back to param-only storage
    if (preferKind === 'function') {
      return this.functionParams.get(name)
    } else if (preferKind === 'module') {
      return this.moduleParams.get(name)
    }

    // No preference - try module first, then function (matches old Map query order)
    return this.moduleParams.get(name) || this.functionParams.get(name)
  }

  /**
   * Register params for a symbol without fully defining it.
   *
   * Use this when params are needed for argument reordering but the symbol
   * shouldn't be treated as that kind for suffix determination purposes.
   * Example: USE imports add module params but use require() semantics.
   */
  registerParams(name: string, kind: 'module' | 'function', params: string[]): void {
    if (kind === 'module') {
      this.moduleParams.set(name, params)
    } else {
      this.functionParams.set(name, params)
    }
  }

  /**
   * Get all names that have params registered for a kind.
   * Includes both fully-defined symbols (via define()) and
   * params-only registrations (via registerParams()).
   * Used when building paramLists for TranspiledFile to ensure
   * transitively-imported params are propagated to callers.
   */
  getAllWithParams(kind: 'module' | 'function'): string[] {
    const result = new Set<string>()
    // Add symbols with explicit define() + params
    for (const name of this.getByKind(kind)) {
      const params = this.getParams(name, kind)
      if (params) result.add(name)
    }
    // Add params-only registrations
    const paramStore = kind === 'module' ? this.moduleParams : this.functionParams
    for (const name of paramStore.keys()) {
      result.add(name)
    }
    return [...result]
  }

  /**
   * Set parameter list for a defined symbol
   */
  setParams(name: string, params: string[], kind?: 'module' | 'function'): void {
    const stored = this.symbols.get(name)
    if (!stored) return

    if (isDualSymbol(stored)) {
      // For dual-defined, update the specified kind
      if (kind === 'function') {
        stored.function.params = params
      } else {
        stored.module.params = params
      }
    } else {
      // Single-kind symbol
      stored.params = params
    }
  }

  /**
   * Create a copy of this symbol table (for nested contexts)
   */
  clone(): SymbolTable {
    const copy = new SymbolTable()
    for (const [name, stored] of this.symbols) {
      if (isDualSymbol(stored)) {
        // Deep copy dual symbol
        const dualCopy: DualSymbolInfo = {
          isDual: true,
          module: { ...stored.module, params: stored.module.params ? [...stored.module.params] : undefined },
          function: { ...stored.function, params: stored.function.params ? [...stored.function.params] : undefined },
        }
        copy.symbols.set(name, dualCopy)
      } else {
        // Deep copy single symbol
        copy.symbols.set(name, { ...stored, params: stored.params ? [...stored.params] : undefined })
      }
    }
    // Copy param-only storage
    for (const [name, params] of this.moduleParams) {
      copy.moduleParams.set(name, [...params])
    }
    for (const [name, params] of this.functionParams) {
      copy.functionParams.set(name, [...params])
    }
    return copy
  }

  /**
   * Merge symbols from another table (for imports/includes)
   */
  merge(other: SymbolTable): void {
    for (const [name, stored] of other.symbols) {
      if (isDualSymbol(stored)) {
        // Define both module and function versions
        this.define(name, { ...stored.module, params: stored.module.params ? [...stored.module.params] : undefined })
        this.define(name, { ...stored.function, params: stored.function.params ? [...stored.function.params] : undefined })
      } else {
        // Define single symbol
        this.define(name, { ...stored, params: stored.params ? [...stored.params] : undefined })
      }
    }
    // Merge param-only storage
    for (const [name, params] of other.moduleParams) {
      if (!this.moduleParams.has(name)) {
        this.moduleParams.set(name, [...params])
      }
    }
    for (const [name, params] of other.functionParams) {
      if (!this.functionParams.has(name)) {
        this.functionParams.set(name, [...params])
      }
    }
  }
}
