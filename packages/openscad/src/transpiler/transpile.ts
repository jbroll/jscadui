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
import { safeIdentifier } from '../utils/identifiers.js'
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
// isStackSpecialVar no longer used - all $-prefixed vars use dynamic scoping universally
import { deduplicateParamNames, mergeSetInto, importSymbolsFromFile } from './utils.js'
import { splitDeclarationsByKind } from './bundling/mergeDeclarations.js'
import type { Declaration } from './managers/DeclarationTracker.js'
import { processDependency } from './dependencies/dependencyProcessor.js'

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
function processUseStatements(ctx: TranspileContext): void {
  for (const useImport of ctx.useImports) {
    // Transpile the dependency and get the resolved path from fileResolver
    const result = processDependency(useImport.filename, ctx)
    useImport.resolvedPath = result.resolvedPath
    useImport.symbols = result.symbols
    useImport.isCyclic = result.isCyclic
    // Import symbols from the cached file
    // NOTE: use imports don't define modules in SymbolTable (accessed via require())
    const cachedFile = ctx.transpiledFiles.get(useImport.resolvedPath)
    importSymbolsFromFile(cachedFile, ctx, { defineModules: false })
  }
}

/**
 * Process include statements: transpile dependencies and BUNDLE their content
 * This matches OpenSCAD's include semantics - everything is merged into one scope
 */
