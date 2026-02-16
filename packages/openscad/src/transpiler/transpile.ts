/**
 * OpenSCAD to JavaScript Transpiler
 *
 * Converts OpenSCAD AST directly to JavaScript code with module exports.
 * Uses late binding for module calls - modules are emitted as JavaScript functions
 * that call each other at runtime.
 */

import type {
  ScadFile,
  Statement,
} from 'openscad-parser'
import { parse } from '../parser/parse.js'
import { safeIdentifier, getFileDir } from '../utils/identifiers.js'
import {
  TranspileContext,
  TranspileOptions,
  TranspileResult,
  TranspiledFile,
  BundledParts,
  createContext,
  ErrorCode,
} from './context.js'
import {
  isModuleDeclaration,
  isFunctionDeclaration,
  isUseStmt,
  isIncludeStmt,
  isAssignmentNode,
} from './ast-types.js'
import { transpileExpression } from './expressions.js'
import {
  transpileStatement,
  transpileModuleDeclaration,
  transpileFunctionDeclaration,
} from './statements.js'
import { getModuleName } from './builtins.js'
import { buildJscadImports } from './helpers/index.js'
import { isStackSpecialVar } from './specialVars.js'
import { deduplicateParamNames } from './utils.js'

// Re-export types for public API
export type {
  FileResolver,
  TranspileOptions,
  TranspileResult,
  TranspiledFile,
  UseImport,
  TranspileWarning,
  TranspileError,
} from './context.js'
export { WarningCode, ErrorCode } from './context.js'

/**
 * Result of processing include statements
 */
interface BundledContent {
  functions: string[]
  modules: string[]
  constants: string[]
  functionNames: Set<string>
  moduleNames: Set<string>
  constantNames: Set<string>
}

/**
 * Result of transpiling all statements
 */
interface TranspiledStatements {
  localFunctions: string[]
  localModules: string[]
  localConstants: string[]
  geometryParts: string[]
}

/**
 * Process use statements: transpile dependencies and discover their exports
 */
function processUseStatements(ctx: TranspileContext, currentFileDir: string): void {
  for (const useImport of ctx.useImports) {
    // Compute resolved path relative to root
    useImport.resolvedPath = currentFileDir + useImport.filename
    const symbols = transpileAndCacheDependency(useImport.filename, ctx, false /* use */)
    useImport.symbols = symbols
    for (const sym of symbols) {
      ctx.availableSymbols.add(sym)
    }
    // Track which imported symbols are functions (not modules)
    const cachedFile = ctx.transpiledFiles.get(useImport.resolvedPath)
    if (cachedFile?.functionExports) {
      for (const fn of cachedFile.functionExports) {
        ctx.importedFunctions.add(fn)
        ctx.availableFunctions.add(fn)
        // Also populate SymbolTable
        const params = cachedFile.functionParamLists?.get(fn)
        ctx.symbols.define(fn, { kind: 'function', source: 'imported', params })
      }
    }
    // Merge parameter lists from imported modules for named argument reordering
    // NOTE: Do NOT add to SymbolTable as 'module' here - USE imports are accessed
    // via require() and use the _$f suffix, not the curried _$m pattern
    if (cachedFile?.paramLists) {
      for (const [name, params] of cachedFile.paramLists) {
        ctx.moduleParamLists.set(name, params)
        ctx.symbols.registerParams(name, 'module', params)
      }
    }
    // Merge function parameter lists (functions may have more params than modules)
    // NOTE: SymbolTable is already populated from functionExports above
    // Only merge param lists here, don't re-add to SymbolTable
    if (cachedFile?.functionParamLists) {
      for (const [name, params] of cachedFile.functionParamLists) {
        ctx.functionParamLists.set(name, params)
        ctx.symbols.registerParams(name, 'function', params)
      }
    }
    // Merge dual-defined names from imported modules
    if (cachedFile?.dualDefinedNames) {
      for (const name of cachedFile.dualDefinedNames) {
        ctx.dualDefinedNames.add(name)
        // Register __fn variant using function params (may have more params than module)
        const params = ctx.symbols.getParams(name, 'function') || ctx.symbols.getParams(name, 'module')
        if (params) {
          ctx.moduleParamLists.set(`${name}__fn`, params)
          ctx.symbols.registerParams(`${name}__fn`, 'module', params)
        }
        // Note: SymbolTable.define() already handles dual-defined names automatically
      }
    }
  }
}

