/**
 * DependencyProcessor - Handles resolution and transpilation of dependencies
 *
 * Responsibilities:
 * - Resolve file paths via fileResolver
 * - Check transpilation cache
 * - Detect circular dependencies
 * - Build context options for nested transpilation
 * - Handle errors and edge cases
 */

import type { ScadFile, FunctionDeclarationStmt, ModuleDeclarationStmt, Statement } from 'openscad-parser'
import { isFunctionDeclaration, isModuleDeclaration } from '../ast-types.js'
import { parse } from '../../parser/parse.js'
import { transpile } from '../transpile.js'
import type { TranspileContext } from '../context.js'
import { ErrorCode } from '../context.js'
import { safeIdentifier } from '../../utils/identifiers.js'

/**
 * Extract exported symbol names from an AST without full transpilation.
 * Used to resolve circular-dependency cycles: when file A is being transpiled
 * and encounters `use <B>` where B is also being transpiled (placeholder exists),
 * we still need to know what B will export so that A's require() is properly
 * destructured (e.g., `var { foo_$f } = require('B')` instead of `var B = require('B')`).
 */
function extractSymbolsFromAst(ast: ScadFile): string[] {
  const symbols: string[] = []
  for (const stmt of ast.statements) {
    if (isFunctionDeclaration(stmt as Statement)) {
      const s = stmt as FunctionDeclarationStmt
      const safeName = safeIdentifier(s.name)
      symbols.push(`${safeName}_$f`)
      if (s.definitionArgs && s.definitionArgs.length > 0) {
        symbols.push(`${safeName}_$f$obj`)
      }
    } else if (isModuleDeclaration(stmt as Statement)) {
      const s = stmt as ModuleDeclarationStmt
      symbols.push(`${safeIdentifier(s.name)}_$m`)
    }
    // Note: `use` only imports functions/modules, not variables — skip AssignmentNodes
  }
  return symbols
}

export interface DependencyResult {
  resolvedPath: string
  symbols: string[]
  isCyclic: boolean
}

/**
 * Process and transpile a dependency file
 *
 * @param filename - The file to resolve and transpile
 * @param ctx - The current transpilation context
 * @returns The resolved path and exported symbol names
 */