function processIncludeStatements(ctx: TranspileContext): BundledContent {
  const bundledFunctions: string[] = []
  const bundledModules: string[] = []
  const bundledConstants: string[] = []
  // Track which declarations have already been bundled to avoid duplicates
  const bundledFunctionNames = new Set<string>()
  const bundledModuleNames = new Set<string>()
  const bundledConstantNames = new Set<string>()

  for (const includeImport of ctx.includeImports) {
    // Transpile the dependency and get the resolved path from fileResolver
    const result = processDependency(includeImport.filename, ctx)
    includeImport.resolvedPath = result.resolvedPath
    includeImport.symbols = result.symbols
    // Get bundled parts for inlining
    const cachedFile = ctx.transpiledFiles.get(includeImport.resolvedPath)

    // Phase 1 optimization: If file contains only pure functions/modules, treat as 'use' instead
    if (cachedFile?.canOptimizeInclude) {
      // Move to useImports so it generates require() statement instead of bundling
      ctx.useImports.push(includeImport)

      // Still need to import symbols for symbol table (for type checking and call resolution)
      importSymbolsFromFile(cachedFile, ctx, { defineModules: false })

      // Also propagate transitive use imports from the optimized include.
      // e.g., if hot_ends.scad uses hot_end.scad and we include hot_ends.scad,
      // jhead.js needs a require() for hot_end.scad too so its functions are available.
      if (cachedFile.bundledParts) {
        propagateUseImportsFromInclude(ctx, cachedFile.bundledParts)
      }

      // Skip bundling for this file
      continue
    }

    // Cyclic include: placeholder in cache means the file is currently being transpiled.
    // We can't bundle its content, but we can still extract its `use` statements from
    // the AST so that transitive use dependencies are available in the current file.
    // e.g., jhead.scad includes hot_ends.scad (cyclic), hot_ends.scad uses hot_end.scad
    // → jhead.scad still needs hot_end.scad in its useImports so it can call hot_end funcs
    if (result.isCyclic) {
      const cyclicAst = ctx.parsedFiles.get(includeImport.resolvedPath)
      if (cyclicAst && ctx.options.fileResolver) {
        for (const stmt of cyclicAst.statements) {
          if (isUseStmt(stmt)) {
            const useResult = processDependency(stmt.filename, ctx, includeImport.resolvedPath)
            if (useResult.resolvedPath && !ctx.useImports.some(u => u.resolvedPath === useResult.resolvedPath)) {
              const useImp = {
                filename: stmt.filename,
                resolvedPath: useResult.resolvedPath,
                symbols: useResult.symbols,
                isCyclic: useResult.isCyclic,
              }
              ctx.useImports.push(useImp)
              const usedFile = ctx.transpiledFiles.get(useImp.resolvedPath)
              importSymbolsFromFile(usedFile, ctx, { defineModules: false, registerParams: true })
            }
          }
        }
      }
      mergeImportedSymbols(ctx, cachedFile)
      continue
    }

    // Original bundling logic for non-optimizable files
    if (cachedFile?.bundledParts) {
      const parts = cachedFile.bundledParts
      // Deduplicate functions by name (using pre-extracted names)
      for (let i = 0; i < parts.functions.length; i++) {
        const name = parts.functionNames[i]
        if (!name || !bundledFunctionNames.has(name)) {
          if (name) bundledFunctionNames.add(name)
          bundledFunctions.push(parts.functions[i])
        }
      }
      // Deduplicate modules by name (using pre-extracted names)
      for (let i = 0; i < parts.modules.length; i++) {
        const name = parts.moduleNames[i]
        if (!name || !bundledModuleNames.has(name)) {
          if (name) bundledModuleNames.add(name)
          bundledModules.push(parts.modules[i])
        }
      }
      // Deduplicate constants by name (using pre-extracted names)
      for (let i = 0; i < parts.constants.length; i++) {
        const name = parts.constantNames[i]
        if (!name || !bundledConstantNames.has(name)) {
          if (name) bundledConstantNames.add(name)
          bundledConstants.push(parts.constants[i])
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
      // Import symbols from the propagated use import.
      // registerParams must be true so that param lists are available for named-arg
      // reordering at call sites in this file (e.g., rounded_square calls from global.scad).
      const usedFile = ctx.transpiledFiles.get(useImp.resolvedPath)
      importSymbolsFromFile(usedFile, ctx, {
        defineModules: false,
        registerParams: true,
      })
    }
  }
}

/**
 * Merge JSCAD usage flags from bundled parts
 */
function mergeJscadUsageFlags(ctx: TranspileContext, parts: BundledParts): void {
  mergeSetInto(ctx.codeGen.usedPrimitives, parts.usedPrimitives)
  mergeSetInto(ctx.codeGen.usedTransforms, parts.usedTransforms)
  mergeSetInto(ctx.codeGen.usedBooleans, parts.usedBooleans)
  mergeSetInto(ctx.codeGen.usedExtrusions, parts.usedExtrusions)
  mergeSetInto(ctx.codeGen.usedHelpers, parts.usedHelpers)
  if (parts.usedColors) ctx.codeGen.usedColors = true
  if (parts.usedHulls) ctx.codeGen.usedHulls = true
  if (parts.usedMaths) ctx.codeGen.usedMaths = true
  if (parts.usedMinMax) ctx.codeGen.usedMinMax = true
}

/**
 * Merge imported symbols from a cached file
 * Used for include statements which import both functions and modules
 */
function mergeImportedSymbols(ctx: TranspileContext, cachedFile: TranspiledFile | undefined): void {
  // Import all symbols with default options (import everything)
  importSymbolsFromFile(cachedFile, ctx)
}

/**
 * Second pass: transpile statements into separate categories
 */
function transpileAllStatements(ast: ScadFile, ctx: TranspileContext): TranspiledStatements {
  const localFunctions: string[] = []
  const localModules: string[] = []
  const localConstants: string[] = []
  const geometryParts: string[] = []

  // Dual-defined names are already tracked in SymbolTable
  // No need to register __fn variants - getParams() uses preferKind instead

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
      // In OpenSCAD, ALL $-prefixed variables use dynamic scoping.
      // User-defined vars like $explode, $child_assembly, etc. must be in the
      // scope stack so that j$.getSpecialVar() can find them in child modules.
      if (stmt.name.startsWith('$')) {
        const code = `j$.setSpecialVar('${stmt.name}', ${value})`
        localConstants.push(code)

        // Track special variable assignments for AST-based bundling
        // Use the variable name (without $ prefix) as the key for deduplication
        ctx.declarations.addConstant(
          stmt.name,  // Keep the $ prefix for uniqueness
          code,
          stmt,
          {
            file: ctx.options.currentFile || 'input.scad',
            kind: 'local',
          }
        )
      } else {
        const varName = safeIdentifier(stmt.name)
        const code = `var ${varName} = ${value}`
        localConstants.push(code)

        // Track this declaration for AST-based bundling
        ctx.declarations.addConstant(
          varName,
          code,
          stmt,
          {
            file: ctx.options.currentFile || 'input.scad',
            kind: 'local',
          }
        )
      }
    } else {
      // File-scope geometry/statements
      const code = transpileStatement(stmt, ctx)
      if (code) {
        // Mark that this file has top-level geometry (for include optimization)
        ctx.codeGen.hasTopLevelGeometry = true
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
  // Only track symbols from non-optimized includes (optimized ones are in useImports)
  const importedSymbols = new Set<string>()
  const useImportPaths = new Set(ctx.useImports.map(imp => imp.resolvedPath))
  for (const includeImport of ctx.includeImports) {
    if (!useImportPaths.has(includeImport.resolvedPath)) {
      for (const sym of includeImport.symbols) {
        importedSymbols.add(sym)
      }
    }
  }

  // Use imports (require statements for .scad files)
  // We always use lazy namespace access (const _ns = require(...); var f = (...a) => _ns.f?.(...a))
  // instead of destructuring (var { f } = require(...)).
  //
  // Reason: mutual-dependency cycles (A uses B, B uses A) cause destructuring to capture
  // `undefined` when the cycle placeholder is returned — but by the time functions are
  // actually *called* (at render time, after all modules load), the namespace object has
  // been populated via Object.assign. Lazy access through the namespace therefore always
  // sees the real exports regardless of module evaluation order or shared-cache reuse.
  if (ctx.useImports.length > 0) {
    let nsIdx = 0
    for (const imp of ctx.useImports) {
      // Use resolvedPath to generate correct require() paths
      // resolvedPath is an absolute path starting with "/" (e.g., "/examples/openscad/bosl2/lib/std.scad")
      // The require system handles absolute paths by resolving them from the root URL
      // Fallback to filename if resolvedPath is empty (when no fileResolver)
      const scadPath = imp.resolvedPath || imp.filename
      const newSymbols = imp.symbols.filter(s => !importedSymbols.has(s))
      for (const s of newSymbols) importedSymbols.add(s)
      if (newSymbols.length > 0) {
        const nsVar = `_ns${nsIdx++}`
        parts.push(`const ${nsVar} = require('${scadPath}')`)
        for (const sym of newSymbols) {
          parts.push(`var ${sym} = (...a) => ${nsVar}.${sym}?.(...a)`)
        }
      } else if (imp.symbols.length === 0) {
        parts.push(`var ${getModuleName(imp.filename)} = require('${scadPath}')`)
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
    .filter(name => ctx.symbols.isFromSource(name, 'local', 'function'))
    .flatMap(name => {
      // Check if this function has parameters by looking it up in declarations
      const decl = ctx.declarations.get(name + '_$f')
      const hasParams = decl && decl.params && decl.params.length > 0

      // Only export _$f$obj variant if function has parameters
      return hasParams ? [`${name}_$f`, `${name}_$f$obj`] : [`${name}_$f`]
    })
  // Filter out optimized includes (which were moved to useImports and will be imported via require())
  // useImportPaths is already declared above
  // Re-export symbols from ALL includes (both bundled and optimized)
  // Optimized includes use require() but still need their symbols re-exported
  const includeReExports = ctx.includeImports
    .flatMap(imp => imp.symbols)
  const allExports = [...new Set([...moduleExportNames, ...functionExportNames, ...ctx.variableNames, ...includeReExports, 'main'])]
  // Use Object.assign to mutate the pre-registered exports object in-place.
  // This ensures cyclic requires (where the caller got an empty {} placeholder)
  // will see the real exports once the module finishes loading.
  parts.push(`Object.assign(exports, { ${allExports.join(', ')} })`)

  return { code: parts.join('\n'), allExports }
}

/**
 * Optimization info for include statement handling
 */
interface OptimizationInfo {
  canOptimizeInclude: boolean
  hasVariables: boolean
  hasTopLevelGeometry: boolean
}

/**
 * Create bundled parts for caching (used when this file is included by others)
 * Uses AST-based bundling to avoid fragile regex-based name extraction
 *
 * Returns both the bundledParts and allDeclarations (local + transitive from includes).
 * The allDeclarations must be stored in the cached TranspiledFile so that grandparent
 * files can recursively collect declarations from the full include chain.
 */
function createBundledParts(ctx: TranspileContext): { bundledParts: BundledParts; allDeclarations: Declaration[]; optimizationInfo: OptimizationInfo } {
  // Collect all local declarations
  const localDeclarations = ctx.declarations.getAll()

  // Collect declarations from includes (which themselves include transitive declarations
  // because we store allDeclarations in the cached TranspiledFile)
  const includeDeclarations: Declaration[] = []
  for (const inc of ctx.includeImports) {
    const file = ctx.transpiledFiles.get(inc.resolvedPath)
    if (file?.declarations) {
      includeDeclarations.push(...file.declarations)
    }
  }

  // Merge with dependency-correct ordering: include declarations first so that
  // transitive dependencies (e.g. M4_washer from washers.scad) are emitted before
  // the constants that reference them (e.g. M4_cap_screw from screws.scad).
  // Local declarations override same-named includes and appear at the end.
  // This matches OpenSCAD semantics where `include <file>` inlines the file content
  // at that point, so included constants are available when local ones are initialized.
  const declMap = new Map<string, Declaration>()
  // Include declarations first (transitive deps already in correct order recursively)
  for (const d of includeDeclarations) {
    if (!declMap.has(d.name)) declMap.set(d.name, d)
  }
  // Local declarations override any included ones with same name; appear at end
  for (const d of localDeclarations) {
    declMap.delete(d.name) // remove include version so local is appended at end
    declMap.set(d.name, d)
  }
  const allDeclarations = Array.from(declMap.values())

  // Split by kind
  const { functions: funcDecls, modules: modDecls, constants: constDecls } =
    splitDeclarationsByKind(allDeclarations)

  // Use the already-generated code stored in Declaration objects
  // This preserves the context in which they were generated (including included constants)
  const functions = funcDecls.map(d => d.code)
  const modules = modDecls.map(d => d.code)
  const constants = constDecls.map(d => d.code)

  const bundledParts: BundledParts = {
    functions,
    functionNames: funcDecls.map(d => d.name),
    modules,
    moduleNames: modDecls.map(d => d.name),
    constants,
    constantNames: constDecls.map(d => d.name),
    useImports: [...ctx.useImports],
    usedPrimitives: new Set(ctx.codeGen.usedPrimitives),
    usedTransforms: new Set(ctx.codeGen.usedTransforms),
    usedBooleans: new Set(ctx.codeGen.usedBooleans),
    usedExtrusions: new Set(ctx.codeGen.usedExtrusions),
    usedHelpers: new Set(ctx.codeGen.usedHelpers),
    usedColors: ctx.codeGen.usedColors,
    usedHulls: ctx.codeGen.usedHulls,
    usedMaths: ctx.codeGen.usedMaths,
    usedMinMax: ctx.codeGen.usedMinMax,
  }

  // Phase 1 optimization: Detect if this file can use require() instead of bundling
  // A file can be optimized if it contains ONLY functions/modules (no variables, no top-level geometry)
  // AND has no free variable references (identifiers that come from ambient include-scope).
  const hasVariables = constDecls.length > 0
  const hasTopLevelGeometry = ctx.codeGen.hasTopLevelGeometry

  // Build the set of names defined within this file (modules, functions, constants)
  // plus all their parameter names, to distinguish them from truly free variable refs.
  const localDefinedNames = new Set<string>([
    ...constDecls.map(d => d.name),
    ...funcDecls.map(d => d.name.replace(/_\$f(?:\$obj)?$/, '')),
    ...modDecls.map(d => d.name.replace(/_\$m$/, '')),
    // All param names from all declarations (to avoid false positives from param references)
    ...allDeclarations.flatMap(d => d.params || []),
  ])
  // Check if any identifier that fell through tracking is truly external:
  // a name is a free variable ref if it's not locally defined AND its only symbol-table
  // entry is 'inherited' (passed from the parent context) or it's not defined at all.
  // Symbols that are 'local', 'included', or 'imported' (via explicit use/include) are fine.
  const hasFreeVarRefs = allDeclarations.some(d => d.source.kind === 'local') &&
    [...ctx.potentialFreeVarRefs].some(name =>
      !localDefinedNames.has(name) &&
      (ctx.symbols.isFromSource(name, 'inherited') || !ctx.symbols.isDefined(name))
    )

  const canOptimizeInclude = !hasVariables && !hasTopLevelGeometry && !hasFreeVarRefs

  const optimizationInfo: OptimizationInfo = {
    canOptimizeInclude,
    hasVariables,
    hasTopLevelGeometry,
  }

  return { bundledParts, allDeclarations, optimizationInfo }
}

/**
 * Transpile OpenSCAD AST to JavaScript
 *
 * @param ast - Parsed OpenSCAD AST
 * @param options - Transpile options including fileResolver for multi-file support
 * @param sharedCache - Optional shared cache for recursive transpilation (TranspiledFile objects)
 * @param sharedParsedFiles - Optional shared AST cache for recursive transpilation (avoids re-parsing)
 */
export function transpile(
  ast: ScadFile,
  options: TranspileOptions = {},
  sharedCache?: Map<string, TranspiledFile>,
  sharedParsedFiles?: Map<string, ScadFile>
): TranspileResult {
  const ctx = createContext(options, sharedCache, sharedParsedFiles)

  // Mark current file as processing (for cycle detection)
  if (ctx.options.currentFile) {
    ctx.processingFiles.add(ctx.options.currentFile)
  }

  // First pass: collect module/function names and use statements
  for (const stmt of ast.statements) {
    collectDeclarations(stmt, ctx)
  }

  // Local definitions are tracked in SymbolTable - no need to maintain a separate Set

  // Pre-pass: collect all function/module signatures from include files recursively
  collectSignaturesFromIncludes(ctx)

  // Process use statements: transpile dependencies and discover exports
  processUseStatements(ctx)

  // Process include statements: transpile dependencies and bundle content
  const bundled = processIncludeStatements(ctx)

  // Second pass: transpile statements into separate categories
  const transpiled = transpileAllStatements(ast, ctx)

  // Check if we need safeUnion for file-scope geometry
  if (transpiled.geometryParts.length > 1) {
    ctx.codeGen.usedHelpers.add('safeUnion')
  }

  // Build the output code
  const { code, allExports } = buildOutputCode(ctx, bundled, transpiled)

  // Create bundled parts for caching
  // Create bundled parts using AST-based bundling
  // allDeclarations includes local + transitive includes (for recursive bundling)
  const { bundledParts, allDeclarations, optimizationInfo } = createBundledParts(ctx)

  // Add this file to the cache if it has a name
  if (ctx.options.currentFile) {
    // Build param lists from SymbolTable.
    // Use getAllWithParams() (not just getByKind()) so that symbols only
    // registered via registerParams() (e.g. transitive use imports) are also
    // propagated to callers — without this, named-arg reordering breaks for
    // modules that arrive via include->use->include chains.
    const moduleParamLists = new Map<string, string[]>()
    for (const name of ctx.symbols.getAllWithParams('module')) {
      const params = ctx.symbols.getParams(name, 'module')
      if (params) moduleParamLists.set(name, params)
    }
    const functionParamLists = new Map<string, string[]>()
    for (const name of ctx.symbols.getAllWithParams('function')) {
      const params = ctx.symbols.getParams(name, 'function')
      if (params) functionParamLists.set(name, params)
    }

    ctx.transpiledFiles.set(ctx.options.currentFile, {
      code,
      exports: allExports.filter((e: string) => e !== 'main'),
      functionExports: ctx.symbols.getByKind('function')
        .filter(name => ctx.symbols.isFromSource(name, 'local', 'function') && name !== 'main'),
      moduleExports: ctx.symbols.getByKind('module')
        .filter(name => ctx.symbols.isFromSource(name, 'local') && name !== 'main'),
      paramLists: moduleParamLists,
      functionParamLists: functionParamLists,
      dualDefinedNames: new Set(ctx.symbols.getDualDefined()),
      bundledParts,
      // Store allDeclarations (local + transitive from includes) so that grandparent files
      // can recursively collect the full include chain in createBundledParts
      declarations: allDeclarations,
      // Store optimization flags for include statement handling
      canOptimizeInclude: optimizationInfo.canOptimizeInclude,
      hasTopLevelGeometry: optimizationInfo.hasTopLevelGeometry,
      hasVariables: optimizationInfo.hasVariables,
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

  // Process all include imports
  for (const includeImport of ctx.includeImports) {
    // Read and parse the file (caching the AST for later use)
    const resolved = fileResolver(includeImport.filename, ctx.options.currentFile)
    if (!resolved) {
      ctx.errors.push({
        code: ErrorCode.FILE_NOT_FOUND,
        message: `Cannot resolve include file: ${includeImport.filename}`,
        file: ctx.options.currentFile,
      })
      continue
    }

    const resolvedPath = resolved.path
    if (visitedFiles.has(resolvedPath)) continue
    visitedFiles.add(resolvedPath)

    // Fast-path: if this file is already fully transpiled (in workerSharedCache / transpiledFiles),
    // extract its symbols from the cached paramLists instead of re-fetching and re-parsing
    // all of its includes. This prevents the need to resolve transitive dependencies (like
    // math.scad, geometry.scad, etc. from std.scad) when they're already known.
    const cachedFile = ctx.transpiledFiles.get(resolvedPath)
    if (cachedFile && cachedFile.paramLists) {
      for (const [name, params] of cachedFile.paramLists) {
        ctx.symbols.define(name, { kind: 'module', source: 'included', params })
      }
      if (cachedFile.functionParamLists) {
        for (const [name, params] of cachedFile.functionParamLists) {
          ctx.symbols.define(name, { kind: 'function', source: 'included', params })
        }
      }
      continue  // skip re-fetching and re-traversing all transitive includes
    }

    // Check AST cache before parsing (shared across recursive transpile calls)
    let ast = ctx.parsedFiles.get(resolvedPath)
    if (!ast) {
      const { ast: parsedAst, errors } = parse(resolved.content)
      if (errors.length > 0) {
        ctx.errors.push({
          code: ErrorCode.PARSE_ERROR,
          message: `Parse error in include file: ${includeImport.filename}`,
          file: ctx.options.currentFile,
        })
        continue
      }
      ast = parsedAst
      // Cache the parsed AST so processDependency and sibling transpile calls can reuse it
      ctx.parsedFiles.set(resolvedPath, ast)
    }

    // Collect signatures from this file
    for (const stmt of ast.statements) {
      if (isModuleDeclaration(stmt)) {
        const name = safeIdentifier(stmt.name)
        // Deduplicate params to match how transpileParamsList handles the definition
        const params = deduplicateParamNames(stmt.definitionArgs || [])
        // SymbolTable tracks included symbols via source field
        ctx.symbols.define(name, { kind: 'module', source: 'included', params })
      } else if (isFunctionDeclaration(stmt)) {
        const name = safeIdentifier(stmt.name)
        // Deduplicate params to match how transpileParamsList handles the definition
        const params = deduplicateParamNames(stmt.definitionArgs || [])
        // SymbolTable tracks included symbols via source field
        ctx.symbols.define(name, { kind: 'function', source: 'included', params })
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
    // nestedCtx is a shallow copy of ctx, so nestedCtx.symbols === ctx.symbols.
    // All define() calls in the recursive pass land directly in ctx.symbols — no merge needed.
    collectSignaturesFromIncludes(nestedCtx, visitedFiles)
  }
}


/**
 * First pass: collect declarations
 */
function collectDeclarations(stmt: Statement, ctx: TranspileContext): void {
  if (isModuleDeclaration(stmt)) {
    const name = safeIdentifier(stmt.name)
    // Deduplicate params to match how transpileParamsList handles the definition
    const params = deduplicateParamNames(stmt.definitionArgs || [])
    // SymbolTable is the single source of truth for symbols and params
    ctx.symbols.define(name, { kind: 'module', source: 'local', params })
  } else if (isFunctionDeclaration(stmt)) {
    const name = safeIdentifier(stmt.name)
    // Deduplicate params to match how transpileParamsList handles the definition
    const params = deduplicateParamNames(stmt.definitionArgs || [])
    // SymbolTable is the single source of truth for symbols and params
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
    // All $-prefixed variables use setSpecialVar and don't exist as JS variables
    if (!stmt.name.startsWith('$')) {
      const safeName = safeIdentifier(stmt.name)
      ctx.variableNames.push(safeName)
      // Note: Declaration tracking happens during main transpilation when code is generated
    }
  }
}
