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
  Expression,
  AssignmentNode,
} from 'openscad-parser'
import { parse } from '../parser/parse.js'
import { safeIdentifier, getFileDir } from '../utils/identifiers.js'
import {
  TranspileContext,
  TranspileOptions,
  TranspileResult,
  TranspiledFile,
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

  // Add local definitions to available symbols
  for (const name of ctx.moduleNames) {
    ctx.availableSymbols.add(name)
  }
  for (const name of ctx.functionNames) {
    ctx.availableSymbols.add(name)
  }

  // Compute directory of current file for resolving relative paths
  const currentFileDir = getFileDir(ctx.options.currentFile)

  // Process use statements: transpile dependencies and discover their exports
  for (const useImport of ctx.useImports) {
    // Compute resolved path relative to root
    useImport.resolvedPath = currentFileDir + useImport.filename
    const symbols = transpileAndCacheDependency(useImport.filename, ctx)
    useImport.symbols = symbols
    for (const sym of symbols) {
      ctx.availableSymbols.add(sym)
    }
    // Track which imported symbols are functions (not modules)
    const cachedFile = ctx.transpiledFiles.get(useImport.resolvedPath)
    if (cachedFile?.functionExports) {
      for (const fn of cachedFile.functionExports) {
        ctx.importedFunctions.add(fn)
      }
    }
    // Merge parameter lists from imported modules for named argument reordering
    if (cachedFile?.paramLists) {
      for (const [name, params] of cachedFile.paramLists) {
        ctx.moduleParamLists.set(name, params)
      }
    }
  }

  // Process include statements: transpile dependencies and import ALL exports (including variables)
  for (const includeImport of ctx.includeImports) {
    // Compute resolved path relative to root
    includeImport.resolvedPath = currentFileDir + includeImport.filename
    const symbols = transpileAndCacheDependency(includeImport.filename, ctx)
    includeImport.symbols = symbols
    for (const sym of symbols) {
      ctx.availableSymbols.add(sym)
    }
    // Track which imported symbols are functions (not modules)
    const cachedFile = ctx.transpiledFiles.get(includeImport.resolvedPath)
    if (cachedFile?.functionExports) {
      for (const fn of cachedFile.functionExports) {
        ctx.importedFunctions.add(fn)
      }
    }
    // Merge parameter lists from imported modules for named argument reordering
    if (cachedFile?.paramLists) {
      for (const [name, params] of cachedFile.paramLists) {
        ctx.moduleParamLists.set(name, params)
      }
    }
  }

  // Second pass: transpile statements
  const bodyParts: string[] = []
  const geometryParts: string[] = []
  const topLevelAssignments: { name: string, value: Expression | null }[] = []

  // Track which names have both module and function versions
  // In OpenSCAD, you can have both `module foo()` and `function foo()` with the same name
  // In JavaScript, we can only have one - prefer the function version since it's more flexible
  const functionNameSet = new Set(ctx.functionNames)

  for (const stmt of ast.statements) {
    if (isModuleDeclaration(stmt)) {
      const moduleName = safeIdentifier(stmt.name)
      // Skip module if a function with the same name exists
      if (functionNameSet.has(moduleName)) {
        // Module with same name as function - skip (function version will be used)
        continue
      }
      bodyParts.push(transpileModuleDeclaration(stmt, ctx))
    } else if (isFunctionDeclaration(stmt)) {
      bodyParts.push(transpileFunctionDeclaration(stmt, ctx))
    } else if (isUseStmt(stmt) || isIncludeStmt(stmt)) {
      // Already collected in first pass
    } else if (isAssignmentNode(stmt)) {
      // Top-level variable assignment
      topLevelAssignments.push({ name: stmt.name, value: stmt.value })
    } else {
      // File-scope geometry/statements
      const code = transpileStatement(stmt, ctx)
      if (code) {
        geometryParts.push(code)
      }
    }
  }

  // Check if we need union for file-scope geometry (before building imports)
  if (geometryParts.length > 1) {
    ctx.usedBooleans.add('union')
  }

  // Transpile top-level assignments BEFORE building imports so helper requirements are captured
  const assignmentLines: string[] = []
  if (topLevelAssignments.length > 0) {
    for (const a of topLevelAssignments) {
      assignmentLines.push(`const ${safeIdentifier(a.name)} = ${transpileExpression(a.value!, ctx)}`)
    }
  }

  // Build the output
  const parts: string[] = []

  // Header with JSCAD imports (now includes helpers used by assignments)
  if (ctx.options.includeHeader) {
    const imports = buildJscadImports(ctx)
    if (imports.length > 0) {
      parts.push(imports.join('\n'))
      parts.push('')
    }
  }

  // Track imported symbols to avoid duplicates (re-exports can cause this)
  const importedSymbols = new Set<string>()

  // Use imports (require statements for .scad files - modules/functions only)
  if (ctx.useImports.length > 0) {
    for (const imp of ctx.useImports) {
      // Use resolvedPath for require to get absolute path from root
      const jsPath = imp.resolvedPath.replace(/\.scad$/, '.js')
      // Filter out already-imported symbols
      const newSymbols = imp.symbols.filter(s => !importedSymbols.has(s))
      for (const s of newSymbols) importedSymbols.add(s)
      if (newSymbols.length > 0) {
        // Destructuring import with discovered symbols
        parts.push(`const { ${newSymbols.join(', ')} } = require('./${jsPath}')`)
      } else if (imp.symbols.length === 0) {
        // Fallback: import entire module (no file resolver or empty file)
        parts.push(`const ${getModuleName(imp.filename)} = require('./${jsPath}')`)
      }
    }
    parts.push('')
  }

  // Include imports (require statements for .scad files - everything including variables)
  if (ctx.includeImports.length > 0) {
    for (const imp of ctx.includeImports) {
      // Use resolvedPath for require to get absolute path from root
      const jsPath = imp.resolvedPath.replace(/\.scad$/, '.js')
      // Filter out already-imported symbols
      const newSymbols = imp.symbols.filter(s => !importedSymbols.has(s))
      for (const s of newSymbols) importedSymbols.add(s)
      if (newSymbols.length > 0) {
        // Destructuring import with all discovered symbols including variables
        parts.push(`const { ${newSymbols.join(', ')} } = require('./${jsPath}')`)
      } else if (imp.symbols.length === 0) {
        // Fallback: import entire module
        parts.push(`const ${getModuleName(imp.filename)} = require('./${jsPath}')`)
      }
    }
    parts.push('')
  }

  // Module and function definitions
  if (bodyParts.length > 0) {
    parts.push(bodyParts.join('\n\n'))
    parts.push('')
  }

  // Top-level variable assignments (already transpiled above)
  if (assignmentLines.length > 0) {
    parts.push(assignmentLines.join('\n'))
    parts.push('')
  }

  // Main function with file-scope geometry
  if (geometryParts.length > 0) {
    const mainBody = geometryParts.length === 1
      ? geometryParts[0]
      : `union(\n${geometryParts.map(p => `    ${p}`).join(',\n')}\n  )`
    parts.push(`const main = () => {\n  return ${mainBody}\n}`)
    parts.push('')
  } else {
    // Empty main if no geometry
    parts.push(`const main = () => undefined`)
    parts.push('')
  }

  // Exports (modules, functions, and top-level variables)
  // Filter out module names that have a corresponding function (we skip those modules)
  const moduleExports = ctx.moduleNames.filter(name => !functionNameSet.has(name))
  // Include re-exports symbols from included files (include statement = re-export all)
  const includeReExports = ctx.includeImports.flatMap(imp => imp.symbols)
  const allExports = [...new Set([...moduleExports, ...ctx.functionNames, ...ctx.variableNames, ...includeReExports, 'main'])]
  parts.push(`module.exports = { ${allExports.join(', ')} }`)

  const code = parts.join('\n')

  // Add this file to the cache if it has a name
  if (ctx.options.currentFile) {
    ctx.transpiledFiles.set(ctx.options.currentFile, {
      code,
      exports: allExports.filter(e => e !== 'main'),
      functionExports: ctx.functionNames.filter(e => e !== 'main'),
      paramLists: new Map(ctx.moduleParamLists),
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
 * Transpile a dependency file and cache the result
 * Returns the exported symbol names
 */
function transpileAndCacheDependency(filename: string, ctx: TranspileContext): string[] {
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

  // Resolve and read the file
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
  const { ast, errors } = parse(source)
  if (errors.length > 0) {
    ctx.errors.push({
      code: ErrorCode.PARSE_ERROR,
      message: `Parse error in ${filename}: ${errors.map(e => e.message || String(e)).join(', ')}`,
      file: resolvedFilename,
    })
    return []
  }

  // Recursively transpile this file (sharing the cache)
  // Use resolved path as currentFile so nested dependencies resolve correctly
  const result = transpile(ast, {
    ...ctx.options,
    currentFile: resolvedFilename,
  }, ctx.transpiledFiles)

  // Cache the result (using resolved path)
  const cachedFile = ctx.transpiledFiles.get(resolvedFilename)
  if (!cachedFile) {
    // File should have been cached during transpile, but add safety check
    ctx.transpiledFiles.set(resolvedFilename, {
      code: result.code,
      exports: result.exports.filter(e => e !== 'main'),
      functionExports: [],  // This shouldn't happen, file was already cached
      paramLists: new Map(),
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
    // Capture parameter names for named argument reordering
    const params = (stmt.definitionArgs || []).map((a: AssignmentNode) => a.name)
    ctx.moduleParamLists.set(name, params)
  } else if (isFunctionDeclaration(stmt)) {
    const name = safeIdentifier(stmt.name)
    ctx.functionNames.push(name)
    // Capture parameter names for named argument reordering
    const params = (stmt.definitionArgs || []).map((a: AssignmentNode) => a.name)
    ctx.moduleParamLists.set(name, params)
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
    ctx.variableNames.push(safeIdentifier(stmt.name))
  }
}
