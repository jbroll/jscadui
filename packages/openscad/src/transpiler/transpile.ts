/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OpenSCAD to JavaScript Transpiler
 *
 * Converts OpenSCAD AST directly to JavaScript code with module exports.
 * Uses late binding for module calls - modules are emitted as JavaScript functions
 * that call each other at runtime.
 */

import type { ScadFile, Statement } from 'openscad-parser'
import { parse } from '../parser/parse.js'
import { safeIdentifier, getFileDir } from '../utils/identifiers.js'
import {
  TranspileContext,
  TranspileOptions,
  TranspileResult,
  TranspiledFile,
  createContext,
} from './context.js'
import { transpileExpression } from './expressions.js'
import {
  transpileStatement,
  transpileModuleDeclaration,
  transpileFunctionDeclaration,
} from './statements.js'
import { getModuleName } from './builtins.js'

// Re-export types for public API
export type { FileResolver, TranspileOptions, TranspileResult, TranspiledFile, UseImport } from './context.js'

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
 * Build JSCAD imports and helper functions
 */
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