/**
 * Process include statements: transpile dependencies and BUNDLE their content
 * This matches OpenSCAD's include semantics - everything is merged into one scope
 */
function processIncludeStatements(ctx: TranspileContext, currentFileDir: string): BundledContent {
  const bundledFunctions: string[] = []
  const bundledModules: string[] = []
  const bundledConstants: string[] = []
  // Track which declarations have already been bundled to avoid duplicates
  const bundledFunctionNames = new Set<string>()
  const bundledModuleNames = new Set<string>()
  const bundledConstantNames = new Set<string>()

  for (const includeImport of ctx.includeImports) {
    // Compute resolved path relative to root
    includeImport.resolvedPath = currentFileDir + includeImport.filename
    const symbols = transpileAndCacheDependency(includeImport.filename, ctx, true /* include */)
    includeImport.symbols = symbols
    for (const sym of symbols) {
      ctx.availableSymbols.add(sym)
    }
    // Get bundled parts for inlining
    const cachedFile = ctx.transpiledFiles.get(includeImport.resolvedPath)
    if (cachedFile?.bundledParts) {
      const parts = cachedFile.bundledParts
      // Deduplicate functions by name (extract name from "function foo_$f(...)")
      for (const fn of parts.functions) {
        const match = fn.match(/^function\s+(\w+)/)
        const name = match?.[1]
        if (!name || !bundledFunctionNames.has(name)) {
          if (name) bundledFunctionNames.add(name)
          bundledFunctions.push(fn)
        }
      }
      // Deduplicate modules by name (extract name from "const foo_$m = ...")
      for (const mod of parts.modules) {
        const match = mod.match(/^const\s+(\w+)/)
        const name = match?.[1]
        if (!name || !bundledModuleNames.has(name)) {
          if (name) bundledModuleNames.add(name)
          bundledModules.push(mod)
        }
      }
      // Deduplicate constants by name (extract name from "const foo = ...")
      for (const c of parts.constants) {
        const match = c.match(/^const\s+(\w+)/)
        const name = match?.[1]
        if (!name || !bundledConstantNames.has(name)) {
          if (name) bundledConstantNames.add(name)
          bundledConstants.push(c)
        }
      }
      // Propagate use imports from included files
      propagateUseImportsFromInclude(ctx, parts)
      // Merge JSCAD usage flags
      mergeJscadUsageFlags(ctx, parts)
    }
    // Track imported functions and modules from this include
    mergeImportedSymbols(ctx, cachedFile)
  }

  return {
    functions: bundledFunctions,
    modules: bundledModules,
    constants: bundledConstants,
    functionNames: bundledFunctionNames,
    moduleNames: bundledModuleNames,
    constantNames: bundledConstantNames,
  }
}

/**
 * Propagate use imports from included files to parent context
 */
function propagateUseImportsFromInclude(ctx: TranspileContext, parts: BundledParts): void {
  if (!parts.useImports) return

  for (const useImp of parts.useImports) {
    // Add to useImports if not already present (by resolved path)
    if (!ctx.useImports.some(u => u.resolvedPath === useImp.resolvedPath)) {
      ctx.useImports.push(useImp)
      // Also add symbols to available symbols
      for (const sym of useImp.symbols) {
        ctx.availableSymbols.add(sym)
      }
      // Track function/module exports from the propagated use import
      const usedFile = ctx.transpiledFiles.get(useImp.resolvedPath)
      if (usedFile?.functionExports) {
        for (const fn of usedFile.functionExports) {
          ctx.importedFunctions.add(fn)
          ctx.availableFunctions.add(fn)
          const params = usedFile.functionParamLists?.get(fn)
          ctx.symbols.define(fn, { kind: 'function', source: 'imported', params })
        }
      }
    }
  }
}

