/**
 * Transpiler context types and interfaces
 */

/**
 * File resolver for use statements
 * Returns the file content, or undefined if not found
 */
export type FileResolver = (filename: string, fromFile?: string) => string | undefined

/**
 * Warning codes for transpiler warnings
 */
export enum WarningCode {
  UNSUPPORTED_STATEMENT = 'UNSUPPORTED_STATEMENT',
  UNSUPPORTED_EXPRESSION = 'UNSUPPORTED_EXPRESSION',
  UNKNOWN_BUILTIN = 'UNKNOWN_BUILTIN',
  DEPRECATED_SYNTAX = 'DEPRECATED_SYNTAX',
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
 */
export interface BundledParts {
  functions: string[]      // Function declarations (hoisted)
  modules: string[]        // Module declarations
  constants: string[]      // Constant assignments
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
  paramLists: Map<string, string[]>  // Module/function name -> parameter names
  bundledParts?: BundledParts  // Parts for inlining when included
}

export interface UseImport {
  filename: string
  resolvedPath: string  // Full path from root (for require statements)
  symbols: string[]  // Symbols imported from this file
}

export interface TranspileContext {
  options: TranspileOptions & { includeHeader: boolean; format: boolean; indent: string }
  // Track what JSCAD primitives/functions are used
  usedPrimitives: Set<string>
  usedTransforms: Set<string>
  usedBooleans: Set<string>
  usedExtrusions: Set<string>
  usedHelpers: Set<string>  // Math helper functions (norm, cross, lookup, rands)
  usedColors: boolean
  usedHulls: boolean
  usedMaths: boolean
  usedMinMax: boolean
  // Track use statements with their discovered symbols
  useImports: UseImport[]
  // Track include statements (import all symbols including variables)
  includeImports: UseImport[]
  // Track module/function definitions for export (local definitions)
  moduleNames: string[]
  functionNames: string[]
  // Track module/function parameter lists (for named argument reordering)
  moduleParamLists: Map<string, string[]>
  // Track top-level variable assignments for export
  variableNames: string[]
  // Track all available symbols (local + imported)
  availableSymbols: Set<string>
  // Track imported function names (not modules) - these don't use curried pattern
  importedFunctions: Set<string>
  // Track imported module names (from includes) - these use curried pattern
  importedModules: Set<string>
  // Track names that have both module and function versions (use __fn suffix for function)
  dualDefinedNames: Set<string>
  // Current indentation level
  indentLevel: number
  // Cache of transpiled files (shared across recursive calls)
  transpiledFiles: Map<string, TranspiledFile>
  // Track files currently being processed (for cycle detection)
  processingFiles: Set<string>
  // Inherited special variables from parent scopes (for $fn, $fa, $fs propagation)
  inheritedSpecialVars: { $fn?: string; $fa?: string; $fs?: string }
  // Counter for unique let binding suffixes (to avoid shadowing issues)
  letCounter: number
  // Warnings generated during transpilation
  warnings: TranspileWarning[]
  // Errors generated during transpilation (non-fatal)
  errors: TranspileError[]
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
  sharedCache?: Map<string, TranspiledFile>
): TranspileContext {
  const opts = { ...defaultOptions, ...options }
  return {
    options: opts,
    usedPrimitives: new Set(),
    usedTransforms: new Set(),
    usedBooleans: new Set(),
    usedExtrusions: new Set(),
    usedHelpers: new Set(),
    usedColors: false,
    usedHulls: false,
    usedMaths: false,
    usedMinMax: false,
    useImports: [],
    includeImports: [],
    moduleNames: [],
    functionNames: [],
    moduleParamLists: new Map(),
    variableNames: [],
    availableSymbols: new Set(),
    importedFunctions: new Set(),
    importedModules: new Set(),
    dualDefinedNames: new Set(),
    indentLevel: 0,
    transpiledFiles: sharedCache || new Map(),
    processingFiles: new Set(),
    inheritedSpecialVars: {},
    letCounter: 1,
    warnings: [],
    errors: [],
  }
}
