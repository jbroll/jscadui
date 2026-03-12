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

import type { ScadFile } from 'openscad-parser'
import { parse } from '../../parser/parse.js'
import { transpile } from '../transpile.js'
import type { TranspileContext } from '../context.js'
import { ErrorCode } from '../context.js'

export interface DependencyResult {
  resolvedPath: string
  symbols: string[]
}

/**
 * Process and transpile a dependency file
 *
 * @param filename - The file to resolve and transpile
 * @param ctx - The current transpilation context
 * @returns The resolved path and exported symbol names
 */
export function processDependency(filename: string, ctx: TranspileContext): DependencyResult {
  const fileResolver = ctx.options.fileResolver
  if (!fileResolver) {
    // No file resolver - can't process dependencies
    return { resolvedPath: '', symbols: [] }
  }

  // Resolve the file to get its absolute path and content
  const resolved = fileResolver(filename, ctx.options.currentFile)
  if (!resolved) {
    ctx.errors.push({
      code: ErrorCode.FILE_NOT_FOUND,
      message: `Cannot resolve file: ${filename}`,
      file: ctx.options.currentFile,
    })
    return { resolvedPath: '', symbols: [] }
  }

  const resolvedFilename = resolved.path

  // Check cache first (using resolved path)
  const cached = ctx.transpiledFiles.get(resolvedFilename)
  if (cached) {
    return { resolvedPath: resolvedFilename, symbols: cached.exports }
  }

  // Detect cycles (using resolved path)
  if (ctx.processingFiles.has(resolvedFilename)) {
    // Circular dependency - record error but don't fail
    ctx.errors.push({
      code: ErrorCode.CIRCULAR_DEPENDENCY,
      message: `Circular dependency detected: ${resolvedFilename}`,
      file: ctx.options.currentFile,
    })
    return { resolvedPath: resolvedFilename, symbols: [] }
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
      return { resolvedPath: resolvedFilename, symbols: [] }
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
    return { resolvedPath: resolvedFilename, symbols: [] }
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

  const result = transpile(ast, {
    ...ctx.options,
    currentFile: resolvedFilename,
    initialParamLists: moduleParamLists,
    initialFunctionParamLists: functionParamLists,
    initialDualDefinedNames: new Set(ctx.symbols.getDualDefined()),
    initialImportedFunctions: importedFunctions,
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
    symbols: result.exports.filter(e => e !== 'main')
  }
}