/**
 * Merge JSCAD usage flags from bundled parts
 */
function mergeJscadUsageFlags(ctx: TranspileContext, parts: BundledParts): void {
  for (const p of parts.usedPrimitives) ctx.usedPrimitives.add(p)
  for (const t of parts.usedTransforms) ctx.usedTransforms.add(t)
  for (const b of parts.usedBooleans) ctx.usedBooleans.add(b)
  for (const e of parts.usedExtrusions) ctx.usedExtrusions.add(e)
  for (const h of parts.usedHelpers) ctx.usedHelpers.add(h)
  if (parts.usedColors) ctx.usedColors = true
  if (parts.usedHulls) ctx.usedHulls = true
  if (parts.usedMaths) ctx.usedMaths = true
  if (parts.usedMinMax) ctx.usedMinMax = true
}

/**
 * Merge imported symbols from a cached file
 */
function mergeImportedSymbols(ctx: TranspileContext, cachedFile: TranspiledFile | undefined): void {
  if (!cachedFile) return

  // Track which imported symbols are functions (not modules)
  if (cachedFile.functionExports) {
    for (const fn of cachedFile.functionExports) {
      ctx.importedFunctions.add(fn)
      ctx.availableFunctions.add(fn)
      const params = cachedFile.functionParamLists?.get(fn)
      ctx.symbols.define(fn, { kind: 'function', source: 'imported', params })
    }
  }
  // Track which imported symbols are modules (need curried call pattern)
  if (cachedFile.moduleExports) {
    for (const mod of cachedFile.moduleExports) {
      ctx.importedModules.add(mod)
      ctx.availableModules.add(mod)
      const params = cachedFile.paramLists?.get(mod)
      ctx.symbols.define(mod, { kind: 'module', source: 'imported', params })
    }
  }
  // Merge parameter lists
  if (cachedFile.paramLists) {
    for (const [name, params] of cachedFile.paramLists) {
      ctx.moduleParamLists.set(name, params)
      ctx.symbols.registerParams(name, 'module', params)
    }
  }
  if (cachedFile.functionParamLists) {
    for (const [name, params] of cachedFile.functionParamLists) {
      ctx.functionParamLists.set(name, params)
      ctx.symbols.registerParams(name, 'function', params)
    }
  }
  // Merge dual-defined names
  if (cachedFile.dualDefinedNames) {
    for (const name of cachedFile.dualDefinedNames) {
      ctx.dualDefinedNames.add(name)
      const params = ctx.symbols.getParams(name, 'function') || ctx.symbols.getParams(name, 'module')
      if (params) {
        ctx.moduleParamLists.set(`${name}__fn`, params)
        ctx.symbols.registerParams(`${name}__fn`, 'module', params)
      }
    }
  }
}

/**
 * Second pass: transpile statements into separate categories
 */
