/**
 * Unified symbol table for tracking module, function, and variable definitions.
 *
 * This consolidates the multiple overlapping Sets in TranspileContext:
 * - moduleNames, functionNames, variableNames (local definitions)
 * - availableModules, availableFunctions, availableSymbols (all sources)
 * - importedFunctions, importedModules (from use statements)
 * - includedModuleNames, includedFunctionNames (from include statements)
 * - dualDefinedNames (both module and function with same name)
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
 */
export type SymbolSource = 'local' | 'imported' | 'included'

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
 * Unified symbol table for tracking definitions during transpilation.
 *
 * Handles the case where a name can have both a module AND function version
 * (common in BOSL2 where many modules also have function forms).
 */
export class SymbolTable {
  /** Primary symbol storage - for names that are ONLY one kind */
  private symbols = new Map<string, SymbolInfo>()

  /** Names that have both module and function versions */
  private dualDefined = new Set<string>()

  /** Secondary storage for the function version when a name is dual-defined */
  private functionVersions = new Map<string, SymbolInfo>()

  /**
   * Define a symbol in the table
   *
   * If a name already exists with a different kind, marks it as dual-defined
   * and stores both versions.
   */
  define(name: string, info: SymbolInfo): void {
    const existing = this.symbols.get(name)

    if (existing) {
      // Check if this creates a dual-defined name (module + function)
      if (existing.kind !== info.kind) {
        if (
          (existing.kind === 'module' && info.kind === 'function') ||
          (existing.kind === 'function' && info.kind === 'module')
        ) {
          this.dualDefined.add(name)
          // Store function version separately
          if (info.kind === 'function') {
            this.functionVersions.set(name, info)
          } else {
            // Existing is function, new is module - swap storage
            this.functionVersions.set(name, existing)
            this.symbols.set(name, info)
          }
          return
        }
        // Different incompatible kinds - replace (variables can be shadowed)
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
    if (this.dualDefined.has(name) && preferKind === 'function') {
      return this.functionVersions.get(name)
    }
    return this.symbols.get(name)
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
    return this.dualDefined.has(name)
  }

  /**
   * Check if a name is defined as a specific kind
   */
  isKind(name: string, kind: SymbolKind): boolean {
    const info = this.symbols.get(name)
    if (info?.kind === kind) return true
    // Also check function versions for dual-defined names
    if (kind === 'function' && this.functionVersions.has(name)) return true
    return false
  }

  /**
   * Check if a name came from a specific source
   */
  isFromSource(name: string, source: SymbolSource): boolean {
    const info = this.symbols.get(name)
    return info?.source === source
  }

  /**
   * Get all symbols of a specific kind
   */
  getByKind(kind: SymbolKind): string[] {
    const result: string[] = []
    for (const [name, info] of this.symbols) {
      if (info.kind === kind) {
        result.push(name)
      }
    }
    // Add function versions for dual-defined names
    if (kind === 'function') {
      for (const name of this.functionVersions.keys()) {
        if (!result.includes(name)) {
          result.push(name)
        }
      }
    }
    return result
  }

  /**
   * Get all symbols from a specific source
   */
  getBySource(source: SymbolSource): string[] {
    const result: string[] = []
    for (const [name, info] of this.symbols) {
      if (info.source === source) {
        result.push(name)
      }
    }
    return result
  }

  /**
   * Get all dual-defined names
   */
  getDualDefined(): string[] {
    return Array.from(this.dualDefined)
  }

  /**
   * Get parameter list for a symbol
   */
  getParams(name: string, preferKind?: 'module' | 'function'): string[] | undefined {
    const info = this.lookup(name, preferKind)
    return info?.params
  }

  /**
   * Set parameter list for a symbol
   */
  setParams(name: string, params: string[], kind?: 'module' | 'function'): void {
    if (this.dualDefined.has(name) && kind === 'function') {
      const info = this.functionVersions.get(name)
      if (info) {
        info.params = params
      }
    } else {
      const info = this.symbols.get(name)
      if (info) {
        info.params = params
      }
    }
  }

  /**
   * Create a copy of this symbol table (for nested contexts)
   */
  clone(): SymbolTable {
    const copy = new SymbolTable()
    for (const [name, info] of this.symbols) {
      copy.symbols.set(name, { ...info, params: info.params ? [...info.params] : undefined })
    }
    for (const name of this.dualDefined) {
      copy.dualDefined.add(name)
    }
    for (const [name, info] of this.functionVersions) {
      copy.functionVersions.set(name, { ...info, params: info.params ? [...info.params] : undefined })
    }
    return copy
  }

  /**
   * Merge symbols from another table (for imports/includes)
   */
  merge(other: SymbolTable): void {
    for (const [name, info] of other.symbols) {
      this.define(name, { ...info, params: info.params ? [...info.params] : undefined })
    }
    // Handle dual-defined from other table
    for (const name of other.dualDefined) {
      const funcInfo = other.functionVersions.get(name)
      if (funcInfo && !this.functionVersions.has(name)) {
        this.dualDefined.add(name)
        this.functionVersions.set(name, { ...funcInfo, params: funcInfo.params ? [...funcInfo.params] : undefined })
      }
    }
  }
}
