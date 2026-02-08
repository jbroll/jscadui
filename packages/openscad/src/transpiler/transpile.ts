/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OpenSCAD to JavaScript Transpiler
 *
 * Converts OpenSCAD AST directly to JavaScript code with module exports.
 * Uses late binding for module calls - modules are emitted as JavaScript functions
 * that call each other at runtime.
 *
 * Features:
 * - Module definitions become exported JavaScript functions
 * - `use <file.scad>` becomes destructured require: `const { Mod } = require('./file.js')`
 * - Module calls are direct: `Mod(args)` - natural for both OpenSCAD and JS users
 * - Parameters are preserved as function parameters with defaults
 * - Helper functions bridge OpenSCAD and JSCAD semantics (centering, colors, etc.)
 */

import type { ScadFile, Statement, Expression } from 'openscad-parser'
import { parse } from '../parser/parse.js'

// JavaScript reserved words that need to be renamed
const JS_RESERVED = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new',
  'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'class', 'const', 'enum', 'export', 'extends', 'import', 'super',
  'implements', 'interface', 'let', 'package', 'private', 'protected', 'public',
  'static', 'yield', 'await', 'async', 'null', 'true', 'false', 'undefined', 'NaN', 'Infinity'
])

/**
 * Ensure an identifier is safe for JavaScript
 * Renames reserved words by prefixing with underscore
 */
function safeIdentifier(name: string): string {
  return JS_RESERVED.has(name) ? `_${name}` : name
}

/**
 * File resolver for use statements
 * Returns the file content, or undefined if not found
 */
export type FileResolver = (filename: string, fromFile?: string) => string | undefined

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
}

export interface TranspiledFile {
  code: string
  exports: string[]
  functionExports: string[]  // Functions (not modules) - can be called directly
  paramLists: Map<string, string[]>  // Module/function name -> parameter names
}

export interface UseImport {
  filename: string
  resolvedPath: string  // Full path from root (for require statements)
  symbols: string[]  // Symbols imported from this file
}

interface TranspileContext {
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
}