function transpileAllStatements(ast: ScadFile, ctx: TranspileContext): TranspiledStatements {
  const localFunctions: string[] = []
  const localModules: string[] = []
  const localConstants: string[] = []
  const geometryParts: string[] = []

  // Track dual-defined names (both module and function) for expression transpilation
  // SymbolTable already tracks this, but we need to populate the legacy dualDefinedNames set
  // for code that hasn't been migrated yet
  for (const name of ctx.symbols.getDualDefined()) {
    ctx.dualDefinedNames.add(name)
  }

  // Register __fn variants in paramLists so reorderNamedArgs can find them
  for (const name of ctx.dualDefinedNames) {
    const params = ctx.symbols.getParams(name, 'function') || ctx.symbols.getParams(name, 'module')
    if (params) {
      ctx.moduleParamLists.set(`${name}__fn`, params)
      ctx.symbols.registerParams(`${name}__fn`, 'module', params)
    }
  }

  for (const stmt of ast.statements) {
    if (isModuleDeclaration(stmt)) {
      localModules.push(transpileModuleDeclaration(stmt, ctx))
    } else if (isFunctionDeclaration(stmt)) {
      localFunctions.push(transpileFunctionDeclaration(stmt, ctx))
    } else if (isUseStmt(stmt) || isIncludeStmt(stmt)) {
      // Already collected in first pass
    } else if (isAssignmentNode(stmt)) {
      // Top-level variable assignment
      const value = transpileExpression(stmt.value!, ctx)
      if (isStackSpecialVar(stmt.name)) {
        localConstants.push(`j$.setSpecialVar('${stmt.name}', ${value})`)
      } else {
        const varName = safeIdentifier(stmt.name)
        localConstants.push(`const ${varName} = ${value}`)
      }
    } else {
      // File-scope geometry/statements
      const code = transpileStatement(stmt, ctx)
      if (code) {
        geometryParts.push(code)
      }
    }
  }

  return { localFunctions, localModules, localConstants, geometryParts }
}

/**
 * Build the output code string
 */
function buildOutputCode(
  ctx: TranspileContext,
  bundled: BundledContent,
  transpiled: TranspiledStatements
): { code: string; allExports: string[] } {
  const parts: string[] = []

  // Header with JSCAD imports
  if (ctx.options.includeHeader) {
    const imports = buildJscadImports(ctx)
    if (imports.length > 0) {
      parts.push(imports.join('\n'))
      parts.push('')
    }
  }

  // Track imported symbols to avoid duplicates
  const importedSymbols = new Set<string>()
  for (const includeImport of ctx.includeImports) {
    for (const sym of includeImport.symbols) {
      importedSymbols.add(sym)
    }
  }

  // Use imports (require statements for .scad files)
  if (ctx.useImports.length > 0) {
    for (const imp of ctx.useImports) {
      const jsPath = imp.resolvedPath.replace(/\.scad$/, '.js')
      const newSymbols = imp.symbols.filter(s => !importedSymbols.has(s))
      for (const s of newSymbols) importedSymbols.add(s)
      if (newSymbols.length > 0) {
        parts.push(`const { ${newSymbols.join(', ')} } = require('./${jsPath}')`)
      } else if (imp.symbols.length === 0) {
        parts.push(`const ${getModuleName(imp.filename)} = require('./${jsPath}')`)
      }
    }
    parts.push('')
  }

  // ALL FUNCTION DEFINITIONS FIRST (bundled from includes + local)
  const allFunctions = [...bundled.functions, ...transpiled.localFunctions]
  if (allFunctions.length > 0) {
    parts.push(allFunctions.join('\n\n'))
    parts.push('')
  }

  // LIBRARY CONSTANTS (bundled from includes) - BEFORE MODULES
  if (bundled.constants.length > 0) {
    parts.push(bundled.constants.join('\n'))
    parts.push('')
  }

  // ALL MODULE DEFINITIONS (bundled from includes + local)
  const allModules = [...bundled.modules, ...transpiled.localModules]
  if (allModules.length > 0) {
    parts.push(allModules.join('\n\n'))
    parts.push('')
  }

  // LOCAL CONSTANT ASSIGNMENTS
  if (transpiled.localConstants.length > 0) {
    parts.push(transpiled.localConstants.join('\n'))
    parts.push('')
  }

  // Main function with file-scope geometry
  if (transpiled.geometryParts.length > 0) {
    const mainBody = transpiled.geometryParts.length === 1
      ? transpiled.geometryParts[0]
      : `j$.safeUnion([\n${transpiled.geometryParts.map(p => `    ${p}`).join(',\n')}\n  ])`
    parts.push(`const main = () => {\n  return ${mainBody}\n}`)
    parts.push('')
  } else {
    parts.push(`const main = () => undefined`)
    parts.push('')
  }

  // Exports - use SymbolTable as source of truth
  // Export only local symbols (defined in this file), not imported (from USE) or included (bundled from INCLUDE)
  const moduleExportNames = ctx.symbols.getByKind('module')
    .filter(name => ctx.symbols.isFromSource(name, 'local'))
    .map(name => `${name}_$m`)
  const functionExportNames = ctx.symbols.getByKind('function')
    .filter(name => ctx.symbols.isFromSource(name, 'local'))
    .map(name => `${name}_$f`)
  const includeReExports = ctx.includeImports.flatMap(imp => imp.symbols)
  const allExports = [...new Set([...moduleExportNames, ...functionExportNames, ...ctx.variableNames, ...includeReExports, 'main'])]
  parts.push(`module.exports = { ${allExports.join(', ')} }`)

  return { code: parts.join('\n'), allExports }
}

