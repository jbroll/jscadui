/**
 * Transpiler context types and interfaces
 */
import type { ScadFile } from 'openscad-parser'
import { SymbolTable } from './symbolTable.js'
import { CodeGenState } from './managers/CodeGenState.js'
import { ScopeManager } from './managers/ScopeManager.js'
import { DeclarationTracker, type Declaration } from './managers/DeclarationTracker.js'

/**
 * File resolver for use statements
 * Returns the resolved path and file content, or undefined if not found
 * Path must be absolute starting with "/" (e.g., "/examples/openscad/bosl2/lib/std.scad")
 */
export type FileResolver = (filename: string, fromFile?: string) => {path: string, content: string} | undefined

/**
 * Warning codes for transpiler warnings
 */
export enum WarningCode {
  UNSUPPORTED_STATEMENT = 'UNSUPPORTED_STATEMENT',
  UNSUPPORTED_EXPRESSION = 'UNSUPPORTED_EXPRESSION',
  UNKNOWN_BUILTIN = 'UNKNOWN_BUILTIN',
  DEPRECATED_SYNTAX = 'DEPRECATED_SYNTAX',
  DANGEROUS_PARAMETER_NAME = 'DANGEROUS_PARAMETER_NAME',
}

/**
 * Error codes for transpiler errors
 */
export enum ErrorCode {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PARSE_ERROR = 'PARSE_ERROR',
  CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY',
}

/**
 * A warning generated during transpilation
 */
export interface TranspileWarning {
  code: WarningCode
  message: string
  file?: string
  // TODO: Add location info when source mapping is implemented
}

/**
 * An error generated during transpilation
 */
export interface TranspileError {
  code: ErrorCode
  message: string
  file?: string
}

export interface TranspileOptions {
  // Include require() header for JSCAD primitives
  includeHeader?: boolean
  // Format output with indentation
  format?: boolean
  // Indent string
  indent?: string
  // File resolver for use statements (required for multi-file support)
  fileResolver?: FileResolver
  // Current file path (for relative imports)
  currentFile?: string
  // Global $fn override (0 = use OpenSCAD's formula)
  fn?: number
  // Set $preview to true (simulates F5 preview mode; some files gate content on this)
  preview?: boolean
  // Include source line comments for debugging (e.g., // line 42 in foo.scad)
  includeSourceComments?: boolean
  // Initial parameter lists (inherited from parent context for include chains)
  initialParamLists?: Map<string, string[]>
  // Initial function parameter lists (inherited from parent context for include chains)
  initialFunctionParamLists?: Map<string, string[]>
  // Initial dual-defined names (inherited from parent context)
  initialDualDefinedNames?: Set<string>
  // Initial imported functions (inherited from parent context for parameter shadowing detection)
  initialImportedFunctions?: Set<string>
}

export interface TranspileResult {
  code: string
  exports: string[]  // Names of exported modules/functions
  imports: UseImport[]  // Files imported via use
  // All transpiled files (main + dependencies)
  files: Map<string, TranspiledFile>
  // Warnings generated during transpilation
  warnings: TranspileWarning[]
  // Errors generated during transpilation (non-fatal)
  errors: TranspileError[]
}

/**
 * Bundled parts from a file - used when inlining includes
 * Functions use `function` declarations for hoisting
 * Names arrays are parallel to code arrays (same index = same item)
 */
export interface BundledParts {
  functions: string[]      // Function declarations (hoisted)
  functionNames: string[]  // Names extracted at generation time (parallel to functions array)
  modules: string[]        // Module declarations
  moduleNames: string[]    // Names extracted at generation time (parallel to modules array)
  constants: string[]      // Constant assignments
  constantNames: string[]  // Names extracted at generation time (parallel to constants array)
  useImports: UseImport[]  // Use imports to propagate when this file is included
  usedPrimitives: Set<string>
  usedTransforms: Set<string>
  usedBooleans: Set<string>
  usedExtrusions: Set<string>
  usedHelpers: Set<string>
  usedColors: boolean
  usedHulls: boolean
  usedMaths: boolean
  usedMinMax: boolean
}

export interface TranspiledFile {
  code: string
  exports: string[]
  functionExports: string[]  // Functions (not modules) - can be called directly
  moduleExports: string[]    // Modules - must be called with curried pattern
  paramLists: Map<string, string[]>  // Module name -> parameter names
  functionParamLists?: Map<string, string[]>  // Function name -> parameter names (may differ from module)
  dualDefinedNames?: Set<string>  // Names that have both module and function versions
  bundledParts?: BundledParts  // Parts for inlining when included
  // AST-level declarations (for robust bundling)
  declarations?: Declaration[]
  // Include optimization flags (Phase 1)
  canOptimizeInclude?: boolean  // True if safe to use require() instead of bundling
  hasTopLevelGeometry?: boolean  // True if file has top-level geometry statements
  hasVariables?: boolean  // True if file has top-level variables
  // Sentinel for in-progress transpilation (for mutual-dependency cycle detection)
  isPlaceholder?: boolean
}

