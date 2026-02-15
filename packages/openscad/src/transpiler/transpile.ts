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
  AssignmentNode,
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

/**
 * Deduplicate parameter names, keeping the LAST occurrence of each name.
 * This matches how transpileParamsList handles duplicates in function definitions.
 * OpenSCAD allows duplicate parameter names (e.g., `module foo(r, d, r)`),
 * but JavaScript doesn't, so we keep only the last occurrence.
 */
function deduplicateParamNames(args: AssignmentNode[]): string[] {
  const seenNames = new Map<string, number>()
  args.forEach((arg, i) => seenNames.set(arg.name, i))
  return args
    .filter((arg, i) => seenNames.get(arg.name) === i)
    .map(a => a.name)
}

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

  // Pre-pass: collect all function/module signatures from include files recursively
  // This ensures all signatures are available before any transpilation (OpenSCAD hoists all defs)
  collectSignaturesFromIncludes(ctx)

  // Process use statements: transpile dependencies and discover their exports
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
      }
    }
    // Merge parameter lists from imported modules for named argument reordering
    if (cachedFile?.paramLists) {
      for (const [name, params] of cachedFile.paramLists) {
        ctx.moduleParamLists.set(name, params)
      }
    }
    // Merge function parameter lists (functions may have more params than modules)
    if (cachedFile?.functionParamLists) {
      for (const [name, params] of cachedFile.functionParamLists) {
        ctx.functionParamLists.set(name, params)
      }
    }
    // Merge dual-defined names from imported modules
    if (cachedFile?.dualDefinedNames) {
      for (const name of cachedFile.dualDefinedNames) {
        ctx.dualDefinedNames.add(name)
        // Register __fn variant using function params (may have more params than module)
        const params = ctx.functionParamLists.get(name) || ctx.moduleParamLists.get(name)
        if (params) {
          ctx.moduleParamLists.set(`${name}__fn`, params)
        }
      }
    }
  }

  // Process include statements: transpile dependencies and BUNDLE their content (not require)
  // This matches OpenSCAD's include semantics - everything is merged into one scope
  const bundledFunctions: string[] = []
  const bundledModules: string[] = []
  const bundledConstants: string[] = []
  // Track which declarations have already been bundled to avoid duplicates
  // OpenSCAD allows multiple includes of the same file (last value wins for variables)
  // but JavaScript const doesn't allow redeclaration, so we deduplicate
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
      // This implements OpenSCAD semantics: when A includes B, B's use imports become available in A
      if (parts.useImports) {
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
              }
            }
            // Note: modules from use imports are still treated as functions (no currying)
            // because use() only imports functions/modules, not the module call semantics
          }
        }
      }
      // Merge JSCAD usage flags
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
    // Track which imported symbols are functions (not modules)
    if (cachedFile?.functionExports) {
      for (const fn of cachedFile.functionExports) {
        ctx.importedFunctions.add(fn)
        ctx.availableFunctions.add(fn)
      }
    }
    // Track which imported symbols are modules (need curried call pattern)
    if (cachedFile?.moduleExports) {
      for (const mod of cachedFile.moduleExports) {
        ctx.importedModules.add(mod)
        ctx.availableModules.add(mod)
      }
    }
    // Merge parameter lists from imported modules for named argument reordering
    if (cachedFile?.paramLists) {
      for (const [name, params] of cachedFile.paramLists) {
        ctx.moduleParamLists.set(name, params)
      }
    }
    // Merge function parameter lists (functions may have more params than modules)
    if (cachedFile?.functionParamLists) {
      for (const [name, params] of cachedFile.functionParamLists) {
        ctx.functionParamLists.set(name, params)
      }
    }
    // Merge dual-defined names from imported modules
    if (cachedFile?.dualDefinedNames) {
      for (const name of cachedFile.dualDefinedNames) {
        ctx.dualDefinedNames.add(name)
        // Register __fn variant using function params (may have more params than module)
        const params = ctx.functionParamLists.get(name) || ctx.moduleParamLists.get(name)
        if (params) {
          ctx.moduleParamLists.set(`${name}__fn`, params)
        }
      }
    }
  }

  // Second pass: transpile statements into separate categories
  // Functions and modules go to bodyParts, constants to assignmentLines
  const localFunctions: string[] = []
  const localModules: string[] = []
  const localConstants: string[] = []
  const geometryParts: string[] = []

  // Track which names have both module and function versions
  // In OpenSCAD, you can have both `module foo()` and `function foo()` with the same name
  // In JavaScript, we generate both: module as `name`, function as `name__fn`
  const functionNameSet = new Set(ctx.functionNames)
  const moduleNameSet = new Set(ctx.moduleNames)

  // Track dual-defined names (both module and function) for expression transpilation
  const dualDefinedNames = new Set<string>()
  for (const name of functionNameSet) {
    if (moduleNameSet.has(name)) {
      dualDefinedNames.add(name)
      ctx.dualDefinedNames.add(name)
    }
  }

  // Register __fn variants in paramLists so reorderNamedArgs can find them for function calls
  // Use functionParamLists if available (functions may have more params than modules)
  for (const name of dualDefinedNames) {
    // Prefer function params (may have more params like p=_NO_ARG)
    const params = ctx.functionParamLists.get(name) || ctx.moduleParamLists.get(name)
    if (params) {
      ctx.moduleParamLists.set(`${name}__fn`, params)
    }
  }

  for (const stmt of ast.statements) {
    if (isModuleDeclaration(stmt)) {
      // Always generate module (even if function with same name exists)
      localModules.push(transpileModuleDeclaration(stmt, ctx))
    } else if (isFunctionDeclaration(stmt)) {
      // Functions always get _$f suffix, modules get _$m suffix
      // This eliminates the need for __fn renaming since namespaces don't conflict
      localFunctions.push(transpileFunctionDeclaration(stmt, ctx))
    } else if (isUseStmt(stmt) || isIncludeStmt(stmt)) {
      // Already collected in first pass
    } else if (isAssignmentNode(stmt)) {
      // Top-level variable assignment
      // Special variables ($fn, $fa, $fs, etc.) are already declared with 'let' at the top
      // via buildJscadImports, so we just reassign them instead of declaring new const
      const specialVars = new Set([
        '$fn', '$fa', '$fs', '$t', '$vpr', '$vpt', '$vpd', '$vpf', '$preview',
        // BOSL2 attachment system variables
        '$transform', '$parent_anchor', '$parent_spin', '$parent_orient',
        '$parent_geom', '$parent_size', '$parent_parts', '$attach_to',
        '$attach_anchor', '$attach_alignment', '$attach_inside',
        '$tags', '$tag', '$save_tag', '$tag_prefix', '$overlap',
        '$color', '$save_color', '$anchor_override',
        '$edge_angle', '$edge_length', '$tags_shown', '$tags_hidden',
        '$ghost_this', '$ghost', '$ghosting', '$highlight_this', '$highlight'
      ])
      const varName = safeIdentifier(stmt.name)
      const value = transpileExpression(stmt.value!, ctx)
      if (specialVars.has(stmt.name)) {
        localConstants.push(`${varName} = ${value}`)
      } else {
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

  // Check if we need safeUnion for file-scope geometry (before building imports)
  // safeUnion filters out undefined values from side-effect statements
  if (geometryParts.length > 1) {
    ctx.usedHelpers.add('safeUnion')
  }

  // Build the output
  const parts: string[] = []

  // Header with JSCAD imports (includes helpers used by all bundled content)
  if (ctx.options.includeHeader) {
    const imports = buildJscadImports(ctx)
    if (imports.length > 0) {
      parts.push(imports.join('\n'))
      parts.push('')
    }
  }

  // Track imported symbols to avoid duplicates (re-exports can cause this)
  // Pre-populate with symbols from bundled includes so we don't re-import them via use
  const importedSymbols = new Set<string>()
  for (const includeImport of ctx.includeImports) {
    for (const sym of includeImport.symbols) {
      importedSymbols.add(sym)
    }
  }

  // Use imports (require statements for .scad files - modules/functions only)
  // These stay as require() - 'use' only imports functions/modules, not top-level code
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

  // ALL FUNCTION DEFINITIONS FIRST (bundled from includes + local)
  // Functions use 'function' declarations which are hoisted in JavaScript
  // This allows forward references to work (e.g., constants calling functions defined later)
  const allFunctions = [...bundledFunctions, ...localFunctions]
  if (allFunctions.length > 0) {
    parts.push(allFunctions.join('\n\n'))
    parts.push('')
  }

  // LIBRARY CONSTANTS (bundled from includes) - BEFORE MODULES
  // These are constants like CENTER, UP, DOWN from library files
  // They MUST come before modules because modules may reference them in default parameters
  // e.g., trapezoid(..., anchor = CENTER) requires CENTER to be defined first
  if (bundledConstants.length > 0) {
    parts.push(bundledConstants.join('\n'))
    parts.push('')
  }

  // ALL MODULE DEFINITIONS (bundled from includes + local)
  // These come after library constants so that default parameters work correctly
  const allModules = [...bundledModules, ...localModules]
  if (allModules.length > 0) {
    parts.push(allModules.join('\n\n'))
    parts.push('')
  }

  // LOCAL CONSTANT ASSIGNMENTS (from the main file being transpiled)
  // These come AFTER modules because user code may call modules
  // e.g., path = trapezoid(15, 30, 15) requires trapezoid to be defined first
  // Local constants that are just value assignments (like _BOSL2_STD = true) are fine here
  // because they don't call any modules
  if (localConstants.length > 0) {
    parts.push(localConstants.join('\n'))
    parts.push('')
  }

  // Main function with file-scope geometry
  if (geometryParts.length > 0) {
    const mainBody = geometryParts.length === 1
      ? geometryParts[0]
      : `j$.safeUnion([\n${geometryParts.map(p => `    ${p}`).join(',\n')}\n  ])`
    parts.push(`const main = () => {\n  return ${mainBody}\n}`)
    parts.push('')
  } else {
    // Empty main if no geometry
    parts.push(`const main = () => undefined`)
    parts.push('')
  }

  // Exports (modules, functions, and top-level variables)
  // Use _$m suffix for modules and _$f suffix for functions (namespace separation)
  // Both modules and functions are exported - no filtering needed since suffixes prevent collision
  const moduleExportNames = ctx.moduleNames.map(name => `${name}_$m`)
  const functionExportNames = ctx.functionNames.map(name => `${name}_$f`)
  // Include re-exports symbols from included files (include statement = re-export all)
  // These already have the correct suffixes from the source file
  const includeReExports = ctx.includeImports.flatMap(imp => imp.symbols)
  // All exports - main is special (no suffix)
  const allExports = [...new Set([...moduleExportNames, ...functionExportNames, ...ctx.variableNames, ...includeReExports, 'main'])]
  parts.push(`module.exports = { ${allExports.join(', ')} }`)

  const code = parts.join('\n')

  // Create bundled parts for this file (used when this file is included by others)
  // Include both local definitions and anything bundled from includes
  // Order matters: local first, then bundled (matching output order)
  const bundledParts: BundledParts = {
    functions: [...bundledFunctions, ...localFunctions],
    modules: [...bundledModules, ...localModules],
    constants: [...localConstants, ...bundledConstants],
    // Include use imports so they propagate when this file is included
    // This implements OpenSCAD semantics: when A includes B, B's use imports become available in A
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

  // Add this file to the cache if it has a name
  if (ctx.options.currentFile) {
    ctx.transpiledFiles.set(ctx.options.currentFile, {
      code,
      exports: allExports.filter(e => e !== 'main'),
      // Keep original names (without _$f/_$m suffix) for lookup purposes
      // The suffix is added when generating the actual call
      functionExports: ctx.functionNames.filter(e => e !== 'main'),
      moduleExports: ctx.moduleNames.filter(e => e !== 'main'),
      paramLists: new Map(ctx.moduleParamLists),
      functionParamLists: new Map(ctx.functionParamLists),
      dualDefinedNames: new Set(ctx.dualDefinedNames),  // Include inherited dual-defined names from includes
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
    if (!source) continue

    const { ast, errors } = parse(source)
    if (errors.length > 0) continue

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
      }
    }

    // Detect dual-defined names (both module and function with same name)
    // and add to context so function calls use __fn suffix
    for (const name of fileFunctionNames) {
      if (fileModuleNames.has(name)) {
        ctx.dualDefinedNames.add(name)
        // Register __fn variant in paramLists so reorderNamedArgs can find it
        const params = ctx.functionParamLists.get(name) || ctx.moduleParamLists.get(name)
        if (params) {
          ctx.moduleParamLists.set(`${name}__fn`, params)
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
      }
    }
    for (const [name, params] of nestedCtx.functionParamLists) {
      if (!ctx.functionParamLists.has(name)) {
        ctx.functionParamLists.set(name, params)
      }
    }
    // Copy dual-defined names from nested includes
    for (const name of nestedCtx.dualDefinedNames) {
      ctx.dualDefinedNames.add(name)
      // Also register __fn variant
      const params = ctx.functionParamLists.get(name) || ctx.moduleParamLists.get(name)
      if (params && !ctx.moduleParamLists.has(`${name}__fn`)) {
        ctx.moduleParamLists.set(`${name}__fn`, params)
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