const defaultOptions = {
  includeHeader: true,
  format: true,
  indent: '  ',
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
  const opts = { ...defaultOptions, ...options }
  const ctx: TranspileContext = {
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
    indentLevel: 0,
    transpiledFiles: sharedCache || new Map(),
    processingFiles: new Set(),
    inheritedSpecialVars: {},
    letCounter: 1,
  }

  // Mark current file as processing (for cycle detection)
  if (opts.currentFile) {
    ctx.processingFiles.add(opts.currentFile)
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
  const currentFileDir = ctx.options.currentFile
    ? ctx.options.currentFile.replace(/[^/\\]*$/, '')  // Get directory part
    : ''

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
  const topLevelAssignments: { name: string, value: any }[] = []

  // Track which names have both module and function versions
  // In OpenSCAD, you can have both `module foo()` and `function foo()` with the same name
  // In JavaScript, we can only have one - prefer the function version since it's more flexible
  const functionNameSet = new Set(ctx.functionNames)

  for (const stmt of ast.statements) {
    const stmtType = stmt.constructor.name

    if (stmtType === 'ModuleDeclarationStmt') {
      const moduleName = safeIdentifier((stmt as any).name)
      // Skip module if a function with the same name exists
      if (functionNameSet.has(moduleName)) {
        // Module with same name as function - skip (function version will be used)
        continue
      }
      bodyParts.push(transpileModuleDeclaration(stmt as any, ctx))
    } else if (stmtType === 'FunctionDeclarationStmt') {
      bodyParts.push(transpileFunctionDeclaration(stmt as any, ctx))
    } else if (stmtType === 'UseStmt' || stmtType === 'IncludeStmt') {
      // Already collected in first pass
    } else if (stmtType === 'AssignmentNode') {
      // Top-level variable assignment
      const s = stmt as any
      topLevelAssignments.push({ name: s.name, value: s.value })
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
      assignmentLines.push(`const ${safeIdentifier(a.name)} = ${transpileExpression(a.value, ctx)}`)
    }
  }

  // Build the output
  const parts: string[] = []

  // Header with JSCAD imports (now includes helpers used by assignments)
  if (opts.includeHeader) {
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
  if (opts.currentFile) {
    ctx.transpiledFiles.set(opts.currentFile, {
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
  const currentFileDir = ctx.options.currentFile
    ? ctx.options.currentFile.replace(/[^/\\]*$/, '')  // Get directory part
    : ''
  const resolvedFilename = currentFileDir + filename

  // Check cache first (using resolved path)
  const cached = ctx.transpiledFiles.get(resolvedFilename)
  if (cached) {
    return cached.exports
  }

  // Detect cycles (using resolved path)
  if (ctx.processingFiles.has(resolvedFilename)) {
    // Circular dependency - return empty (file is being processed)
    return []
  }

  // Resolve and read the file
  const source = fileResolver(filename, ctx.options.currentFile)
  if (!source) {
    return []
  }

  // Parse the file
  const { ast, errors } = parse(source)
  if (errors.length > 0) {
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
  const stmtType = stmt.constructor.name

  if (stmtType === 'ModuleDeclarationStmt') {
    const name = safeIdentifier((stmt as any).name)
    ctx.moduleNames.push(name)
    // Capture parameter names for named argument reordering
    const params = ((stmt as any).definitionArgs || []).map((a: any) => a.name)
    ctx.moduleParamLists.set(name, params)
  } else if (stmtType === 'FunctionDeclarationStmt') {
    const name = safeIdentifier((stmt as any).name)
    ctx.functionNames.push(name)
    // Capture parameter names for named argument reordering
    const params = ((stmt as any).definitionArgs || []).map((a: any) => a.name)
    ctx.moduleParamLists.set(name, params)
  } else if (stmtType === 'UseStmt') {
    ctx.useImports.push({
      filename: (stmt as any).filename,
      resolvedPath: '',  // Will be computed during processing
      symbols: [],
    })
  } else if (stmtType === 'IncludeStmt') {
    // Include imports everything including variables/constants
    ctx.includeImports.push({
      filename: (stmt as any).filename,
      resolvedPath: '',  // Will be computed during processing
      symbols: [],
    })
  } else if (stmtType === 'AssignmentNode') {
    // Track top-level variable assignments for export
    ctx.variableNames.push(safeIdentifier((stmt as any).name))
  }
}

/**
 * Extract nested modules, assignments, and geometry statements from a module body
 */
function extractModuleBody(stmt: Statement, _ctx: TranspileContext): {
  nestedModules: any[],
  nestedFunctions: any[],
  assignments: { name: string, value: any }[],
  geometryStmts: Statement[]
} {
  const nestedModules: any[] = []
  const nestedFunctions: any[] = []
  const assignments: { name: string, value: any }[] = []
  const geometryStmts: Statement[] = []

  if (!stmt) {
    return { nestedModules, nestedFunctions, assignments, geometryStmts }
  }

  const stmtType = stmt.constructor.name

  if (stmtType === 'BlockStmt') {
    const block = stmt as any

    for (const child of block.children) {
      const childType = child.constructor.name
      if (childType === 'ModuleDeclarationStmt') {
        nestedModules.push(child)
      } else if (childType === 'FunctionDeclarationStmt') {
        nestedFunctions.push(child)
      } else if (childType === 'AssignmentNode') {
        assignments.push({ name: child.name, value: child.value })
      } else if (childType !== 'NoopStmt') {
        geometryStmts.push(child)
      }
    }
  } else if (stmtType === 'AssignmentNode') {
    const s = stmt as any
    assignments.push({ name: s.name, value: s.value })
  } else if (stmtType !== 'NoopStmt') {
    geometryStmts.push(stmt)
  }

  return { nestedModules, nestedFunctions, assignments, geometryStmts }
}

/**
 * Recursively build the body of a module function, handling nested modules at any depth
 * @param paramNames - Set of parameter names from the parent function (to detect shadowing)
 */
function buildModuleBody(moduleStmt: any, ctx: TranspileContext, indent: string = '  ', paramNames: Set<string> = new Set()): string[] {
  const { nestedModules, nestedFunctions, assignments, geometryStmts } = extractModuleBody(moduleStmt, ctx)
  const bodyParts: string[] = []
  // Track declared variables to detect reassignments
  const declaredVars = new Set<string>(paramNames)

  // Process nested function definitions (these must come first so they can be used)
  for (const f of nestedFunctions) {
    const funcParams = transpileParamsList(f.definitionArgs, ctx)
    const funcBody = transpileExpression(f.expr, ctx)
    bodyParts.push(`${indent}const ${f.name} = (${funcParams}) => ${funcBody}`)
    declaredVars.add(f.name)
  }

  // Recursively process nested module definitions
  for (const m of nestedModules) {
    const nestedParams = transpileParamsList(m.definitionArgs, ctx)
    const nestedParamNames = new Set<string>((m.definitionArgs || []).map((a: any) => a.name))
    const nestedBodyParts = buildModuleBody(m.stmt, ctx, indent + '  ', nestedParamNames)
    // Curried: (params) => (_children) => body
    bodyParts.push(`${indent}const ${m.name} = (${nestedParams}) => (_children = []) => {\n${nestedBodyParts.join('\n')}\n${indent}}`)
    declaredVars.add(m.name)
  }

  // Local variable assignments
  // If a variable shadows a parameter or previous declaration, don't use 'const'
  // This handles OpenSCAD's pattern of reassigning parameters: cp = is_scalar(cp) ? ... : cp
  for (const a of assignments) {
    if (declaredVars.has(a.name)) {
      // Reassignment - don't use const
      bodyParts.push(`${indent}${a.name} = ${transpileExpression(a.value, ctx)}`)
    } else {
      // New variable - use const and track it
      bodyParts.push(`${indent}const ${a.name} = ${transpileExpression(a.value, ctx)}`)
      declaredVars.add(a.name)
    }
  }

  // Geometry expression (return statement)
  const geomParts = geometryStmts.map(g => transpileStatement(g, ctx)).filter(Boolean) as string[]
  const returnExpr = geomParts.length === 0 ? 'undefined' :
    geomParts.length === 1 ? geomParts[0] :
    `union(\n${indent}  ${geomParts.join(',\n' + indent + '  ')}\n${indent})`
  if (geomParts.length > 1) ctx.usedBooleans.add('union')

  bodyParts.push(`${indent}return ${returnExpr}`)

  return bodyParts
}

/**
 * Transpile a module declaration to JavaScript function
 * Uses curried function: outer takes OpenSCAD params, inner takes children
 * This allows calling with defaults while still passing children:
 *   module(arg1, arg2)([child1, child2])  - explicit args
 *   module()([child1, child2])            - default args
 */
function transpileModuleDeclaration(stmt: any, ctx: TranspileContext): string {
  const name = safeIdentifier(stmt.name)
  const params = transpileParamsList(stmt.definitionArgs, ctx)
  // Extract parameter names to detect shadowing assignments
  const paramNames = new Set<string>((stmt.definitionArgs || []).map((a: any) => a.name))
  const bodyParts = buildModuleBody(stmt.stmt, ctx, '  ', paramNames)

  // Curried: (params) => (_children) => body
  return `const ${name} = (${params}) => (_children = []) => {\n${bodyParts.join('\n')}\n}`
}

/**
 * Transpile a function declaration
 */
function transpileFunctionDeclaration(stmt: any, ctx: TranspileContext): string {
  const name = safeIdentifier(stmt.name)
  const params = transpileParamsList(stmt.definitionArgs, ctx)
  const body = transpileExpression(stmt.expr, ctx)

  return `const ${name} = (${params}) => ${body}`
}

/**
 * Transpile parameter list with defaults - regular function style
 */
function transpileParamsList(args: any[], ctx: TranspileContext): string {
  if (args.length === 0) return ''

  const params = args.map((arg: any) => {
    const name = arg.name
    if (arg.value) {
      const defaultVal = transpileExpression(arg.value, ctx)
      return `${name} = ${defaultVal}`
    }
    return name
  })

  return params.join(', ')
}

/**
 * Transpile a statement
 */
function transpileStatement(stmt: Statement, ctx: TranspileContext): string | null {
  const stmtType = stmt.constructor.name

  switch (stmtType) {
    case 'ModuleInstantiationStmt':
      return transpileModuleInstantiation(stmt as any, ctx)

    case 'BlockStmt': {
      const block = stmt as any
      // Extract assignments and geometry from the block
      const assignments: { name: string, value: any }[] = []
      const geometryStmts: Statement[] = []

      for (const child of block.children) {
        const childType = child.constructor.name
        if (childType === 'AssignmentNode') {
          assignments.push({ name: child.name, value: child.value })
        } else if (childType !== 'NoopStmt') {
          geometryStmts.push(child)
        }
      }

      // Transpile geometry statements first
      let parts = geometryStmts.map(c => transpileStatement(c, ctx)).filter(Boolean) as string[]
      if (parts.length === 0 && assignments.length === 0) return null

      // If there are assignments, we need to create an IIFE to scope them
      // Use suffixed names to avoid temporal dead zone when shadowing parameters
      if (assignments.length > 0) {
        const suffix = `$${ctx.letCounter++}`
        const nameMap = new Map<string, string>()
        const assignStrs: string[] = []

        for (const a of assignments) {
          const origName = safeIdentifier(a.name)
          const newName = `${origName}${suffix}`
          nameMap.set(origName, newName)
          // Transpile value - references to outer scope will work correctly
          let value = transpileExpression(a.value, ctx)
          // Replace references to previously defined assignments in this block
          // Use lookahead/lookbehind that works with $-prefixed variables
          for (const [orig, renamed] of nameMap) {
            if (orig !== origName) {
              // Escape $ for regex and use boundaries that work for special vars
              const escaped = orig.replace(/\$/g, '\\$')
              value = value.replace(new RegExp(`(?<![a-zA-Z0-9_$])${escaped}(?![a-zA-Z0-9_])`, 'g'), renamed)
            }
          }
          assignStrs.push(`const ${newName} = ${value}`)
        }

        // Update references in geometry parts
        // Use lookahead/lookbehind that works with $-prefixed variables
        for (const [orig, renamed] of nameMap) {
          const escaped = orig.replace(/\$/g, '\\$')
          parts = parts.map(p => p.replace(new RegExp(`(?<![a-zA-Z0-9_$])${escaped}(?![a-zA-Z0-9_])`, 'g'), renamed))
        }

        if (parts.length === 0) {
          return `(() => { ${assignStrs.join('; ')}; return undefined })()`
        }
        if (parts.length === 1) {
          return `(() => { ${assignStrs.join('; ')}; return ${parts[0]} })()`
        }
        ctx.usedBooleans.add('union')
        ctx.usedHelpers.add('safeUnion')
        return `(() => { ${assignStrs.join('; ')}; return _safeUnion([\n    ${parts.join(',\n    ')}\n  ]) })()`
      }

      if (parts.length === 1) return parts[0]
      ctx.usedBooleans.add('union')
      ctx.usedHelpers.add('safeUnion')
      return `_safeUnion([\n${parts.map(p => `  ${p}`).join(',\n')}\n])`
    }

    case 'IfElseStatement': {
      const s = stmt as any
      const cond = transpileExpression(s.cond, ctx)
      const thenPart = transpileStatement(s.thenBranch, ctx) || 'undefined'
      const elsePart = s.elseBranch ? transpileStatement(s.elseBranch, ctx) : 'undefined'
      return `(${cond}) ? (${thenPart}) : (${elsePart})`
    }

    case 'NoopStmt':
      return null

    default:
      return `/* unsupported statement: ${stmtType} */`
  }
}

/**
 * Collect children as an array of transpiled expressions
 * Used for passing children to user-defined modules
 */
function collectChildrenAsArray(child: Statement | null, ctx: TranspileContext): string[] {
  if (!child) return []

  const childType = child.constructor.name

  if (childType === 'BlockStmt') {
    const children = (child as any).children as Statement[]
    const result: string[] = []
    for (const c of children) {
      const cType = c.constructor.name
      if (cType !== 'NoopStmt' && cType !== 'AssignmentNode') {
        const code = transpileStatement(c, ctx)
        if (code) result.push(code)
      }
    }
    return result
  }

  const code = transpileStatement(child, ctx)
  return code ? [code] : []
}

/**
 * Transpile a module instantiation (e.g., cube(10), translate([1,2,3]) child)
 */
function transpileModuleInstantiation(stmt: any, ctx: TranspileContext): string {
  const name = stmt.name

  // Special handling for 'for' loops (parsed as ModuleInstantiationStmt)
  if (name === 'for') {
    return transpileForLoop(stmt, ctx)
  }

  // echo() for debugging - outputs to console but returns undefined (no geometry)
  if (name === 'echo') {
    const args = stmt.args.map((a: any) => transpileExpression(a.value, ctx)).join(', ')
    return `(console.log(${args}), undefined)`
  }

  const argsArray = transpileArgsArray(stmt.args, ctx)

  // Extract special vars from args - OpenSCAD's $fn, $fa, $fs are dynamically scoped
  // and inherited by all children, regardless of which module they're attached to
  const savedSpecialVars = ctx.inheritedSpecialVars
  const newSpecialVars = { ...ctx.inheritedSpecialVars }
  let hasSpecialVars = false
  for (const arg of argsArray) {
    if (arg.name === '$fn') { newSpecialVars.$fn = arg.value; hasSpecialVars = true }
    if (arg.name === '$fa') { newSpecialVars.$fa = arg.value; hasSpecialVars = true }
    if (arg.name === '$fs') { newSpecialVars.$fs = arg.value; hasSpecialVars = true }
  }
  if (hasSpecialVars) {
    ctx.inheritedSpecialVars = newSpecialVars
  }

  // Handle children (now with inherited special vars in context)
  let childCode: string | null = null
  if (stmt.child) {
    childCode = transpileStatement(stmt.child, ctx)
  }

  // Restore special vars after processing children
  ctx.inheritedSpecialVars = savedSpecialVars

  // Check if it's a built-in primitive/transform/boolean
  if (isBuiltinPrimitive(name)) {
    return transpileBuiltinPrimitive(name, argsArray, ctx)
  }

  if (isBuiltinTransform(name)) {
    return transpileBuiltinTransform(name, argsArray, childCode, ctx)
  }

  if (isBuiltinBoolean(name)) {
    // Boolean ops need children passed directly, not as union
    return transpileBuiltinBoolean(name, stmt.child, ctx)
  }

  if (isBuiltinExtrusion(name)) {
    return transpileBuiltinExtrusion(name, argsArray, childCode, ctx)
  }

  // Special modules
  if (name === 'color') {
    ctx.usedColors = true
    // color takes (colorName, alpha?) or ([r,g,b], alpha?)
    // When only 1 arg to color, alpha is undefined
    const colorValue = argsArray[0]?.value || '"gray"'
    const alphaValue = argsArray[1]?.value || 'undefined'
    return `_color(${colorValue}, ${alphaValue}, ${childCode || 'undefined'})`
  }

  if (name === 'hull') {
    // Hull needs children passed as separate args, not wrapped in union
    return transpileBuiltinHull(stmt.child, ctx)
  }

  // children() - access children passed to this module
  if (name === 'children') {
    // children() with no args returns all children as union
    // children(n) returns the nth child
    // children([indices...]) returns union of specified children
    if (argsArray.length === 0) {
      // All children: union of _children array
      ctx.usedBooleans.add('union')
      return `(_children.length === 0 ? undefined : _children.length === 1 ? _children[0] : union(..._children))`
    } else {
      // Indexed access - check if argument is a vector (array of indices) or simple index
      const arg = stmt.args[0]
      const argType = arg.value.constructor.name

      if (argType === 'VectorExpr') {
        // Array of indices: children([0, 2, 3]) → union children at those indices
        const indices = (arg.value as any).children.map((c: any) => transpileExpression(c, ctx))
        ctx.usedBooleans.add('union')
        return `union(${indices.map((i: string) => `_children[${i}]`).join(', ')})`
      } else {
        // Simple index: children(0) or children(i) → single child access
        const indexExpr = argsArray[0].value
        return `_children[${indexExpr}]`
      }
    }
  }

  // User-defined module/function - direct call (late binding)
  // Symbol is available if it's local or imported via use
  // Curried pattern: module(args)(children)

  // Reorder named arguments to match parameter definition order
  const positionalArgs = reorderNamedArgs(name, argsArray, ctx)

  // Just emit a direct call - the symbol should be available from:
  // - Local module/function definitions
  // - Destructured imports from use statements

  // If there are children, collect them as an array and pass via curried call
  if (childCode && childCode !== 'undefined') {
    const childrenArray = collectChildrenAsArray(stmt.child, ctx)
    if (childrenArray.length > 0) {
      const childrenArg = `[${childrenArray.join(', ')}]`
      // Curried call: module(args)(children)
      return `${name}(${positionalArgs})(${childrenArg})`
    }
  }

  // Determine if this is a function call vs module instantiation
  // Functions: called directly, return values
  // Modules: curried pattern, module(args)(children) returns geometry
  //
  // We know it's a function if:
  // - It's in our local functionNames list (and not overridden by a module)
  // - It's in our importedFunctions set (tracked from dependency's functionExports)
  const isLocalFunction = ctx.functionNames.includes(name)
  const isLocalModule = ctx.moduleNames.includes(name)
  const isImportedFunction = ctx.importedFunctions.has(name)

  if (isLocalFunction && !isLocalModule) {
    // Pure local function call - no currying
    return `${name}(${positionalArgs})`
  }

  if (isImportedFunction) {
    // Imported function - no currying needed
    return `${name}(${positionalArgs})`
  }

  // Module call with no children: use curried pattern with empty array
  return `${name}(${positionalArgs})()`
}

/**
 * Transpile arguments list - returns array of {name, value} pairs
 */
function transpileArgsArray(args: any[], ctx: TranspileContext): Array<{name: string | null, value: string}> {
  return args.map((arg: any) => ({
    name: arg.name || null,
    value: transpileExpression(arg.value, ctx)
  }))
}

/**
 * Transpile arguments to object literal format: { name: value, ... }
 * For positional args with no names, just uses the values
 */
function transpileArgsToObject(args: Array<{name: string | null, value: string}>): string {
  if (args.length === 0) return ''

  const parts = args.map(arg => {
    if (arg.name) {
      return `${arg.name}: ${arg.value}`
    }
    return arg.value
  })

  return parts.join(', ')
}

/**
 * Check if an expression contains LcIfExpr (used to determine if filtering is needed)
 */
function containsIfExpr(expr: any): boolean {
  if (!expr) return false
  const exprType = expr.constructor?.name
  if (exprType === 'LcIfExpr') return true
  // Check nested expr in LcLetExpr
  if (exprType === 'LcLetExpr' && expr.expr) return containsIfExpr(expr.expr)
  return false
}


/**
 * Transpile an expression
 */
function transpileExpression(expr: Expression, ctx: TranspileContext): string {
  const exprType = expr.constructor.name

  switch (exprType) {
    case 'LiteralExpr':
      return transpileLiteral((expr as any).value)

    case 'LookupExpr': {
      const name = (expr as any).name
      // Handle special variables
      if (name === '$preview') return 'false'  // Always render as full quality
      if (name === '$t') return '0'  // Animation time defaults to 0
      if (name === '$children') return '_children.length'  // Number of children passed to module
      // Ensure the identifier is safe for JavaScript
      return safeIdentifier(name)
    }

    case 'VectorExpr': {
      const children = (expr as any).children as Expression[]
      // List comprehension: [for (i = range) expr] has single LcForExpr child
      // LcForExpr already returns an array via .map(), so don't double-wrap
      if (children.length === 1 && children[0].constructor.name === 'LcForExpr') {
        return transpileExpression(children[0], ctx)
      }
      return `[${children.map(c => transpileExpression(c, ctx)).join(', ')}]`
    }

    case 'BinaryOpExpr': {
      const e = expr as any
      const left = transpileExpression(e.left, ctx)
      const right = transpileExpression(e.right, ctx)
      // Handle equality operators specially - need deep comparison for arrays
      if (e.operation === 23) { // EqualEqual
        ctx.usedHelpers.add('eq')
        return `_eq(${left}, ${right})`
      }
      if (e.operation === 25) { // BangEqual
        ctx.usedHelpers.add('eq')
        return `!_eq(${left}, ${right})`
      }
      // Handle arithmetic operators with vector support
      if (e.operation === 28) { // Plus - vector addition
        ctx.usedHelpers.add('vadd')
        return `_vadd(${left}, ${right})`
      }
      if (e.operation === 29) { // Minus - vector subtraction
        ctx.usedHelpers.add('vsub')
        return `_vsub(${left}, ${right})`
      }
      if (e.operation === 30) { // Star - vector/scalar multiplication
        ctx.usedHelpers.add('vmul')
        return `_vmul(${left}, ${right})`
      }
      if (e.operation === 31) { // Slash - vector/scalar division
        ctx.usedHelpers.add('vdiv')
        return `_vdiv(${left}, ${right})`
      }
      const op = transpileBinaryOp(e.operation)
      return `(${left} ${op} ${right})`
    }

    case 'UnaryOpExpr': {
      const e = expr as any
      const right = transpileExpression(e.right, ctx)
      const op = transpileUnaryOp(e.operation)
      // Unary minus on vectors needs special handling (negate each element)
      // But for literal numbers, we can use regular negation
      const rightType = e.right?.constructor?.name
      if (op === '-' && rightType !== 'LiteralExpr') {
        ctx.usedHelpers.add('vneg')
        return `_vneg(${right})`
      }
      return `${op}${right}`
    }

    case 'TernaryExpr': {
      const e = expr as any
      const cond = transpileExpression(e.cond, ctx)
      const ifExpr = transpileExpression(e.ifExpr, ctx)
      const elseExpr = transpileExpression(e.elseExpr, ctx)
      return `(${cond} ? ${ifExpr} : ${elseExpr})`
    }

    case 'ArrayLookupExpr': {
      const e = expr as any
      const array = transpileExpression(e.array, ctx)
      const index = transpileExpression(e.index, ctx)
      return `${array}[${index}]`
    }

    case 'FunctionCallExpr': {
      const e = expr as any
      const callee = transpileExpression(e.callee, ctx)
      const args = e.args.map((a: any) => transpileExpression(a.value, ctx)).join(', ')
      return transpileFunctionCall(callee, args, ctx)
    }

    case 'RangeExpr': {
      const e = expr as any
      const begin = transpileExpression(e.begin, ctx)
      const end = transpileExpression(e.end, ctx)
      const step = e.step ? transpileExpression(e.step, ctx) : '1'
      return `_range(${begin}, ${end}, ${step})`
    }

    case 'GroupingExpr':
      return `(${transpileExpression((expr as any).inner, ctx)})`

    case 'MemberLookupExpr': {
      const e = expr as any
      const obj = transpileExpression(e.expr, ctx)
      // OpenSCAD vector accessor notation: v.x, v.y, v.z -> v[0], v[1], v[2]
      const member = e.member
      if (member === 'x') return `${obj}[0]`
      if (member === 'y') return `${obj}[1]`
      if (member === 'z') return `${obj}[2]`
      return `${obj}.${member}`
    }

    case 'LcForExpr': {
      // List comprehension: [for (i = [0:10]) i * 2]
      const e = expr as any
      const args = e.args as any[]
      const innerExpr = transpileExpression(e.expr, ctx)

      // Check if inner expression contains LcIfExpr (needs filtering)
      const needsFilter = containsIfExpr(e.expr)

      if (args.length === 1) {
        const varName = args[0].name
        const range = transpileExpression(args[0].value, ctx)
        const mapExpr = `${range}.map(${varName} => ${innerExpr})`
        return needsFilter ? `${mapExpr}.filter(x => x !== undefined)` : mapExpr
      }
      // Multiple loop variables: for (i = [0:3], j = [0:2]) becomes nested flatMap/map
      // Each outer loop uses flatMap to flatten the nested arrays, innermost uses map
      let result = innerExpr
      for (let i = args.length - 1; i >= 0; i--) {
        const varName = args[i].name
        const range = transpileExpression(args[i].value, ctx)
        const method = i === 0 ? 'flatMap' : (i === args.length - 1 ? 'map' : 'flatMap')
        result = `${range}.${method}(${varName} => ${result})`
      }
      return needsFilter ? `${result}.filter(x => x !== undefined)` : result
    }

    case 'LcIfExpr': {
      // Conditional in list comprehension: [for (i = range) if (cond) expr]
      // Returns undefined when condition is false, to be filtered out by LcForExpr
      const e = expr as any
      const cond = transpileExpression(e.cond, ctx)
      const body = transpileExpression(e.ifExpr, ctx)
      // If there's an else branch, use it; otherwise return undefined
      if (e.elseExpr) {
        const elsePart = transpileExpression(e.elseExpr, ctx)
        return `(${cond} ? ${body} : ${elsePart})`
      }
      return `(${cond} ? ${body} : undefined)`
    }

    case 'LetExpr': {
      // let(x = 1, y = 2) expr -> (() => { const x$1 = 1; const y$1 = 2; return expr })()
      // Use unique suffix for bindings to avoid temporal dead zone when shadowing
      const e = expr as any
      const suffix = `$${ctx.letCounter || 1}`
      ctx.letCounter = (ctx.letCounter || 1) + 1

      // Build mapping from original names to suffixed names
      const nameMap = new Map<string, string>()
      const bindings: string[] = []

      for (const a of e.args as any[]) {
        const origName = safeIdentifier(a.name)
        const newName = `${origName}${suffix}`
        nameMap.set(origName, newName)
        // Transpile value (references to earlier bindings will be renamed by substituteNames)
        let value = transpileExpression(a.value, ctx)
        // Replace references to previously defined let bindings
        // Use lookahead/lookbehind that works with $-prefixed variables
        for (const [orig, renamed] of nameMap) {
          if (orig !== origName) {
            const escaped = orig.replace(/\$/g, '\\$')
            value = value.replace(new RegExp(`(?<![a-zA-Z0-9_$])${escaped}(?![a-zA-Z0-9_])`, 'g'), renamed)
          }
        }
        bindings.push(`const ${newName} = ${value}`)
      }

      // Transpile body and substitute all let binding names
      // Use lookahead/lookbehind that works with $-prefixed variables
      let body = transpileExpression(e.expr, ctx)
      for (const [orig, renamed] of nameMap) {
        const escaped = orig.replace(/\$/g, '\\$')
        body = body.replace(new RegExp(`(?<![a-zA-Z0-9_$])${escaped}(?![a-zA-Z0-9_])`, 'g'), renamed)
      }

      return `(() => { ${bindings.join('; ')}; return ${body} })()`
    }

    case 'LcLetExpr': {
      // let inside list comprehension: [for (i = range) let(x = i*2) x]
      // Transpile to a block that defines the bindings and returns the body
      const e = expr as any
      const bindings = (e.args as any[]).map((a: any) => {
        const name = safeIdentifier(a.name)
        const value = transpileExpression(a.value, ctx)
        return `const ${name} = ${value}`
      })
      const body = transpileExpression(e.expr, ctx)
      // This is used inside .map(), so we need to return a block
      return `{ ${bindings.join('; ')}; return ${body} }`
    }

    case 'EchoExpr': {
      // echo(x) expr -> logs x and returns expr (or x if no expr follows)
      // In JavaScript: (console.log(x), expr) or just (console.log(x), x)
      const e = expr as any
      const args = (e.args as any[]).map((a: any) => {
        if (a.name) {
          return `"${a.name}=", ${transpileExpression(a.value, ctx)}`
        }
        return transpileExpression(a.value, ctx)
      }).join(', ')
      const innerExpr = transpileExpression(e.expr, ctx)
      return `(console.log(${args}), ${innerExpr})`
    }

    case 'AssertExpr': {
      // assert(cond, msg) expr -> checks condition, returns expr (or undef if no expr)
      // In JavaScript: we use console.assert which doesn't throw, then return expr
      const e = expr as any
      const args = e.args as any[]
      const condition = args.length > 0 ? transpileExpression(args[0].value, ctx) : 'true'
      const message = args.length > 1 ? transpileExpression(args[1].value, ctx) : '"Assertion failed"'
      const innerExpr = transpileExpression(e.expr, ctx)
      return `(console.assert(${condition}, ${message}), ${innerExpr})`
    }

    default:
      return `/* unsupported expr: ${exprType} */`
  }
}

function transpileLiteral(value: any): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return 'undefined'
}

/**
 * Reorder named arguments to match the module/function parameter definition order.
 * This handles OpenSCAD's named parameter syntax: module(n=3, spacing=10)
 * which should map to spread(p1, p2, spacing, l, n) correctly.
 */
function reorderNamedArgs(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext
): string {
  // Get parameter list for this module/function
  const paramList = ctx.moduleParamLists.get(name)

  // If we don't have parameter info, or no named args, fall back to positional order
  const hasNamedArgs = argsArray.some(a => a.name !== null)
  if (!paramList || !hasNamedArgs) {
    return argsArray.map(a => a.value).join(', ')
  }

  // Build a map of named arguments
  const namedArgMap = new Map<string, string>()
  const positionalArgs: string[] = []
  let positionalIndex = 0

  for (const arg of argsArray) {
    if (arg.name) {
      namedArgMap.set(arg.name, arg.value)
    } else {
      // Track positional args by their index in the parameter list
      while (positionalIndex < paramList.length && namedArgMap.has(paramList[positionalIndex])) {
        positionalIndex++
      }
      if (positionalIndex < paramList.length) {
        namedArgMap.set(paramList[positionalIndex], arg.value)
        positionalIndex++
      } else {
        // Extra positional arg beyond param list
        positionalArgs.push(arg.value)
      }
    }
  }

  // Build reordered argument list
  const result: string[] = []
  for (const paramName of paramList) {
    if (namedArgMap.has(paramName)) {
      result.push(namedArgMap.get(paramName)!)
    } else {
      result.push('undefined')
    }
  }

  // Trim trailing undefined values
  while (result.length > 0 && result[result.length - 1] === 'undefined') {
    result.pop()
  }

  return result.join(', ')
}

function transpileBinaryOp(op: number): string {
  // TokenType enum numeric values
  // Note: 23 (EqualEqual) and 25 (BangEqual) are handled specially in transpileExpression
  // because they need deep comparison for arrays
  const opMap: Record<number, string> = {
    28: '+',   // Plus
    29: '-',   // Minus
    30: '*',   // Star
    31: '/',   // Slash
    32: '%',   // Percent
    19: '<',   // Less
    21: '<=',  // LessEqual
    20: '>',   // Greater
    22: '>=',  // GreaterEqual
    23: '===', // EqualEqual (but see special handling)
    25: '!==', // BangEqual (but see special handling)
    26: '&&',  // AND
    27: '||',  // OR
  }
  return opMap[op] || String(op)
}

function transpileUnaryOp(op: number): string {
  const opMap: Record<number, string> = {
    18: '!',  // Bang
    29: '-',  // Minus
    28: '+',  // Plus
  }
  return opMap[op] || String(op)
}

function transpileFunctionCall(callee: string, args: string, ctx: TranspileContext): string {
  // Built-in math functions that map directly to Math.*
  const mathFuncs: Record<string, string> = {
    abs: 'Math.abs',
    floor: 'Math.floor',
    ceil: 'Math.ceil',
    round: 'Math.round',
    sqrt: 'Math.sqrt',
    pow: 'Math.pow',
    exp: 'Math.exp',
    log: 'Math.log',
    ln: 'Math.log',
    // min/max handled specially below to support array arguments
    sign: 'Math.sign',
  }

  if (mathFuncs[callee]) {
    return `${mathFuncs[callee]}(${args})`
  }

  // min/max need special handling - in OpenSCAD, max([1,2,3]) returns 3
  // In JavaScript, Math.max([1,2,3]) returns NaN, need to spread array
  if (callee === 'min' || callee === 'max') {
    ctx.usedMinMax = true
    return `_${callee}(${args})`
  }

  // Trig functions - OpenSCAD uses degrees, JavaScript uses radians
  const toRad = 'Math.PI/180'
  const toDeg = '180/Math.PI'
  const trigFuncs: Record<string, string> = {
    sin: `Math.sin((${args})*${toRad})`,
    cos: `Math.cos((${args})*${toRad})`,
    tan: `Math.tan((${args})*${toRad})`,
    asin: `Math.asin(${args})*${toDeg}`,
    acos: `Math.acos(${args})*${toDeg}`,
    atan: `Math.atan(${args})*${toDeg}`,
    atan2: `Math.atan2(${args})*${toDeg}`,
  }

  if (trigFuncs[callee]) {
    return trigFuncs[callee]
  }

  // len() -> .length
  if (callee === 'len') {
    return `(${args}).length`
  }

  // is_undef() -> value === undefined
  if (callee === 'is_undef') {
    return `((${args}) === undefined)`
  }

  // is_def() -> value !== undefined  (BOSL compatibility)
  if (callee === 'is_def') {
    return `((${args}) !== undefined)`
  }

  // is_list() -> Array.isArray()
  if (callee === 'is_list') {
    return `Array.isArray(${args})`
  }

  // is_num() -> typeof === 'number'
  if (callee === 'is_num') {
    return `(typeof (${args}) === 'number' && !isNaN(${args}))`
  }

  // is_str() -> typeof === 'string'
  if (callee === 'is_str') {
    return `(typeof (${args}) === 'string')`
  }

  // is_bool() -> typeof === 'boolean'
  if (callee === 'is_bool') {
    return `(typeof (${args}) === 'boolean')`
  }

  // concat() -> [..., ...]
  if (callee === 'concat') {
    return `[].concat(${args})`
  }

  // Helper functions that need to be emitted
  const helperFuncs = ['norm', 'cross', 'lookup', 'rands']
  if (helperFuncs.includes(callee)) {
    ctx.usedHelpers.add(callee)
    return `_${callee}(${args})`
  }

  // echo() for debugging - map to console.log
  if (callee === 'echo') {
    return `console.log(${args})`
  }

  // User-defined function call
  return `${callee}(${args})`
}

// Built-in checks
function isBuiltinPrimitive(name: string): boolean {
  return ['cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle', 'polygon', 'regular_polygon'].includes(name)
}

function isBuiltinTransform(name: string): boolean {
  return ['translate', 'rotate', 'scale', 'mirror', 'multmatrix'].includes(name)
}

function isBuiltinBoolean(name: string): boolean {
  return ['union', 'difference', 'intersection', 'minkowski'].includes(name)
}

function isBuiltinExtrusion(name: string): boolean {
  return ['linear_extrude', 'rotate_extrude'].includes(name)
}

// Positional parameter names for built-in primitives
// Note: cylinder with 3 positional args is [h, r1, r2], not [h, r, r1]
const primitiveParams: Record<string, string[]> = {
  cube: ['size', 'center'],
  sphere: ['r', 'd'],
  cylinder: ['h', 'r1', 'r2'],  // when 3 positional: h, r1, r2
  square: ['size', 'center'],
  circle: ['r', 'd'],
  polygon: ['points', 'paths'],
  polyhedron: ['points', 'faces', 'convexity'],
  regular_polygon: ['order', 'r'],  // n-sided polygon with circumradius r
}

function transpileBuiltinPrimitive(name: string, argsArray: Array<{name: string | null, value: string}>, ctx: TranspileContext): string {
  // Map positional args to named args using parameter definitions
  const paramNames = primitiveParams[name] || []
  const namedArgs = argsArray.map((arg, i) => {
    if (arg.name) {
      return `${arg.name}: ${arg.value}`
    }
    // Use positional param name if available
    const paramName = paramNames[i]
    if (paramName) {
      return `${paramName}: ${arg.value}`
    }
    return arg.value
  })

  // For primitives that use segments, inject inherited special vars if not already set
  const usesSegments = ['sphere', 'cylinder', 'circle', 'regular_polygon'].includes(name)
  if (usesSegments) {
    const hasVar = (varName: string) => argsArray.some(a => a.name === varName)
    if (ctx.inheritedSpecialVars.$fn && !hasVar('$fn')) {
      namedArgs.push(`$fn: ${ctx.inheritedSpecialVars.$fn}`)
    }
    if (ctx.inheritedSpecialVars.$fa && !hasVar('$fa')) {
      namedArgs.push(`$fa: ${ctx.inheritedSpecialVars.$fa}`)
    }
    if (ctx.inheritedSpecialVars.$fs && !hasVar('$fs')) {
      namedArgs.push(`$fs: ${ctx.inheritedSpecialVars.$fs}`)
    }
  }

  const argsStr = namedArgs.join(', ')

  switch (name) {
    case 'cube':
      ctx.usedPrimitives.add('cube')
      ctx.usedPrimitives.add('cuboid')
      ctx.usedTransforms.add('translate')
      return `_cube({ ${argsStr} })`

    case 'sphere':
      ctx.usedPrimitives.add('sphere')
      ctx.usedPrimitives.add('polyhedron')  // _sphere uses polyhedron internally
      return `_sphere({ ${argsStr} })`

    case 'cylinder':
      ctx.usedPrimitives.add('cylinder')
      ctx.usedTransforms.add('translate')
      return `_cylinder({ ${argsStr} })`

    case 'square':
      ctx.usedPrimitives.add('rectangle')
      ctx.usedTransforms.add('translate')
      return `_square({ ${argsStr} })`

    case 'circle':
      ctx.usedPrimitives.add('circle')
      return `_circle({ ${argsStr} })`

    case 'polygon':
      ctx.usedPrimitives.add('polygon')
      return `polygon({ ${argsStr} })`

    case 'regular_polygon':
      ctx.usedPrimitives.add('regular_polygon')
      ctx.usedPrimitives.add('circle')  // Uses circle internally
      return `_regular_polygon({ ${argsStr} })`

    case 'polyhedron':
      ctx.usedPrimitives.add('polyhedron')
      return `_polyhedron({ ${argsStr} })`

    default:
      return `/* unknown primitive: ${name} */`
  }
}

function transpileBuiltinTransform(name: string, argsArray: Array<{name: string | null, value: string}>, child: string | null, ctx: TranspileContext): string {
  const childCode = child || 'undefined'

  // Filter out $-prefixed special variables (like $fn, $fa, $fs)
  // These are scoped variables in OpenSCAD, not transform arguments
  const filteredArgs = argsArray.filter(a => !a.name || !a.name.startsWith('$'))
  const args = transpileArgsToObject(filteredArgs)

  switch (name) {
    case 'translate':
      ctx.usedTransforms.add('translate')
      return `translate(${args}, ${childCode})`

    case 'rotate':
      ctx.usedTransforms.add('rotateX')
      ctx.usedTransforms.add('rotateY')
      ctx.usedTransforms.add('rotateZ')
      // If args contains named params (has ':'), wrap in {} for axis-angle rotation
      // Also need 'transform' for the matrix rotation
      if (args.includes(':')) {
        ctx.usedTransforms.add('transform')
        return `_rotate({ ${args} }, ${childCode})`
      }
      return `_rotate(${args}, ${childCode})`

    case 'scale':
      ctx.usedTransforms.add('scale')
      return `scale(${args}, ${childCode})`

    case 'mirror':
      ctx.usedTransforms.add('mirror')
      return `mirror({ normal: ${args} }, ${childCode})`

    case 'multmatrix': {
      // multmatrix(m) applies a 4x4 transformation matrix
      // The 'm' parameter is the matrix
      ctx.usedTransforms.add('transform')
      const matrixArg = argsArray.find(a => a.name === 'm' || !a.name)?.value || '[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]'
      return `_multmatrix(${matrixArg}, ${childCode})`
    }

    default:
      return `/* unknown transform: ${name} */`
  }
}

function transpileBuiltinBoolean(name: string, child: Statement | null, ctx: TranspileContext): string {
  // Extract children from BlockStmt for boolean operations
  let childCodes: string[] = []
  const assignments: { name: string, value: any }[] = []

  if (child) {
    const childType = child.constructor.name
    if (childType === 'BlockStmt') {
      const children = (child as any).children as Statement[]
      for (const c of children) {
        const cType = c.constructor.name
        if (cType === 'AssignmentNode') {
          assignments.push({ name: (c as any).name, value: (c as any).value })
        } else if (cType !== 'NoopStmt') {
          const code = transpileStatement(c, ctx)
          if (code) childCodes.push(code)
        }
      }
    } else {
      const code = transpileStatement(child, ctx)
      if (code) childCodes = [code]
    }
  }

  if (childCodes.length === 0) {
    return 'undefined'
  }

  const args = childCodes.join(',\n  ')

  // Build the boolean operation
  let boolOp: string

  switch (name) {
    case 'union':
      ctx.usedBooleans.add('union')
      boolOp = `union(\n  ${args}\n)`
      break

    case 'difference':
      ctx.usedBooleans.add('subtract')
      boolOp = `subtract(\n  ${args}\n)`
      break

    case 'intersection':
      ctx.usedBooleans.add('intersect')
      boolOp = `intersect(\n  ${args}\n)`
      break

    case 'minkowski':
      ctx.usedBooleans.add('minkowski')
      boolOp = `minkowski(\n  ${args}\n)`
      break

    default:
      return `/* unknown boolean: ${name} */`
  }

  // If there are assignments, wrap in IIFE
  if (assignments.length > 0) {
    const assignStrs = assignments.map(a => `const ${a.name} = ${transpileExpression(a.value, ctx)}`)
    return `(() => { ${assignStrs.join('; ')}; return ${boolOp} })()`
  }

  return boolOp
}

function transpileBuiltinHull(child: Statement | null, ctx: TranspileContext): string {
  // Extract children from BlockStmt for hull operations
  // Hull takes multiple geometries as separate arguments
  let childCodes: string[] = []

  if (child) {
    const childType = child.constructor.name
    if (childType === 'BlockStmt') {
      const children = (child as any).children as Statement[]
      childCodes = children.map(c => transpileStatement(c, ctx)).filter(Boolean) as string[]
    } else {
      const code = transpileStatement(child, ctx)
      if (code) childCodes = [code]
    }
  }

  if (childCodes.length === 0) {
    return 'undefined'
  }

  ctx.usedHulls = true
  const args = childCodes.join(',\n  ')
  return `hull(\n  ${args}\n)`
}

// Positional parameter names for extrusions
const extrusionParams: Record<string, string[]> = {
  linear_extrude: ['height', 'center', 'twist', 'slices'],
  rotate_extrude: ['angle', 'convexity'],
}

function transpileBuiltinExtrusion(name: string, argsArray: Array<{name: string | null, value: string}>, child: string | null, ctx: TranspileContext): string {
  const childCode = child || 'undefined'

  // Map positional args to named args using parameter definitions
  const paramNames = extrusionParams[name] || []
  const namedArgs = argsArray.map((arg, i) => {
    if (arg.name) {
      return `${arg.name}: ${arg.value}`
    }
    // Use positional param name if available
    const paramName = paramNames[i]
    if (paramName) {
      return `${paramName}: ${arg.value}`
    }
    return arg.value
  })
  const args = namedArgs.join(', ')

  switch (name) {
    case 'linear_extrude':
      ctx.usedExtrusions.add('extrudeLinear')
      ctx.usedTransforms.add('translate')  // _linearExtrude helper uses translate for center
      return `_linearExtrude({ ${args} }, ${childCode})`

    case 'rotate_extrude':
      ctx.usedExtrusions.add('extrudeRotate')
      return `_rotateExtrude({ ${args} }, ${childCode})`

    default:
      return `/* unknown extrusion: ${name} */`
  }
}

/**
 * Transpile a for loop to a union of mapped geometries
 * for (i = [0:10]) { cube(i); } becomes:
 * union(..._range(0, 10).map(i => cube(i)))
 *
 * for (i = [0:3], axis = [0:2]) { body } becomes:
 * union(..._range(0, 3).flatMap(i => _range(0, 2).map(axis => body)))
 */
function transpileForLoop(stmt: any, ctx: TranspileContext): string {
  const args = stmt.args
  if (!args || args.length === 0) {
    return '/* empty for loop */'
  }

  // Transpile the body
  const body = transpileStatement(stmt.child, ctx) || 'undefined'

  // Handle single loop variable (most common case)
  if (args.length === 1) {
    const varName = args[0].name
    const rangeOrVector = transpileExpression(args[0].value, ctx)
    ctx.usedBooleans.add('union')
    return `union(...${rangeOrVector}.map(${varName} => ${body}))`
  }

  // Multiple loop variables: for (i = [0:3], axis = [0:2]) { body }
  // Build nested flatMap/map: first vars use flatMap, last uses map
  let result = body
  for (let i = args.length - 1; i >= 0; i--) {
    const varName = args[i].name
    const rangeOrVector = transpileExpression(args[i].value, ctx)
    // Last variable uses map, all others use flatMap to flatten
    const method = i === args.length - 1 ? 'map' : 'flatMap'
    result = `${rangeOrVector}.${method}(${varName} => ${result})`
  }
  ctx.usedBooleans.add('union')
  return `union(...${result})`
}

function getModuleName(filename: string): string {
  // Convert filename to valid JS identifier
  // e.g., "hardware.scad" -> "hardware"
  return filename
    .replace(/\.scad$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
}

function buildJscadImports(ctx: TranspileContext): string[] {
  const imports: string[] = []

  // Filter out JSCAD names that conflict with user-defined modules/functions
  // e.g., BOSL defines its own 'cuboid' module, so we don't import JSCAD's cuboid
  const filterConflicts = (names: Set<string>) =>
    Array.from(names).filter(n => !ctx.availableSymbols.has(n))

  const prims = filterConflicts(ctx.usedPrimitives)
  if (prims.length > 0) {
    imports.push(`const { ${prims.join(', ')} } = require('@jscad/modeling').primitives`)
  }

  // Import primitives needed by internal helpers with aliased names to avoid collision
  // e.g., _cube uses cuboid internally even if user defines their own cuboid module
  const internalPrims: string[] = []
  if (ctx.usedPrimitives.has('cube') || ctx.usedPrimitives.has('cuboid')) {
    if (ctx.availableSymbols.has('cuboid') && !prims.includes('cuboid')) {
      internalPrims.push('cuboid: __cuboid')
    }
  }
  if (internalPrims.length > 0) {
    imports.push(`const { ${internalPrims.join(', ')} } = require('@jscad/modeling').primitives`)
  }
  const xforms = filterConflicts(ctx.usedTransforms)
  if (xforms.length > 0) {
    imports.push(`const { ${xforms.join(', ')} } = require('@jscad/modeling').transforms`)
  }
  const bools = filterConflicts(ctx.usedBooleans)
  if (bools.length > 0) {
    imports.push(`const { ${bools.join(', ')} } = require('@jscad/modeling').booleans`)
  }
  const extrs = filterConflicts(ctx.usedExtrusions)
  if (extrs.length > 0) {
    // When extrudeLinear is used, also import extrudeFromSlices for scale/twist support
    const extrsWithSlices = ctx.usedExtrusions.has('extrudeLinear')
      ? [...new Set([...extrs, 'extrudeFromSlices'])]
      : extrs
    imports.push(`const { ${extrsWithSlices.join(', ')} } = require('@jscad/modeling').extrusions`)
  }
  // Import slice separately with renamed alias to avoid conflict with OpenSCAD's slice() function
  if (ctx.usedExtrusions.has('extrudeLinear')) {
    imports.push(`const _jscadSlice = require('@jscad/modeling').extrusions.slice`)
  }
  if (ctx.usedColors) {
    imports.push(`const { colorize, cssColors } = require('@jscad/modeling').colors`)
  }
  if (ctx.usedHulls) {
    imports.push(`const { hull } = require('@jscad/modeling').hulls`)
  }
  // mat4 and geom2 are needed by _linearExtrude helper for scale/twist
  if (ctx.usedMaths || ctx.usedExtrusions.has('extrudeLinear')) {
    imports.push(`const { mat4 } = require('@jscad/modeling').maths`)
  }
  if (ctx.usedExtrusions.has('extrudeLinear')) {
    imports.push(`const { geom2 } = require('@jscad/modeling').geometries`)
  }

  // Add helper functions for OpenSCAD compatibility
  imports.push('')
  imports.push('// OpenSCAD compatibility helpers')
  // Define special variables with OpenSCAD defaults (needed for BOSL library functions like segs())
  // Only define defaults for variables not already declared by the user
  const specialVarDefaults: string[] = []
  if (!ctx.variableNames.includes('$fn')) specialVarDefaults.push('$fn = 0')
  if (!ctx.variableNames.includes('$fa')) specialVarDefaults.push('$fa = 12')
  if (!ctx.variableNames.includes('$fs')) specialVarDefaults.push('$fs = 2')
  if (specialVarDefaults.length > 0) {
    imports.push(`const ${specialVarDefaults.join(', ')}`)
  }
  imports.push('const PI = Math.PI')
  imports.push('const _range = (start, end, step = 1) => { const r = []; for (let i = start; i <= end; i += step) r.push(i); return r }')
  // String functions - always needed since they're commonly used
  imports.push('const str = (...args) => args.map(a => a === undefined ? "undef" : a === null ? "undef" : String(a)).join("")')
  imports.push('const version_num = () => 20210100')  // Pretend to be OpenSCAD 2021.01
  imports.push('const search = (match, string, num_returns = 1, idx) => { /* stub */ return [[]] }')  // Stub for search function

  // Math helper functions
  if (ctx.usedHelpers.has('norm')) {
    imports.push('const _norm = (v) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))')
  }
  if (ctx.usedHelpers.has('cross')) {
    imports.push('const _cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]')
  }
  if (ctx.usedHelpers.has('lookup')) {
    imports.push(`const _lookup = (val, table) => {
  if (table.length === 0) return 0
  if (val <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    if (val <= table[i][0]) {
      const t = (val - table[i-1][0]) / (table[i][0] - table[i-1][0])
      return table[i-1][1] + t * (table[i][1] - table[i-1][1])
    }
  }
  return table[table.length - 1][1]
}`)
  }
  if (ctx.usedHelpers.has('rands')) {
    imports.push(`const _rands = (min, max, count, seed) => {
  const r = []
  // Simple seeded PRNG (mulberry32)
  let s = seed !== undefined ? seed : Math.random() * 2147483647 | 0
  const rand = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
  for (let i = 0; i < count; i++) r.push(min + rand() * (max - min))
  return r
}`)
  }
  // Deep equality comparison for OpenSCAD's == and != operators
  if (ctx.usedHelpers.has('eq')) {
    imports.push(`const _eq = (a, b) => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!_eq(a[i], b[i])) return false
    return true
  }
  return false
}`)
  }
  // Vector addition - works with scalars and arrays (recursive for nested arrays)
  if (ctx.usedHelpers.has('vadd')) {
    imports.push(`const _vadd = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => _vadd(v, b[i] ?? 0))
  if (Array.isArray(a)) return a.map(v => _vadd(v, b))
  if (Array.isArray(b)) return b.map(v => _vadd(a, v))
  return a + b
}`)
  }
  // Vector subtraction - works with scalars and arrays (recursive for nested arrays)
  if (ctx.usedHelpers.has('vsub')) {
    imports.push(`const _vsub = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => _vsub(v, b[i] ?? 0))
  if (Array.isArray(a)) return a.map(v => _vsub(v, b))
  if (Array.isArray(b)) return b.map(v => _vsub(a, v))
  return a - b
}`)
  }
  // Vector/scalar multiplication - dot product for vectors, element-wise for scalar
  // OpenSCAD: vector * vector = dot product (scalar), scalar * vector = element-wise (vector)
  if (ctx.usedHelpers.has('vmul')) {
    imports.push(`const _vmul = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)
  if (Array.isArray(a)) return a.map(v => v * b)
  if (Array.isArray(b)) return b.map(v => a * v)
  return a * b
}`)
  }
  // Vector/scalar division - element-wise for vectors, scalar div
  if (ctx.usedHelpers.has('vdiv')) {
    imports.push(`const _vdiv = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => v / (b[i] ?? 1))
  if (Array.isArray(a)) return a.map(v => v / b)
  if (Array.isArray(b)) return b.map(v => a / v)
  return a / b
}`)
  }
  // Vector/scalar negation - element-wise for vectors, scalar negation
  if (ctx.usedHelpers.has('vneg')) {
    imports.push(`const _vneg = (v) => Array.isArray(v) ? v.map(x => -x) : -v`)
  }

  // Segment calculation matching OpenSCAD's $fa/$fs formula
  // globalFn acts as default when no explicit $fn is set (same as OpenSCAD -D)
  const globalFn = ctx.options.fn || 0
  imports.push(`
// min/max that handle array arguments (OpenSCAD: max([1,2,3]) returns 3)
const _min = (...args) => args.length === 1 && Array.isArray(args[0]) ? Math.min(...args[0]) : Math.min(...args)
const _max = (...args) => args.length === 1 && Array.isArray(args[0]) ? Math.max(...args[0]) : Math.max(...args)

// Calculate segments like OpenSCAD: ceil(max(min(360/$fa, 2*PI*r/$fs), 5))
const _globalFn = ${globalFn}
const _getSegments = (radius, $fn, $fa = 12, $fs = 2) => {
  // Explicit $fn in code takes precedence over global default
  if ($fn > 0) return $fn
  // Global $fn is used as default when not explicitly set
  if (_globalFn > 0) return _globalFn
  if (radius < 0.001) return 5
  const fromAngle = 360 / $fa
  const fromSize = (2 * Math.PI * radius) / $fs
  return Math.ceil(Math.max(Math.min(fromAngle, fromSize), 5))
}

// Validate numeric arguments - OpenSCAD silently ignores invalid values
// Returns undefined for invalid input so fallback chain works; use _num(x) ?? default
const _num = v => typeof v === 'number' && !isNaN(v) ? v : undefined`)

  // Primitive wrappers that handle OpenSCAD semantics
  if (ctx.usedPrimitives.has('cube') || ctx.usedPrimitives.has('cuboid')) {
    // Use __cuboid if user defined cuboid (we imported it aliased above)
    const cuboidFn = ctx.availableSymbols.has('cuboid') ? '__cuboid' : 'cuboid'
    imports.push(`
const _cube = ({ size, center = false }) => {
  // size can be number or [x,y,z] array - validate each component
  const s = Array.isArray(size) ? size.map(v => _num(v) ?? 1) : [_num(size) ?? 1, _num(size) ?? 1, _num(size) ?? 1]
  const geo = s[0] === s[1] && s[1] === s[2] ? cube({ size: s[0] }) : ${cuboidFn}({ size: s })
  return center ? geo : translate([s[0]/2, s[1]/2, s[2]/2], geo)
}`)
  }

  if (ctx.usedPrimitives.has('cylinder')) {
    imports.push(`
const _cylinder = ({ h, r, r1, r2, d, d1, d2, center = false, $fn = 0, $fa, $fs }) => {
  const height = _num(h, 1)
  const rr = _num(r), dd = _num(d), rr1 = _num(r1), rr2 = _num(r2), dd1 = _num(d1), dd2 = _num(d2)
  const radius1 = rr1 ?? (dd1 ? dd1/2 : (rr ?? (dd ? dd/2 : 1)))
  const radius2 = rr2 ?? (dd2 ? dd2/2 : (rr ?? (dd ? dd/2 : 1)))
  const segments = _getSegments(Math.max(radius1, radius2), $fn, $fa, $fs)
  const geo = cylinder({ height, startRadius: radius1, endRadius: radius2, segments })
  return center ? geo : translate([0, 0, height/2], geo)
}`)
  }

  if (ctx.usedPrimitives.has('sphere')) {
    // OpenSCAD-style sphere: rings at (180 * (i + 0.5)) / numRings, no pole vertices
    // This matches OpenSCAD's exact tessellation algorithm
    imports.push(`
const _sphere = ({ r, d, $fn = 0, $fa, $fs }) => {
  const rr = _num(r), dd = _num(d)
  const radius = rr ?? (dd ? dd/2 : 1)
  const fn = _getSegments(radius, $fn, $fa, $fs)
  const numRings = Math.floor((fn + 1) / 2)
  const points = []
  const faces = []

  // Generate ring vertices (no poles - matches OpenSCAD)
  for (let i = 0; i < numRings; i++) {
    const phi = (180 * (i + 0.5)) / numRings * Math.PI / 180
    const z = radius * Math.cos(phi)
    const ringR = radius * Math.sin(phi)
    for (let j = 0; j < fn; j++) {
      const theta = 2 * Math.PI * j / fn
      points.push([ringR * Math.cos(theta), ringR * Math.sin(theta), z])
    }
  }

  // Top cap: triangulate first ring as polygon
  for (let j = 1; j < fn - 1; j++) faces.push([0, j, j + 1])

  // Body: quads between adjacent rings
  for (let i = 0; i < numRings - 1; i++) {
    const ring = i * fn, nextRing = (i + 1) * fn
    for (let j = 0; j < fn; j++) {
      const next = (j + 1) % fn
      faces.push([ring + j, nextRing + j, ring + next])
      faces.push([ring + next, nextRing + j, nextRing + next])
    }
  }

  // Bottom cap: triangulate last ring as polygon
  const lastRing = (numRings - 1) * fn
  for (let j = 1; j < fn - 1; j++) faces.push([lastRing, lastRing + j + 1, lastRing + j])

  return polyhedron({ points, faces, orientation: 'outward' })
}`)
  }

  if (ctx.usedPrimitives.has('circle')) {
    imports.push(`
const _circle = ({ r, d, $fn = 0, $fa, $fs }) => {
  const rr = _num(r), dd = _num(d)
  const radius = rr ?? (dd ? dd/2 : 1)
  const segments = _getSegments(radius, $fn, $fa, $fs)
  return circle({ radius, segments })
}`)
  }

  if (ctx.usedPrimitives.has('rectangle')) {
    imports.push(`
const _square = ({ size, center = false }) => {
  const s = Array.isArray(size) ? size.map(v => _num(v) ?? 1) : [_num(size) ?? 1, _num(size) ?? 1]
  const geo = rectangle({ size: s })
  return center ? geo : translate([s[0]/2, s[1]/2], geo)
}`)
  }

  if (ctx.usedPrimitives.has('regular_polygon')) {
    imports.push(`
const _regular_polygon = ({ order = 6, n, r = 1, $fn = 0 }) => {
  // n is an alias for order (number of sides)
  // Use circle with segments to create regular polygon - matches OpenSCAD's approach
  const sides = _num(n) ?? _num(order) ?? 6
  const radius = _num(r) ?? 1
  return circle({ radius, segments: sides })
}`)
  }

  if (ctx.usedPrimitives.has('polyhedron')) {
    imports.push(`
const _polyhedron = ({ points, faces, triangles, convexity }) => {
  // OpenSCAD and JSCAD use opposite winding orders for faces
  // OpenSCAD: counter-clockwise when viewed from outside
  // JSCAD: clockwise when viewed from outside (right-hand rule inward)
  // So we need to reverse each face's vertex order
  const faceList = faces || triangles || []
  const reversedFaces = faceList.map(f => [...f].reverse())
  return polyhedron({ points, faces: reversedFaces, orientation: 'outward' })
}`)
  }

  // Safe union that filters out undefined values (from assertions, etc.)
  if (ctx.usedHelpers.has('safeUnion')) {
    imports.push(`
const _safeUnion = (parts) => {
  const valid = parts.filter(p => p !== undefined && p !== null)
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  return union(...valid)
}`)
  }

  // Rotation helper for Euler angles
  if (ctx.usedTransforms.has('rotateX') || ctx.usedTransforms.has('rotateY') || ctx.usedTransforms.has('rotateZ')) {
    imports.push(`
const _rotate = (params, geo) => {
  const toRad = d => d * Math.PI / 180
  // Handle object form: rotate(a=angle, v=[x,y,z]) or rotate(a=angle)
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const angle = toRad(params.a || 0)
    if (params.v !== undefined) {
      // Axis-angle rotation with explicit axis
      const [x, y, z] = params.v
      // Rodrigues' rotation formula via mat4
      const len = Math.sqrt(x*x + y*y + z*z)
      if (len < 0.0001) return geo
      const nx = x/len, ny = y/len, nz = z/len
      const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
      // Build rotation matrix in column-major order for JSCAD's transform
      const m = [
        t*nx*nx + c,    t*nx*ny + s*nz, t*nx*nz - s*ny, 0,  // column 0
        t*nx*ny - s*nz, t*ny*ny + c,    t*ny*nz + s*nx, 0,  // column 1
        t*nx*nz + s*ny, t*ny*nz - s*nx, t*nz*nz + c,    0,  // column 2
        0, 0, 0, 1                                           // column 3
      ]
      return transform(m, geo)
    }
    // No axis specified, rotate around Z (like rotate(a))
    return angle !== 0 ? rotateZ(angle, geo) : geo
  }
  // Handle Euler angles: rotate([x, y, z]) or rotate(z)
  const a = Array.isArray(params) ? params : [0, 0, params]
  let result = geo
  if (a[0] !== 0) result = rotateX(toRad(a[0]), result)
  if (a[1] !== 0) result = rotateY(toRad(a[1]), result)
  if (a[2] !== 0) result = rotateZ(toRad(a[2]), result)
  return result
}`)
  }

  // Multmatrix helper - applies a 4x4 transformation matrix
  if (ctx.usedTransforms.has('transform')) {
    imports.push(`
const _multmatrix = (m, geo) => {
  // OpenSCAD multmatrix uses row-major 4x4 or 4x3 matrix
  // JSCAD transform uses column-major flat array [m00,m10,m20,m30,m01,m11,...]
  // Flatten and transpose the matrix
  const flat = []
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < (m.length < 4 ? 3 : 4); row++) {
      flat.push(m[row] && m[row][col] !== undefined ? m[row][col] : (row === col ? 1 : 0))
    }
    if (m.length < 4) flat.push(col === 3 ? 1 : 0)  // Add homogeneous row if 4x3
  }
  return transform(flat, geo)
}`)
  }

  // Linear extrude helper - uses extrudeFromSlices when scale is used (extrudeLinear ignores scale)
  if (ctx.usedExtrusions.has('extrudeLinear')) {
    imports.push(`
const _linearExtrude = ({ height, center = false, twist = 0, slices, scale = 1, segments, $fn = 0 }, geo) => {
  // Normalize scale to [x, y] array
  const scaleArr = Array.isArray(scale) ? scale : [scale, scale]
  const needsScale = scaleArr[0] !== 1 || scaleArr[1] !== 1

  // Calculate number of steps (slices along Z axis)
  let steps
  if (slices !== undefined) {
    steps = Math.max(1, Math.ceil(slices))
  } else if (twist !== 0) {
    // Auto-calculate for twist: ~6° per step for smooth result
    steps = $fn > 0 ? $fn : Math.max(1, Math.ceil(Math.abs(twist) / 6))
  } else if (needsScale) {
    // Need steps for smooth taper
    steps = 16
  } else {
    steps = 1
  }

  let result
  if (needsScale || twist !== 0) {
    // Use extrudeFromSlices for scale/twist support
    // Negate twist: OpenSCAD uses clockwise (right-hand rule), JSCAD uses counter-clockwise
    const twistRad = -twist * Math.PI / 180
    let sides = geom2.toSides(geo)

    // Subdivide edges for smoother twist (OpenSCAD's segments parameter)
    // Default: subdivide based on twist angle to get ~30° per segment per edge
    if (twist !== 0) {
      const segsPerEdge = segments !== undefined ? Math.max(1, segments) : Math.max(1, Math.ceil(Math.abs(twist) / 30))
      if (segsPerEdge > 1) {
        const subdividedSides = []
        for (const [p0, p1] of sides) {
          for (let i = 0; i < segsPerEdge; i++) {
            const t0 = i / segsPerEdge
            const t1 = (i + 1) / segsPerEdge
            const start = [p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0]
            const end = [p0[0] + (p1[0] - p0[0]) * t1, p0[1] + (p1[1] - p0[1]) * t1]
            subdividedSides.push([start, end])
          }
        }
        sides = subdividedSides
      }
    }

    const baseSlice = _jscadSlice.fromSides(sides)

    const callback = (progress, index, base) => {
      const angle = twistRad * progress
      const sx = 1 + (scaleArr[0] - 1) * progress
      const sy = 1 + (scaleArr[1] - 1) * progress
      const z = height * progress

      const m = mat4.create()
      mat4.translate(m, m, [0, 0, z])
      mat4.rotateZ(m, m, angle)
      mat4.scale(m, m, [sx, sy, 1])

      return _jscadSlice.transform(m, baseSlice)
    }

    result = extrudeFromSlices({ numberOfSlices: steps + 1, callback }, geo)
  } else {
    // Simple extrusion without scale or twist
    result = extrudeLinear({ height }, geo)
  }

  return center ? translate([0, 0, -height/2], result) : result
}`)
  }

  // Rotate extrude helper - uses 360/$fa = 30 segments by default
  if (ctx.usedExtrusions.has('extrudeRotate')) {
    imports.push(`
const _rotateExtrude = ({ angle = 360, $fn = 0, $fa = 12 }, geo) => {
  // Calculate full-circle segments from $fn or $fa
  const fullCircleSegments = $fn > 0 ? $fn : (_globalFn > 0 ? _globalFn : Math.ceil(360 / $fa))
  // Scale segments proportionally to the angle (OpenSCAD uses ceil, not round)
  const segments = Math.max(1, Math.ceil(fullCircleSegments * angle / 360))
  const opts = { segments }
  if (angle !== 360) { opts.angle = angle * Math.PI / 180 }
  return extrudeRotate(opts, geo)
}`)
  }

  // Color helper
  if (ctx.usedColors) {
    imports.push(`
const _color = (color, alpha, geo) => {
  let rgba
  if (typeof color === 'string') {
    // CSS color name
    const rgb = cssColors[color] || [0.5, 0.5, 0.5]
    rgba = [...rgb, alpha ?? 1]
  } else if (Array.isArray(color)) {
    // RGB or RGBA array
    rgba = color.length === 3 ? [...color, alpha ?? 1] : color
  } else {
    rgba = [0.5, 0.5, 0.5, 1]
  }
  return colorize(rgba, geo)
}`)
  }

  return imports
}
