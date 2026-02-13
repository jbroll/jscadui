/**
 * Transpiler context types and interfaces
 */
import type { ScadFile } from 'openscad-parser'

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
  // Initial parameter lists (inherited from parent context for include chains)
  initialParamLists?: Map<string, string[]>
  // Initial function parameter lists (inherited from parent context for include chains)
  initialFunctionParamLists?: Map<string, string[]>
  // Initial dual-defined names (inherited from parent context)
  initialDualDefinedNames?: Set<string>
  // Initial imported functions (inherited from parent context for parameter shadowing detection)
  initialImportedFunctions?: Set<string>
  // Initial included module names (inherited from parent context for builtin override detection)
  initialIncludedModuleNames?: Set<string>
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
  // Track function parameter lists separately (functions may have different params than modules)
  functionParamLists: Map<string, string[]>
  // Track top-level variable assignments for export
  variableNames: string[]
  // Track all available symbols (local + imported)
  availableSymbols: Set<string>
  // Track imported function names (not modules) - these don't use curried pattern
  importedFunctions: Set<string>
  // Track imported module names (from includes) - these use curried pattern
  importedModules: Set<string>
  // Track module names from all includes (for builtin override detection)
  // This is populated during the pre-pass and shared across all nested transpilations
  includedModuleNames: Set<string>
  // Track names that have both module and function versions (use __fn suffix for function)
  dualDefinedNames: Set<string>
  // Track parameters that shadow function names (for current function scope)
  // Maps original name -> renamed version (e.g., "reverse" -> "_param_reverse")
  shadowedParameters: Map<string, string>
  // Current indentation level
  indentLevel: number
  // Cache of transpiled files (shared across recursive calls)
  transpiledFiles: Map<string, TranspiledFile>
  // Cache of parsed ASTs (to avoid re-parsing in multi-pass transpilation)
  parsedFiles: Map<string, ScadFile>
  // Track files currently being processed (for cycle detection)
  processingFiles: Set<string>
  // Inherited special variables from parent scopes (for $fn, $fa, $fs propagation)
  inheritedSpecialVars: { $fn?: string; $fa?: string; $fs?: string }
  // Counter for unique let binding suffixes (to avoid shadowing issues)
  letCounter: number
  // Local let bindings that are functions (maps original name -> renamed suffixed name)
  // When calling these, use the renamed name directly without _$f suffix
  localFunctionBindings: Map<string, string>
  // Scope stack for variable bindings (maps original name -> renamed name)
  // Each entry is a scope level; innermost scope is last
  // This is used for proper lexical scoping of let/for bindings
  scopeBindings: Map<string, string>[]
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

  // Initialize paramLists from initial values if provided (for include chains)
  const moduleParamLists = new Map<string, string[]>()
  if (options.initialParamLists) {
    for (const [name, params] of options.initialParamLists) {
      moduleParamLists.set(name, params)
    }
  }

  // Initialize functionParamLists from initial values if provided (for include chains)
  const functionParamLists = new Map<string, string[]>()
  if (options.initialFunctionParamLists) {
    for (const [name, params] of options.initialFunctionParamLists) {
      functionParamLists.set(name, params)
    }
  }

  // Initialize dualDefinedNames from initial values if provided
  const dualDefinedNames = new Set<string>()
  if (options.initialDualDefinedNames) {
    for (const name of options.initialDualDefinedNames) {
      dualDefinedNames.add(name)
    }
  }

  // Initialize importedFunctions from initial values if provided (for parameter shadowing detection)
  const importedFunctions = new Set<string>()
  if (options.initialImportedFunctions) {
    for (const name of options.initialImportedFunctions) {
      importedFunctions.add(name)
    }
  }

  // Initialize includedModuleNames from initial values if provided (for builtin override detection)
  const includedModuleNames = new Set<string>()
  if (options.initialIncludedModuleNames) {
    for (const name of options.initialIncludedModuleNames) {
      includedModuleNames.add(name)
    }
  }

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
    moduleParamLists,
    functionParamLists,
    variableNames: [],
    availableSymbols: new Set(),
    importedFunctions,
    importedModules: new Set(),
    includedModuleNames,
    dualDefinedNames,
    shadowedParameters: new Map(),
    indentLevel: 0,
    transpiledFiles: sharedCache || new Map(),
    parsedFiles: new Map(),
    processingFiles: new Set(),
    inheritedSpecialVars: {},
    letCounter: 1,
    localFunctionBindings: new Map(),
    scopeBindings: [],
    warnings: [],
    errors: [],
  }
}

/**
 * Push a new scope level with variable bindings
 * @param ctx - The transpile context
 * @param bindings - Map of original name -> renamed name
 */
export function pushScope(ctx: TranspileContext, bindings: Map<string, string>): void {
  ctx.scopeBindings.push(bindings)
}

/**
 * Pop the innermost scope level
 * @param ctx - The transpile context
 */
export function popScope(ctx: TranspileContext): void {
  ctx.scopeBindings.pop()
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
  // Search from innermost (last) to outermost (first) scope
  for (let i = ctx.scopeBindings.length - 1; i >= 0; i--) {
    const binding = ctx.scopeBindings[i].get(name)
    if (binding !== undefined) {
      return binding
    }
  }
  return undefined
}
