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
}

export interface UseImport {
  filename: string
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
  // Track use statements with their discovered symbols
  useImports: UseImport[]
  // Track module/function definitions for export (local definitions)
  moduleNames: string[]
  functionNames: string[]
  // Track all available symbols (local + imported)
  availableSymbols: Set<string>
  // Current indentation level
  indentLevel: number
  // Cache of transpiled files (shared across recursive calls)
  transpiledFiles: Map<string, TranspiledFile>
  // Track files currently being processed (for cycle detection)
  processingFiles: Set<string>
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
    useImports: [],
    moduleNames: [],
    functionNames: [],
    availableSymbols: new Set(),
    indentLevel: 0,
    transpiledFiles: sharedCache || new Map(),
    processingFiles: new Set(),
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

  // Process use statements: transpile dependencies and discover their exports
  for (const useImport of ctx.useImports) {
    const symbols = transpileAndCacheDependency(useImport.filename, ctx)
    useImport.symbols = symbols
    for (const sym of symbols) {
      ctx.availableSymbols.add(sym)
    }
  }

  // Second pass: transpile statements
  const bodyParts: string[] = []
  const geometryParts: string[] = []
  const topLevelAssignments: { name: string, value: any }[] = []

  for (const stmt of ast.statements) {
    const stmtType = stmt.constructor.name

    if (stmtType === 'ModuleDeclarationStmt') {
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

  // Build the output
  const parts: string[] = []

  // Header with JSCAD imports
  if (opts.includeHeader) {
    const imports = buildJscadImports(ctx)
    if (imports.length > 0) {
      parts.push(imports.join('\n'))
      parts.push('')
    }
  }

  // Use imports (require statements for .scad files)
  if (ctx.useImports.length > 0) {
    for (const imp of ctx.useImports) {
      const jsPath = imp.filename.replace(/\.scad$/, '.js')
      if (imp.symbols.length > 0) {
        // Destructuring import with discovered symbols
        parts.push(`const { ${imp.symbols.join(', ')} } = require('./${jsPath}')`)
      } else {
        // Fallback: import entire module (no file resolver or empty file)
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

  // Main function with file-scope geometry
  if (geometryParts.length > 0 || topLevelAssignments.length > 0) {
    const assignmentLines = topLevelAssignments.map(a =>
      `  const ${a.name} = ${transpileExpression(a.value, ctx)}`
    )
    const mainBody = geometryParts.length === 0
      ? 'undefined'
      : geometryParts.length === 1
        ? geometryParts[0]
        : `union(\n${geometryParts.map(p => `    ${p}`).join(',\n')}\n  )`

    if (assignmentLines.length > 0) {
      parts.push(`const main = () => {\n${assignmentLines.join('\n')}\n  return ${mainBody}\n}`)
    } else {
      parts.push(`const main = () => {\n  return ${mainBody}\n}`)
    }
    parts.push('')
  } else {
    // Empty main if no geometry
    parts.push(`const main = () => undefined`)
    parts.push('')
  }

  // Exports
  const allExports = [...ctx.moduleNames, ...ctx.functionNames, 'main']
  parts.push(`module.exports = { ${allExports.join(', ')} }`)

  const code = parts.join('\n')

  // Add this file to the cache if it has a name
  if (opts.currentFile) {
    ctx.transpiledFiles.set(opts.currentFile, {
      code,
      exports: allExports.filter(e => e !== 'main'),
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

  // Check cache first
  const cached = ctx.transpiledFiles.get(filename)
  if (cached) {
    return cached.exports
  }

  // Detect cycles
  if (ctx.processingFiles.has(filename)) {
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
  const result = transpile(ast, {
    ...ctx.options,
    currentFile: filename,
  }, ctx.transpiledFiles)

  // Cache the result
  ctx.transpiledFiles.set(filename, {
    code: result.code,
    exports: result.exports.filter(e => e !== 'main'),  // Don't export 'main' from dependencies
  })

  // Return exports (excluding 'main')
  return result.exports.filter(e => e !== 'main')
}

/**
 * First pass: collect declarations
 */
function collectDeclarations(stmt: Statement, ctx: TranspileContext): void {
  const stmtType = stmt.constructor.name

  if (stmtType === 'ModuleDeclarationStmt') {
    ctx.moduleNames.push((stmt as any).name)
  } else if (stmtType === 'FunctionDeclarationStmt') {
    ctx.functionNames.push((stmt as any).name)
  } else if (stmtType === 'UseStmt') {
    ctx.useImports.push({
      filename: (stmt as any).filename,
      symbols: [],
    })
  }
}

/**
 * Extract nested modules, assignments, and geometry statements from a module body
 */
function extractModuleBody(stmt: Statement, _ctx: TranspileContext): {
  nestedModules: any[],
  assignments: { name: string, value: any }[],
  geometryStmts: Statement[]
} {
  const nestedModules: any[] = []
  const assignments: { name: string, value: any }[] = []
  const geometryStmts: Statement[] = []

  if (!stmt) {
    return { nestedModules, assignments, geometryStmts }
  }

  const stmtType = stmt.constructor.name

  if (stmtType === 'BlockStmt') {
    const block = stmt as any

    for (const child of block.children) {
      const childType = child.constructor.name
      if (childType === 'ModuleDeclarationStmt') {
        nestedModules.push(child)
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

  return { nestedModules, assignments, geometryStmts }
}

/**
 * Recursively build the body of a module function, handling nested modules at any depth
 */
function buildModuleBody(moduleStmt: any, ctx: TranspileContext, indent: string = '  '): string[] {
  const { nestedModules, assignments, geometryStmts } = extractModuleBody(moduleStmt, ctx)
  const bodyParts: string[] = []

  // Recursively process nested module definitions
  for (const m of nestedModules) {
    const nestedParams = transpileParamsList(m.definitionArgs, ctx)
    const nestedBodyParts = buildModuleBody(m.stmt, ctx, indent + '  ')
    bodyParts.push(`${indent}const ${m.name} = (${nestedParams}) => {\n${nestedBodyParts.join('\n')}\n${indent}}`)
  }

  // Local variable assignments
  for (const a of assignments) {
    bodyParts.push(`${indent}const ${a.name} = ${transpileExpression(a.value, ctx)}`)
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
 * Uses regular parameters (not destructured) for easier positional args
 */
function transpileModuleDeclaration(stmt: any, ctx: TranspileContext): string {
  const name = stmt.name
  const params = transpileParamsList(stmt.definitionArgs, ctx)
  const bodyParts = buildModuleBody(stmt.stmt, ctx)

  return `const ${name} = (${params}) => {\n${bodyParts.join('\n')}\n}`
}

/**
 * Transpile a function declaration
 */
function transpileFunctionDeclaration(stmt: any, ctx: TranspileContext): string {
  const name = stmt.name
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

      const parts = geometryStmts.map(c => transpileStatement(c, ctx)).filter(Boolean) as string[]
      if (parts.length === 0 && assignments.length === 0) return null

      // If there are assignments, we need to create an IIFE to scope them
      if (assignments.length > 0) {
        const assignStrs = assignments.map(a => `const ${a.name} = ${transpileExpression(a.value, ctx)}`)
        if (parts.length === 0) {
          return `(() => { ${assignStrs.join('; ')}; return undefined })()`
        }
        if (parts.length === 1) {
          return `(() => { ${assignStrs.join('; ')}; return ${parts[0]} })()`
        }
        ctx.usedBooleans.add('union')
        return `(() => { ${assignStrs.join('; ')}; return union(\n    ${parts.join(',\n    ')}\n  ) })()`
      }

      if (parts.length === 1) return parts[0]
      ctx.usedBooleans.add('union')
      return `union(\n${parts.map(p => `  ${p}`).join(',\n')}\n)`
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

  // Handle children
  let childCode: string | null = null
  if (stmt.child) {
    childCode = transpileStatement(stmt.child, ctx)
  }

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

  // User-defined module/function - direct call (late binding)
  // Symbol is available if it's local or imported via use
  const positionalArgs = argsArray.map(a => a.value).join(', ')

  // Just emit a direct call - the symbol should be available from:
  // - Local module/function definitions
  // - Destructured imports from use statements
  return `${name}(${positionalArgs})`
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
      return name
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
      const op = transpileBinaryOp(e.operation)
      return `(${left} ${op} ${right})`
    }

    case 'UnaryOpExpr': {
      const e = expr as any
      const right = transpileExpression(e.right, ctx)
      const op = transpileUnaryOp(e.operation)
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
      return `${obj}.${e.member}`
    }

    case 'LcForExpr': {
      // List comprehension: [for (i = [0:10]) i * 2]
      const e = expr as any
      const args = e.args as any[]
      const innerExpr = transpileExpression(e.expr, ctx)

      if (args.length === 1) {
        const varName = args[0].name
        const range = transpileExpression(args[0].value, ctx)
        return `${range}.map(${varName} => ${innerExpr})`
      }
      return `/* complex for comprehension */`
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

function transpileBinaryOp(op: number): string {
  // TokenType enum numeric values
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
    23: '===', // EqualEqual
    25: '!==', // BangEqual
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
    min: 'Math.min',
    max: 'Math.max',
    sign: 'Math.sign',
  }

  if (mathFuncs[callee]) {
    return `${mathFuncs[callee]}(${args})`
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
  const argsStr = namedArgs.join(', ')

  switch (name) {
    case 'cube':
      ctx.usedPrimitives.add('cube')
      ctx.usedPrimitives.add('cuboid')
      ctx.usedTransforms.add('translate')
      return `_cube({ ${argsStr} })`

    case 'sphere':
      ctx.usedPrimitives.add('sphere')
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
      return `_rotate(${args}, ${childCode})`

    case 'scale':
      ctx.usedTransforms.add('scale')
      return `scale(${args}, ${childCode})`

    case 'mirror':
      ctx.usedTransforms.add('mirror')
      return `mirror({ normal: ${args} }, ${childCode})`

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
 */
function transpileForLoop(stmt: any, ctx: TranspileContext): string {
  const args = stmt.args
  if (!args || args.length === 0) {
    return '/* empty for loop */'
  }

  // Handle single loop variable (most common case)
  // for (i = [start:end]) body
  // for (i = [start:step:end]) body
  // for (i = vector) body
  const arg = args[0]
  const varName = arg.name
  const rangeOrVector = transpileExpression(arg.value, ctx)

  // Transpile the body
  const body = transpileStatement(stmt.child, ctx) || 'undefined'

  // If we have multiple children, they're already unioned by transpileStatement
  // The result is: union(...range.map(varName => body))
  ctx.usedBooleans.add('union')
  return `union(...${rangeOrVector}.map(${varName} => ${body}))`
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

  if (ctx.usedPrimitives.size > 0) {
    imports.push(`const { ${Array.from(ctx.usedPrimitives).join(', ')} } = require('@jscad/modeling').primitives`)
  }
  if (ctx.usedTransforms.size > 0) {
    imports.push(`const { ${Array.from(ctx.usedTransforms).join(', ')} } = require('@jscad/modeling').transforms`)
  }
  if (ctx.usedBooleans.size > 0) {
    imports.push(`const { ${Array.from(ctx.usedBooleans).join(', ')} } = require('@jscad/modeling').booleans`)
  }
  if (ctx.usedExtrusions.size > 0) {
    imports.push(`const { ${Array.from(ctx.usedExtrusions).join(', ')} } = require('@jscad/modeling').extrusions`)
  }
  if (ctx.usedColors) {
    imports.push(`const { colorize, cssColors } = require('@jscad/modeling').colors`)
  }
  if (ctx.usedHulls) {
    imports.push(`const { hull } = require('@jscad/modeling').hulls`)
  }
  if (ctx.usedMaths) {
    imports.push(`const { mat4 } = require('@jscad/modeling').maths`)
  }

  // Add helper functions for OpenSCAD compatibility
  imports.push('')
  imports.push('// OpenSCAD compatibility helpers')
  imports.push('const _range = (start, end, step = 1) => { const r = []; for (let i = start; i <= end; i += step) r.push(i); return r }')

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

  // Segment calculation matching OpenSCAD's $fa/$fs formula
  // globalFn acts as default when no explicit $fn is set (same as OpenSCAD -D)
  const globalFn = ctx.options.fn || 0
  imports.push(`
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
}`)

  // Primitive wrappers that handle OpenSCAD semantics
  if (ctx.usedPrimitives.has('cube') || ctx.usedPrimitives.has('cuboid')) {
    imports.push(`
const _cube = ({ size, center = false }) => {
  const s = Array.isArray(size) ? size : [size, size, size]
  const geo = s[0] === s[1] && s[1] === s[2] ? cube({ size: s[0] }) : cuboid({ size: s })
  return center ? geo : translate([s[0]/2, s[1]/2, s[2]/2], geo)
}`)
  }

  if (ctx.usedPrimitives.has('cylinder')) {
    imports.push(`
const _cylinder = ({ h, r, r1, r2, d, d1, d2, center = false, $fn = 0, $fa, $fs }) => {
  const radius1 = r1 ?? (d1 ? d1/2 : (r ?? (d ? d/2 : 1)))
  const radius2 = r2 ?? (d2 ? d2/2 : (r ?? (d ? d/2 : 1)))
  const segments = _getSegments(Math.max(radius1, radius2), $fn, $fa, $fs)
  const geo = cylinder({ height: h, startRadius: radius1, endRadius: radius2, segments })
  return center ? geo : translate([0, 0, h/2], geo)
}`)
  }

  if (ctx.usedPrimitives.has('sphere')) {
    imports.push(`
const _sphere = ({ r, d, $fn = 0, $fa, $fs }) => {
  const radius = r ?? (d ? d/2 : 1)
  const segments = _getSegments(radius, $fn, $fa, $fs)
  return sphere({ radius, segments })
}`)
  }

  if (ctx.usedPrimitives.has('circle')) {
    imports.push(`
const _circle = ({ r, d, $fn = 0, $fa, $fs }) => {
  const radius = r ?? (d ? d/2 : 1)
  const segments = _getSegments(radius, $fn, $fa, $fs)
  return circle({ radius, segments })
}`)
  }

  if (ctx.usedPrimitives.has('rectangle')) {
    imports.push(`
const _square = ({ size, center = false }) => {
  const s = Array.isArray(size) ? size : [size, size]
  const geo = rectangle({ size: s })
  return center ? geo : translate([s[0]/2, s[1]/2], geo)
}`)
  }

  if (ctx.usedPrimitives.has('regular_polygon')) {
    imports.push(`
const _regular_polygon = ({ order = 6, n, r = 1, $fn = 0 }) => {
  // n is an alias for order (number of sides)
  // Use circle with segments to create regular polygon - matches OpenSCAD's approach
  const sides = n ?? order
  return circle({ radius: r, segments: sides })
}`)
  }

  // Rotation helper for Euler angles
  if (ctx.usedTransforms.has('rotateX') || ctx.usedTransforms.has('rotateY') || ctx.usedTransforms.has('rotateZ')) {
    imports.push(`
const _rotate = (angles, geo) => {
  const a = Array.isArray(angles) ? angles : [0, 0, angles]
  const toRad = d => d * Math.PI / 180
  let result = geo
  if (a[0] !== 0) result = rotateX(toRad(a[0]), result)
  if (a[1] !== 0) result = rotateY(toRad(a[1]), result)
  if (a[2] !== 0) result = rotateZ(toRad(a[2]), result)
  return result
}`)
  }

  // Linear extrude helper
  if (ctx.usedExtrusions.has('extrudeLinear')) {
    imports.push(`
const _linearExtrude = ({ height, center = false, twist = 0, slices = 1 }, geo) => {
  const opts = { height }
  if (twist !== 0) { opts.twistAngle = twist * Math.PI / 180; opts.twistSteps = Math.ceil(slices) }
  const result = extrudeLinear(opts, geo)
  return center ? translate([0, 0, -height/2], result) : result
}`)
  }

  // Rotate extrude helper - uses 360/$fa = 30 segments by default
  if (ctx.usedExtrusions.has('extrudeRotate')) {
    imports.push(`
const _rotateExtrude = ({ angle = 360, $fn = 0, $fa = 12 }, geo) => {
  // Use explicit $fn, then global default, then calculated from $fa
  const segments = $fn > 0 ? $fn : (_globalFn > 0 ? _globalFn : Math.ceil(360 / $fa))
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