export function processDependency(filename: string, ctx: TranspileContext, currentFileOverride?: string): DependencyResult {
  const fileResolver = ctx.options.fileResolver
  if (!fileResolver) {
    // No file resolver - can't process dependencies
    return { resolvedPath: '', symbols: [], isCyclic: false }
  }

  // Resolve the file to get its absolute path and content
  const resolved = fileResolver(filename, currentFileOverride ?? ctx.options.currentFile)
  if (!resolved) {
    ctx.errors.push({
      code: ErrorCode.FILE_NOT_FOUND,
      message: `Cannot resolve file: ${filename}`,
      file: ctx.options.currentFile,
    })
    return { resolvedPath: '', symbols: [], isCyclic: false }
  }

  const resolvedFilename = resolved.path

  // Check cache first (using resolved path)
  // Also handles placeholder sentinel for mutual-dependency cycle detection:
  // if a file is currently being transpiled (placeholder exists), return empty to break the cycle
  const cached = ctx.transpiledFiles.get(resolvedFilename)
  if (cached) {
    if (cached.isPlaceholder) {
      // Mutual dependency cycle detected. Extract symbols from the AST so we can
      // generate a properly destructured require() (e.g., `var { foo_$f } = require('B')`)
      // instead of a namespace import (`var B = require('B')`) that doesn't expose symbols.
      const cycleAst = ctx.parsedFiles.get(resolvedFilename)
        ?? (() => { const { ast } = parse(resolved.content); return ast })()
      const symbols = cycleAst ? extractSymbolsFromAst(cycleAst) : []
      return { resolvedPath: resolvedFilename, symbols, isCyclic: true }
    }
    return { resolvedPath: resolvedFilename, symbols: cached.exports, isCyclic: false }
  }

  // Detect cycles (using resolved path)
  if (ctx.processingFiles.has(resolvedFilename)) {
    // Circular dependency - record error but don't fail
    ctx.errors.push({
      code: ErrorCode.CIRCULAR_DEPENDENCY,
      message: `Circular dependency detected: ${resolvedFilename}`,
      file: ctx.options.currentFile,
    })
    return { resolvedPath: resolvedFilename, symbols: [], isCyclic: false }
  }

  // Check if AST is already cached from signature pre-pass
  let ast: ScadFile | undefined = ctx.parsedFiles.get(resolvedFilename)

  if (!ast) {
    // Parse the file
    const { ast: parsedAst, errors } = parse(resolved.content)
    if (errors.length > 0) {
      ctx.errors.push({
        code: ErrorCode.PARSE_ERROR,
        message: `Parse error in ${filename}: ${errors.map((e: unknown) => (e as Error).message || String(e)).join(', ')}`,
        file: resolvedFilename,
      })
      return { resolvedPath: resolvedFilename, symbols: [], isCyclic: false }
    }
    ast = parsedAst
  }

  // AST should exist at this point
  if (!ast) {
    ctx.errors.push({
      code: ErrorCode.PARSE_ERROR,
      message: `Failed to parse file: ${filename}`,
      file: resolvedFilename,
    })
    return { resolvedPath: resolvedFilename, symbols: [], isCyclic: false }
  }

  // Recursively transpile this file (sharing the cache)
  // Use resolved path as currentFile so nested dependencies resolve correctly
  // Pass current paramLists, dualDefinedNames, and importedFunctions so sibling includes can resolve calls

  // Build param lists and sets from SymbolTable to pass to nested context
  const moduleParamLists = new Map<string, string[]>()
  for (const name of ctx.symbols.getByKind('module')) {
    const params = ctx.symbols.getParams(name, 'module')
    if (params) moduleParamLists.set(name, params)
  }
  const functionParamLists = new Map<string, string[]>()
  for (const name of ctx.symbols.getByKind('function')) {
    const params = ctx.symbols.getParams(name, 'function')
    if (params) functionParamLists.set(name, params)
  }
  // Build importedFunctions set from SymbolTable
  const importedFunctions = new Set<string>()
  for (const name of ctx.symbols.getByKind('function')) {
    if (ctx.symbols.isFromSource(name, 'imported')) {
      importedFunctions.add(name)
    }
  }

  // Insert placeholder into shared cache BEFORE calling transpile().
  // This breaks mutual-dependency cycles: if B requires A while A is transpiling B,
  // the placeholder is found in the cache and returns early (empty exports).
  // The placeholder is replaced with the real result when transpile() completes.
  ctx.transpiledFiles.set(resolvedFilename, {
    code: '',
    exports: [],
    functionExports: [],
    moduleExports: [],
    paramLists: new Map(),
    functionParamLists: new Map(),
    dualDefinedNames: new Set(),
    declarations: [],
    isPlaceholder: true,
  })

  const result = transpile(ast, {
    ...ctx.options,
    currentFile: resolvedFilename,
    initialParamLists: moduleParamLists,
    initialFunctionParamLists: functionParamLists,
    initialDualDefinedNames: new Set(ctx.symbols.getDualDefined()),
    initialImportedFunctions: importedFunctions,
    initialLazyVarNames: ctx.lazyVarNames,
  }, ctx.transpiledFiles, ctx.parsedFiles)

  // Cache the result (using resolved path)
  const cachedFile = ctx.transpiledFiles.get(resolvedFilename)
  if (!cachedFile) {
    // File should have been cached during transpile, but add safety check
    ctx.transpiledFiles.set(resolvedFilename, {
      code: result.code,
      exports: result.exports.filter(e => e !== 'main'),
      functionExports: [],  // This shouldn't happen, file was already cached
      moduleExports: [],
      paramLists: new Map(),
      functionParamLists: new Map(),
      dualDefinedNames: new Set(),
      declarations: [],  // This shouldn't happen, file was already cached
    })
  }

  // Return resolved path and exports (excluding 'main')
  return {
    resolvedPath: resolvedFilename,
    symbols: result.exports.filter(e => e !== 'main'),
    isCyclic: false,
  }
}