/**
 * Create bundled parts for caching (used when this file is included by others)
 */
function createBundledParts(
  ctx: TranspileContext,
  bundled: BundledContent,
  transpiled: TranspiledStatements
): BundledParts {
  return {
    functions: [...bundled.functions, ...transpiled.localFunctions],
    modules: [...bundled.modules, ...transpiled.localModules],
    constants: [...transpiled.localConstants, ...bundled.constants],
    useImports: [...ctx.useImports],
    usedPrimitives: new Set(ctx.usedPrimitives),
    usedTransforms: new Set(ctx.usedTransforms),
    usedBooleans: new Set(ctx.usedBooleans),
    usedExtrusions: new Set(ctx.usedExtrusions),
    usedHelpers: new Set(ctx.usedHelpers),
    usedColors: ctx.usedColors,
    usedHulls: ctx.usedHulls,
    usedMaths: ctx.usedMaths,
    usedMinMax: ctx.usedMinMax,
  }
}

/**
 * Transpile OpenSCAD AST to JavaScript
 *
 * @param ast - Parsed OpenSCAD AST
 * @param options - Transpile options including fileResolver for multi-file support
 * @param sharedCache - Optional shared cache for recursive transpilation
 */
export function transpile(
  ast: ScadFile,
  options: TranspileOptions = {},
  sharedCache?: Map<string, TranspiledFile>
): TranspileResult {
  const ctx = createContext(options, sharedCache)

  // Mark current file as processing (for cycle detection)
  if (ctx.options.currentFile) {
    ctx.processingFiles.add(ctx.options.currentFile)
  }

  // First pass: collect module/function names and use statements
  for (const stmt of ast.statements) {
    collectDeclarations(stmt, ctx)
  }

  // Add local definitions to available symbols (use SymbolTable as source of truth)
  for (const name of ctx.symbols.getByKind('module')) {
    if (ctx.symbols.isFromSource(name, 'local')) {
      ctx.availableSymbols.add(name)
    }
  }
  for (const name of ctx.symbols.getByKind('function')) {
    if (ctx.symbols.isFromSource(name, 'local')) {
      ctx.availableSymbols.add(name)
    }
  }

  // Compute directory of current file for resolving relative paths
  const currentFileDir = getFileDir(ctx.options.currentFile)

  // Pre-pass: collect all function/module signatures from include files recursively
  collectSignaturesFromIncludes(ctx)

  // Process use statements: transpile dependencies and discover exports
  processUseStatements(ctx, currentFileDir)

  // Process include statements: transpile dependencies and bundle content
  const bundled = processIncludeStatements(ctx, currentFileDir)

  // Second pass: transpile statements into separate categories
  const transpiled = transpileAllStatements(ast, ctx)

  // Check if we need safeUnion for file-scope geometry
  if (transpiled.geometryParts.length > 1) {
    ctx.usedHelpers.add('safeUnion')
  }

  // Build the output code
  const { code, allExports } = buildOutputCode(ctx, bundled, transpiled)

  // Create bundled parts for caching
  const bundledParts = createBundledParts(ctx, bundled, transpiled)

  // Add this file to the cache if it has a name
  if (ctx.options.currentFile) {
    // Build param lists from SymbolTable
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

    ctx.transpiledFiles.set(ctx.options.currentFile, {
      code,
      exports: allExports.filter((e: string) => e !== 'main'),
      functionExports: ctx.symbols.getByKind('function')
        .filter(name => ctx.symbols.isFromSource(name, 'local') && name !== 'main'),
      moduleExports: ctx.symbols.getByKind('module')
        .filter(name => ctx.symbols.isFromSource(name, 'local') && name !== 'main'),
      paramLists: moduleParamLists,
      functionParamLists: functionParamLists,
      dualDefinedNames: new Set(ctx.symbols.getDualDefined()),
      bundledParts,
    })
  }

  return {
    code,
    exports: allExports,
    imports: ctx.useImports,
    files: ctx.transpiledFiles,
    warnings: ctx.warnings,
    errors: ctx.errors,
  }
}

