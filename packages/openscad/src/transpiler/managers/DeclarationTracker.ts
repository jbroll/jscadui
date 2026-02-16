/**
 * Tracks declarations at AST level for robust bundling.
 * Instead of extracting names from generated code strings via regex,
 * we track the original AST nodes and their metadata.
 */
import type { FunctionDeclarationStmt, ModuleDeclarationStmt, Statement } from 'openscad-parser'

export type DeclarationKind = 'function' | 'module' | 'constant'

/**
 * Source information for debugging
 */
export interface DeclarationSource {
  /** Source file path */
  file: string
  /** Whether this is from the local file or an include */
  kind: 'local' | 'included'
}

/**
 * Represents a declaration that can be bundled.
 * Stores both the original AST node and the generated JavaScript code.
 */
export interface Declaration {
  /** The exported name (with suffix like _$f or _$m) */
  name: string

  /** What kind of declaration */
  kind: DeclarationKind

  /** The original AST node (for potential future use) */
  ast: Statement

  /** The generated JavaScript code */
  code: string

  /** Parameter names (for functions/modules) */
  params?: string[]

  /** Where this came from (for debugging) */
  source: DeclarationSource
}

/**
 * Tracks declarations during transpilation for AST-based bundling.
 *
 * This replaces the fragile regex-based name extraction approach.
 * Instead of generating JavaScript code and parsing it back with regex,
 * we keep the AST nodes and deduplicate at the AST level.
 */
export class DeclarationTracker {
  private declarations = new Map<string, Declaration>()

  /**
   * Add a function declaration
   * @param name - The suffixed name (e.g., 'foo_$f')
   * @param code - The generated JavaScript code
   * @param ast - The original FunctionDeclarationStmt AST node
   * @param params - Parameter names
   * @param source - Source file information
   */
  addFunction(
    name: string,
    code: string,
    ast: FunctionDeclarationStmt,
    params: string[],
    source: DeclarationSource
  ): void {
    // Avoid duplicates (first definition wins, same as current behavior)
    if (this.declarations.has(name)) return

    this.declarations.set(name, {
      name,
      kind: 'function',
      code,
      ast,
      params,
      source,
    })
  }

  /**
   * Add a module declaration
   * @param name - The suffixed name (e.g., 'foo_$m')
   * @param code - The generated JavaScript code
   * @param ast - The original ModuleDeclarationStmt AST node
   * @param params - Parameter names
   * @param source - Source file information
   */
  addModule(
    name: string,
    code: string,
    ast: ModuleDeclarationStmt,
    params: string[],
    source: DeclarationSource
  ): void {
    if (this.declarations.has(name)) return

    this.declarations.set(name, {
      name,
      kind: 'module',
      code,
      ast,
      params,
      source,
    })
  }

  /**
   * Add a constant declaration (top-level assignment)
   * @param name - The variable name
   * @param code - The generated JavaScript code
   * @param ast - The original Assignment statement
   * @param source - Source file information
   */
  addConstant(
    name: string,
    code: string,
    ast: Statement,
    source: DeclarationSource
  ): void {
    if (this.declarations.has(name)) return

    this.declarations.set(name, {
      name,
      kind: 'constant',
      code,
      ast,
      source,
    })
  }

  /**
   * Check if a declaration exists
   */
  has(name: string): boolean {
    return this.declarations.has(name)
  }

  /**
   * Get a declaration by name
   */
  get(name: string): Declaration | undefined {
    return this.declarations.get(name)
  }

  /**
   * Get all declarations of a specific kind
   */
  getByKind(kind: DeclarationKind): Declaration[] {
    const result: Declaration[] = []
    for (const decl of this.declarations.values()) {
      if (decl.kind === kind) {
        result.push(decl)
      }
    }
    return result
  }

  /**
   * Get all declarations
   */
  getAll(): Declaration[] {
    return Array.from(this.declarations.values())
  }

  /**
   * Merge declarations from another tracker.
   * First definition wins (same as current string-based deduplication).
   *
   * @param other - The tracker to merge from
   */
  mergeFrom(other: DeclarationTracker): void {
    for (const [name, decl] of other.declarations) {
      // First definition wins
      if (!this.declarations.has(name)) {
        this.declarations.set(name, decl)
      }
    }
  }

  /**
   * Get count of declarations (for debugging)
   */
  get size(): number {
    return this.declarations.size
  }

  /**
   * Clear all declarations (for testing)
   */
  clear(): void {
    this.declarations.clear()
  }
}