export interface UseImport {
  filename: string
  resolvedPath: string  // Full path from root (for require statements)
  symbols: string[]  // Symbols imported from this file
  isCyclic?: boolean  // True when this import participates in a mutual dependency cycle
}

export interface TranspileContext {
  options: TranspileOptions & { includeHeader: boolean; format: boolean; indent: string }
  // Managers for focused concerns
  codeGen: CodeGenState
  scopes: ScopeManager
  declarations: DeclarationTracker
  // Track use statements with their discovered symbols
  useImports: UseImport[]
  // Track include statements (import all symbols including variables)
  includeImports: UseImport[]
  // Track top-level variable assignments for export
  variableNames: string[]
  // Unified symbol table - single source of truth for symbols and params
  symbols: SymbolTable
  // Current indentation level
  indentLevel: number
  // Cache of transpiled files (shared across recursive calls)
  transpiledFiles: Map<string, TranspiledFile>
  // Cache of parsed ASTs (to avoid re-parsing in multi-pass transpilation)
  parsedFiles: Map<string, ScadFile>
  // Track files currently being processed (for cycle detection)
  processingFiles: Set<string>
  // Warnings generated during transpilation
  warnings: TranspileWarning[]
  // Errors generated during transpilation (non-fatal)
  errors: TranspileError[]
  // Free variable reference tracking for canOptimizeInclude detection
  // Set of identifier names that fall through transpileLookupExpr without being locally bound
  potentialFreeVarRefs: Set<string>
  // Current set of locally-bound names (module/function params + local vars)
  // Used to avoid false positives when tracking potentialFreeVarRefs
  currentLocalBindings: Set<string>
  // Whether we're inside a flatMap context (list comprehension with 'each').
  // When true, LcIfExpr branches that are NOT 'each' must be wrapped in [...] to
  // prevent flatMap from flattening array-typed values (e.g., polygon points [x,y]).
  inFlatMapContext: boolean
}

export const defaultOptions = {
  includeHeader: true,
  format: true,
  indent: '  ',
}

/**
 * Create a fresh transpile context
 */
export function createContext(
  options: TranspileOptions,
  sharedCache?: Map<string, TranspiledFile>,
  sharedParsedFiles?: Map<string, ScadFile>
): TranspileContext {
  const opts = { ...defaultOptions, ...options }

  // Initialize SymbolTable with initial params
  const symbols = new SymbolTable()
  if (options.initialParamLists) {
    for (const [name, params] of options.initialParamLists) {
      symbols.registerParams(name, 'module', params)
      // Use 'inherited' source so we can distinguish from explicitly use'd symbols.
      // This is important for canOptimizeInclude free-var detection in createBundledParts.
      symbols.define(name, { kind: 'module', source: 'inherited', params })
    }
  }
  if (options.initialFunctionParamLists) {
    for (const [name, params] of options.initialFunctionParamLists) {
      symbols.registerParams(name, 'function', params)
      // Use 'inherited' source so we can distinguish from explicitly use'd symbols.
      symbols.define(name, { kind: 'function', source: 'inherited', params })
    }
  }

  return {
    options: opts,
    // Initialize managers
    codeGen: new CodeGenState(),
    scopes: new ScopeManager(),
    declarations: new DeclarationTracker(),
    // Context state
    useImports: [],
    includeImports: [],
    variableNames: [],
    symbols,
    indentLevel: 0,
    transpiledFiles: sharedCache || new Map(),
    parsedFiles: sharedParsedFiles || new Map(),
    processingFiles: new Set(),
    warnings: [],
    errors: [],
    potentialFreeVarRefs: new Set(),
    currentLocalBindings: new Set(),
    inFlatMapContext: false,
  }
}

/**
 * Push a new scope level with variable bindings
 * @param ctx - The transpile context
 * @param bindings - Map of original name -> renamed name
 */
export function pushScope(ctx: TranspileContext, bindings: Map<string, string>): void {
  ctx.scopes.pushScope(bindings)
}

/**
 * Pop the innermost scope level
 * @param ctx - The transpile context
 */
export function popScope(ctx: TranspileContext): void {
  ctx.scopes.popScope()
}

/**
 * Look up a variable binding in the current scope stack
 * Returns the renamed version if found, undefined otherwise
 * Searches from innermost to outermost scope
 * @param ctx - The transpile context
 * @param name - The original variable name
 * @returns The renamed variable name, or undefined if not in scope
 */
export function lookupBinding(ctx: TranspileContext, name: string): string | undefined {
  return ctx.scopes.lookupBinding(name)
}