/**
 * Pre-pass: Recursively collect all function/module signatures from include files
 * This ensures all signatures are available before any transpilation happens
 * (needed because include order in OpenSCAD doesn't matter - all defs are hoisted)
 */
function collectSignaturesFromIncludes(
  ctx: TranspileContext,
  visitedFiles: Set<string> = new Set()
): void {
  const fileResolver = ctx.options.fileResolver
  if (!fileResolver) return

  const currentFileDir = getFileDir(ctx.options.currentFile)

  // Process all include imports
  for (const includeImport of ctx.includeImports) {
    const resolvedPath = currentFileDir + includeImport.filename
    if (visitedFiles.has(resolvedPath)) continue
    visitedFiles.add(resolvedPath)

    // Read and parse the file (caching the AST for later use)
    const source = fileResolver(includeImport.filename, ctx.options.currentFile)
    if (!source) {
      ctx.errors.push({
        code: ErrorCode.FILE_NOT_FOUND,
        message: `Cannot resolve include file: ${includeImport.filename}`,
        file: ctx.options.currentFile,
      })
      continue
    }

    const { ast, errors } = parse(source)
    if (errors.length > 0) {
      ctx.errors.push({
        code: ErrorCode.PARSE_ERROR,
        message: `Parse error in include file: ${includeImport.filename}`,
        file: ctx.options.currentFile,
      })
      continue
    }

    // Cache the parsed AST so transpileAndCacheDependency can reuse it
    ctx.parsedFiles.set(resolvedPath, ast)

    // Collect signatures from this file
    // Track module and function names to detect dual-defined names
    const fileModuleNames = new Set<string>()
    const fileFunctionNames = new Set<string>()

    for (const stmt of ast.statements) {
      if (isModuleDeclaration(stmt)) {
        const name = safeIdentifier(stmt.name)
        fileModuleNames.add(name)
        // Track this module name globally (for builtin override detection)
        ctx.includedModuleNames.add(name)
        ctx.availableModules.add(name)
        // Deduplicate params to match how transpileParamsList handles the definition
        const params = deduplicateParamNames(stmt.definitionArgs || [])
        // Always set module params - module definition takes precedence over function definition
        // for moduleParamLists since that's used for module calls (name_$m)
        ctx.moduleParamLists.set(name, params)
        // Also populate SymbolTable
        ctx.symbols.define(name, { kind: 'module', source: 'included', params })
      } else if (isFunctionDeclaration(stmt)) {
        const name = safeIdentifier(stmt.name)
        fileFunctionNames.add(name)
        // Track this function name globally (for suffix selection)
        ctx.includedFunctionNames.add(name)
        ctx.availableFunctions.add(name)
        // Deduplicate params to match how transpileParamsList handles the definition
        const params = deduplicateParamNames(stmt.definitionArgs || [])
        if (!ctx.functionParamLists.has(name)) {
          ctx.functionParamLists.set(name, params)
        }
        // Don't add to moduleParamLists - keep namespaces separate
        // reorderNamedArgs already has fallback: moduleParams || functionParams
        // Also populate SymbolTable
        ctx.symbols.define(name, { kind: 'function', source: 'included', params })
      }
    }

    // Detect dual-defined names (both module and function with same name)
    // and add to context so function calls use __fn suffix
    for (const name of fileFunctionNames) {
      if (fileModuleNames.has(name)) {
        ctx.dualDefinedNames.add(name)
        // Register __fn variant in paramLists so reorderNamedArgs can find it
        const params = ctx.symbols.getParams(name, 'function') || ctx.symbols.getParams(name, 'module')
        if (params) {
          ctx.moduleParamLists.set(`${name}__fn`, params)
          ctx.symbols.registerParams(`${name}__fn`, 'module', params)
        }
      }
    }

    // Recursively collect from nested includes
    const nestedCtx: TranspileContext = {
      ...ctx,
      options: { ...ctx.options, currentFile: resolvedPath },
      includeImports: [],
    }
    for (const stmt of ast.statements) {
      if (isIncludeStmt(stmt)) {
        nestedCtx.includeImports.push({
          filename: stmt.filename,
          resolvedPath: '',
          symbols: [],
        })
      }
    }
    collectSignaturesFromIncludes(nestedCtx, visitedFiles)

    // Copy collected signatures back to main context
    for (const [name, params] of nestedCtx.moduleParamLists) {
      if (!ctx.moduleParamLists.has(name)) {
        ctx.moduleParamLists.set(name, params)
        ctx.symbols.registerParams(name, 'module', params)
      }
    }
    for (const [name, params] of nestedCtx.functionParamLists) {
      if (!ctx.functionParamLists.has(name)) {
        ctx.functionParamLists.set(name, params)
        ctx.symbols.registerParams(name, 'function', params)
      }
    }
    // Copy dual-defined names from nested includes
    for (const name of nestedCtx.dualDefinedNames) {
      ctx.dualDefinedNames.add(name)
      // Also register __fn variant
      const params = ctx.symbols.getParams(name, 'function') || ctx.symbols.getParams(name, 'module')
      if (params && !ctx.moduleParamLists.has(`${name}__fn`)) {
        ctx.moduleParamLists.set(`${name}__fn`, params)
        ctx.symbols.registerParams(`${name}__fn`, 'module', params)
      }
    }
    // Copy included function names from nested includes
    for (const name of nestedCtx.includedFunctionNames) {
      ctx.includedFunctionNames.add(name)
      ctx.availableFunctions.add(name)
    }
    // Copy included module names from nested includes
    for (const name of nestedCtx.includedModuleNames) {
      ctx.includedModuleNames.add(name)
      ctx.availableModules.add(name)
    }
    // Merge SymbolTable from nested context
    ctx.symbols.merge(nestedCtx.symbols)
  }
}

/**
 * Transpile a dependency file and cache the result
 * Returns the exported symbol names
 * @param isInclude - true for include statements, false for use statements
 *   Include files get access to includedModuleNames (bundled together)
 *   Use files don't (they run in separate scope via require)
 */
function transpileAndCacheDependency(filename: string, ctx: TranspileContext, isInclude: boolean = false): string[] {
  const fileResolver = ctx.options.fileResolver
  if (!fileResolver) {
    // No file resolver - can't process dependencies
    return []
  }

  // Compute the resolved path relative to the current file's directory
  // This is important for nested dependencies to resolve their own imports correctly
  const currentFileDir = getFileDir(ctx.options.currentFile)
  const resolvedFilename = currentFileDir + filename

  // Check cache first (using resolved path)
  const cached = ctx.transpiledFiles.get(resolvedFilename)
  if (cached) {
    return cached.exports
  }

  // Detect cycles (using resolved path)
  if (ctx.processingFiles.has(resolvedFilename)) {
    // Circular dependency - record error but don't fail
    ctx.errors.push({
      code: ErrorCode.CIRCULAR_DEPENDENCY,
      message: `Circular dependency detected: ${resolvedFilename}`,
      file: ctx.options.currentFile,
    })
    return []
  }

  // Check if AST is already cached from signature pre-pass
  let ast = ctx.parsedFiles.get(resolvedFilename)

  if (!ast) {
    // Not cached - resolve and read the file
    const source = fileResolver(filename, ctx.options.currentFile)
    if (!source) {
      ctx.errors.push({
        code: ErrorCode.FILE_NOT_FOUND,
        message: `Cannot resolve file: ${filename}`,
        file: ctx.options.currentFile,
      })
      return []
    }

    // Parse the file
    const { ast: parsedAst, errors } = parse(source)
    if (errors.length > 0) {
      ctx.errors.push({
        code: ErrorCode.PARSE_ERROR,
        message: `Parse error in ${filename}: ${errors.map(e => e.message || String(e)).join(', ')}`,
        file: resolvedFilename,
      })
      return []
    }
    ast = parsedAst
  }

  // Recursively transpile this file (sharing the cache)
  // Use resolved path as currentFile so nested dependencies resolve correctly
  // Pass current paramLists, dualDefinedNames, and importedFunctions so sibling includes can resolve calls
  // For include files, pass includedModuleNames because those are bundled together
  // For use files, don't pass them because they run in separate scope via require()
  const result = transpile(ast, {
    ...ctx.options,
    currentFile: resolvedFilename,
    initialParamLists: ctx.moduleParamLists,
    initialFunctionParamLists: ctx.functionParamLists,
    initialDualDefinedNames: ctx.dualDefinedNames,
    initialImportedFunctions: ctx.importedFunctions,
    initialIncludedModuleNames: isInclude ? ctx.includedModuleNames : undefined,
    initialIncludedFunctionNames: isInclude ? ctx.includedFunctionNames : undefined,
  }, ctx.transpiledFiles)

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
    })
  }

  // Return exports (excluding 'main')
  return result.exports.filter(e => e !== 'main')
}

/**
 * First pass: collect declarations
 */
function collectDeclarations(stmt: Statement, ctx: TranspileContext): void {
  if (isModuleDeclaration(stmt)) {
    const name = safeIdentifier(stmt.name)
    ctx.moduleNames.push(name)
    ctx.availableModules.add(name)
    // Capture parameter names for named argument reordering
    // Deduplicate params to match how transpileParamsList handles the definition
    const params = deduplicateParamNames(stmt.definitionArgs || [])
    ctx.moduleParamLists.set(name, params)
    // Also populate SymbolTable
    ctx.symbols.define(name, { kind: 'module', source: 'local', params })
  } else if (isFunctionDeclaration(stmt)) {
    const name = safeIdentifier(stmt.name)
    ctx.functionNames.push(name)
    ctx.availableFunctions.add(name)
    // Capture parameter names for named argument reordering
    // Use functionParamLists to keep separate from module params
    // Deduplicate params to match how transpileParamsList handles the definition
    const params = deduplicateParamNames(stmt.definitionArgs || [])
    ctx.functionParamLists.set(name, params)
    // Don't add to moduleParamLists - keep namespaces separate
    // reorderNamedArgs already has fallback: moduleParams || functionParams
    // Also populate SymbolTable
    ctx.symbols.define(name, { kind: 'function', source: 'local', params })
  } else if (isUseStmt(stmt)) {
    ctx.useImports.push({
      filename: stmt.filename,
      resolvedPath: '',  // Will be computed during processing
      symbols: [],
    })
  } else if (isIncludeStmt(stmt)) {
    // Include imports everything including variables/constants
    ctx.includeImports.push({
      filename: stmt.filename,
      resolvedPath: '',  // Will be computed during processing
      symbols: [],
    })
  } else if (isAssignmentNode(stmt)) {
    // Track top-level variable assignments for export
    // Don't export special variables - they're set via setSpecialVar and don't exist as JS variables
    if (!isStackSpecialVar(stmt.name)) {
      ctx.variableNames.push(safeIdentifier(stmt.name))
    }
  }
}
