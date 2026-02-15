/**
 * Statement transpilation
 */

import type {
  Statement,
  Expression,
  AssignmentNode,
  ModuleInstantiationStmt,
  ModuleDeclarationStmt,
  FunctionDeclarationStmt,
} from 'openscad-parser'
import type { TranspileContext } from './context.js'
import { WarningCode, pushScope, popScope } from './context.js'
import { safeIdentifier } from '../utils/identifiers.js'
import { transpileExpression, reorderNamedArgs, isFunctionLiteralExpr } from './expressions.js'
import { getLocation } from '../parser/parse.js'
import {
  isBuiltinPrimitive,
  isBuiltinTransform,
  isBuiltinBoolean,
  isBuiltinExtrusion,
  transpileBuiltinPrimitive,
  transpileBuiltinTransform,
  transpileBuiltinExtrusion,
} from './builtins.js'
import {
  isModuleInstantiation,
  isBlockStmt,
  isIfElseStatement,
  isNoopStmt,
  isAssignmentNode,
  isModuleDeclaration,
  isFunctionDeclaration,
  isVectorExpr,
  getNodeTypeName,
} from './ast-types.js'
import { isStackSpecialVar } from './specialVars.js'
import { deduplicateArgs } from './utils.js'

/**
 * Generate a source line comment if source comments are enabled
 */
function sourceComment(node: Statement | ModuleDeclarationStmt | FunctionDeclarationStmt, ctx: TranspileContext): string {
  if (!ctx.options.includeSourceComments) return ''

  const loc = getLocation(node)
  if (!loc) return ''

  const filename = ctx.options.currentFile || 'input.scad'
  const shortFilename = filename.split('/').pop() || filename
  // Parser uses 0-indexed lines, but users expect 1-indexed
  return `// line ${loc.start.line + 1} in ${shortFilename}\n`
}

/**
 * Transpile a statement
 */
export function transpileStatement(stmt: Statement, ctx: TranspileContext): string | null {
  const comment = sourceComment(stmt, ctx)

  if (isModuleInstantiation(stmt)) {
    const code = transpileModuleInstantiation(stmt as ModuleInstantiationStmt, ctx)
    return comment ? `${comment}${code}` : code
  }

  if (isBlockStmt(stmt)) {
    // Extract assignments and geometry from the block
    const assignments: { name: string, value: Expression | null }[] = []
    const geometryStmts: Statement[] = []

    for (const child of stmt.children) {
      if (isAssignmentNode(child)) {
        assignments.push({ name: child.name, value: child.value })
      } else if (!isNoopStmt(child as Statement)) {
        geometryStmts.push(child as Statement)
      }
    }

    // Transpile geometry statements first
    // If there are assignments, we need to create an IIFE to scope them
    // Use suffixed names to avoid temporal dead zone when shadowing parameters
    // Special variables use stack-based dynamic scoping via isStackSpecialVar()
    if (assignments.length > 0) {
      const suffix = `$${ctx.letCounter++}`
      const assignStrs: string[] = []
      const specialSaves: string[] = []
      const specialRestores: string[] = []

      // Use incremental scope: each assignment value sees only earlier assignments
      const incrementalScope = new Map<string, string>()
      pushScope(ctx, incrementalScope)

      for (const a of assignments) {
        const origName = safeIdentifier(a.name)
        const isSpecial = isStackSpecialVar(a.name)

        if (isSpecial) {
          // Special variable - save, set, and restore for dynamic scoping
          // This allows children to see the new value, but restores after block
          // Use stack-based getSpecialVar/setSpecialVar instead of bare variable references
          const savedName = `_saved_${origName.replace(/\$/g, '_')}${suffix}`
          const value = transpileExpression(a.value!, ctx)
          specialSaves.push(`const ${savedName} = j$.getSpecialVar('${a.name}')`)
          assignStrs.push(`j$.setSpecialVar('${a.name}', ${value})`)
          specialRestores.push(`j$.setSpecialVar('${a.name}', ${savedName})`)
          // Don't add to incrementalScope - use the global
        } else {
          // Regular variable - use suffixed local scope
          const newName = `${origName}${suffix}`
          // Transpile value - scope lookup will find earlier assignments automatically
          const value = transpileExpression(a.value!, ctx)
          assignStrs.push(`const ${newName} = ${value}`)
          // Add this assignment to scope for subsequent assignments and geometry
          incrementalScope.set(origName, newName)
        }
      }

      // Transpile geometry statements with full scope
      const parts = geometryStmts.map(c => transpileStatement(c, ctx)).filter(Boolean) as string[]

      popScope(ctx)

      // If we have special vars, we need try/finally to ensure restoration
      if (specialSaves.length > 0) {
        const allSaves = [...specialSaves, ...assignStrs.filter(s => s.startsWith('const '))].join('; ')
        const allSets = assignStrs.filter(s => !s.startsWith('const ')).join('; ')
        const allRestores = specialRestores.join('; ')
        const geometryExpr = parts.length === 0 ? 'undefined'
          : parts.length === 1 ? parts[0]
          : (ctx.usedBooleans.add('union'), ctx.usedHelpers.add('safeUnion'), `j$.safeUnion([${parts.join(', ')}])`)

        return `(() => { ${allSaves}; ${allSets}; try { return ${geometryExpr}; } finally { ${allRestores}; } })()`
      }

      if (parts.length === 0) {
        return `(() => { ${assignStrs.join('; ')}; return undefined })()`
      }
      if (parts.length === 1) {
        return `(() => { ${assignStrs.join('; ')}; return ${parts[0]} })()`
      }
      ctx.usedBooleans.add('union')
      ctx.usedHelpers.add('safeUnion')
      return `(() => { ${assignStrs.join('; ')}; return j$.safeUnion([\n    ${parts.join(',\n    ')}\n  ]) })()`
    }

    const parts = geometryStmts.map(c => transpileStatement(c, ctx)).filter(Boolean) as string[]
    if (parts.length === 0) return null

    if (parts.length === 1) return parts[0]
    ctx.usedBooleans.add('union')
    ctx.usedHelpers.add('safeUnion')
    return `j$.safeUnion([\n${parts.map(p => `  ${p}`).join(',\n')}\n])`
  }

  if (isIfElseStatement(stmt)) {
    const cond = transpileExpression(stmt.cond, ctx)
    const thenPart = transpileStatement(stmt.thenBranch, ctx) || 'undefined'
    const elsePart = stmt.elseBranch ? transpileStatement(stmt.elseBranch, ctx) : 'undefined'
    const code = `(${cond}) ? (${thenPart}) : (${elsePart})`
    return comment ? `${comment}${code}` : code
  }

  if (isNoopStmt(stmt)) {
    return null
  }

  // Unsupported statement - add warning
  const stmtType = getNodeTypeName(stmt)
  ctx.warnings.push({
    code: WarningCode.UNSUPPORTED_STATEMENT,
    message: `Unsupported statement type: ${stmtType}`,
    file: ctx.options.currentFile,
  })
  return `/* unsupported statement: ${stmtType} */`
}

/**
 * Collect children as an array of thunks (lazy expressions)
 * Used for passing children to user-defined modules.
 *
 * Children are wrapped in thunks (() => expr) to defer their evaluation
 * until children() is called inside the parent module. This ensures
 * special variables like $parent_geom are set before children execute.
 * (OpenSCAD's dynamic scoping semantics)
 *
 * When a block has assignments (especially special variables), we keep the
 * block as a single thunk that includes the assignments. This preserves
 * OpenSCAD's behavior where `multmatrix(m) { $parent_geom = geom; children(); }`
 * sets $parent_geom before evaluating children().
 */
export function collectChildrenAsArray(child: Statement | null, ctx: TranspileContext): string[] {
  if (!child) return []

  if (isBlockStmt(child)) {
    // Check if the block has any assignments (including special variable assignments)
    const hasAssignments = child.children.some(c => isAssignmentNode(c))

    if (hasAssignments) {
      // Block has assignments - transpile as a single block (IIFE) to preserve
      // the assignment context for special variables like $parent_geom
      const code = transpileStatement(child, ctx)
      return code ? [`() => ${code}`] : []
    }

    // No assignments - collect individual statements as separate thunks
    const result: string[] = []
    for (const c of child.children) {
      if (!isNoopStmt(c as Statement)) {
        const code = transpileStatement(c as Statement, ctx)
        // Wrap in thunk for lazy evaluation
        if (code) result.push(`() => ${code}`)
      }
    }
    return result
  }

  const code = transpileStatement(child, ctx)
  // Wrap in thunk for lazy evaluation
  return code ? [`() => ${code}`] : []
}

/**
 * Transpile echo() module - outputs to console but returns undefined (no geometry)
 */
function transpileEchoModule(
  stmt: ModuleInstantiationStmt,
  ctx: TranspileContext
): string {
  const args = stmt.args.map(a => transpileExpression(a.value!, ctx)).join(', ')
  return `(console.log(${args}), undefined)`
}

/**
 * Transpile assert() module - check condition and throw if false
 * In OpenSCAD, `assert(cond, msg) statement;` is valid - statement is child of assert
 */
function transpileAssertModule(
  stmt: ModuleInstantiationStmt,
  ctx: TranspileContext
): string {
  const condition = stmt.args.length > 0 ? transpileExpression(stmt.args[0].value!, ctx) : 'true'
  const message = stmt.args.length > 1 ? transpileExpression(stmt.args[1].value!, ctx) : '"Assertion failed"'
  // If assert has a child statement, execute it after the assertion
  if (stmt.child) {
    const childCode = transpileStatement(stmt.child, ctx)
    return `(console.assert(${condition}, ${message}), ${childCode || 'undefined'})`
  }
  return `(console.assert(${condition}, ${message}), undefined)`
}

/**
 * Transpile color() module - wraps children with color transform
 */
function transpileColorModule(
  argsArray: Array<{name: string | null, value: string}>,
  childCode: string | null,
  ctx: TranspileContext
): string {
  ctx.usedColors = true
  // color takes (colorName, alpha?) or ([r,g,b], alpha?)
  // When only 1 arg to color, alpha is undefined
  const colorValue = argsArray[0]?.value || '"gray"'
  const alphaValue = argsArray[1]?.value || 'undefined'
  return `j$.color(${colorValue}, ${alphaValue}, ${childCode || 'undefined'})`
}

/**
 * Transpile children() module - access children passed to current module
 * Children are passed as thunks (lazy functions) to ensure proper scoping
 * of special variables like $parent_geom. We call the thunks here.
 */
function transpileChildrenModule(
  stmt: ModuleInstantiationStmt,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext
): string {
  // children() with no args returns all children as union
  // children(n) returns the nth child
  // children([indices...]) returns union of specified children
  if (argsArray.length === 0) {
    // All children: union of _children array (call each thunk)
    // Use safeUnion to handle cases where some children return undefined (e.g., conditional geometry)
    return `(_children.length === 0 ? undefined : _children.length === 1 ? _children[0]() : j$.safeUnion(_children.map(_c => _c())))`
  } else {
    // Indexed access - check if argument is a vector (array of indices) or simple index
    const arg = stmt.args[0]
    const argValue = arg.value

    if (argValue && isVectorExpr(argValue)) {
      // Array of indices: children([0, 2, 3]) → union children at those indices (call thunks)
      // Use safeUnion to handle cases where some children return undefined
      const indices = argValue.children.map(c => transpileExpression(c, ctx))
      return `j$.safeUnion([${indices.map(i => `_children[${i}]()`).join(', ')}])`
    } else {
      // Simple index: children(0) or children(i) → single child access (call thunk)
      const indexExpr = argsArray[0].value
      return `_children[${indexExpr}]()`
    }
  }
}

/**
 * Transpile a user-defined module or function call
 * Handles suffix selection (_$m vs _$f), local variables, and children passing
 */
function transpileUserDefinedCall(
  stmt: ModuleInstantiationStmt,
  argsArray: Array<{name: string | null, value: string}>,
  childCode: string | null,
  ctx: TranspileContext
): string {
  const name = stmt.name

  // Apply safeIdentifier to handle reserved keywords (like 'let')
  const safeName = safeIdentifier(name)

  // Build arguments in both formats:
  // - positionalArgs: for function calls (backward compat)
  // - optionsArgs: for module calls (new pattern)
  const positionalArgs = reorderNamedArgs(name, argsArray, ctx)
  const optionsArgs = transpileArgsAsOptions(name, argsArray, ctx)

  // Check if this is a LOCAL variable FIRST (no suffix needed)
  // Local variables include: let bindings, function params, local assignments
  // This must be checked BEFORE handling children to avoid adding _$m suffix
  const isLocalVariable = ctx.localFunctionBindings.has(safeName)
  if (isLocalVariable) {
    // Local variable - call directly without any suffix
    // If there are children, pass them via curried call (local modules are curried)
    if (childCode && childCode !== 'undefined') {
      const childrenArray = collectChildrenAsArray(stmt.child, ctx)
      if (childrenArray.length > 0) {
        const childrenArg = `[${childrenArray.join(', ')}]`
        return `${safeName}(${optionsArgs})(${childrenArg})`
      }
    }
    return `${safeName}(${optionsArgs})`
  }

  // If there are children, collect them as an array and pass via curried call
  if (childCode && childCode !== 'undefined') {
    const childrenArray = collectChildrenAsArray(stmt.child, ctx)
    if (childrenArray.length > 0) {
      const childrenArg = `[${childrenArray.join(', ')}]`
      // Curried call: module_$m({ options })(children)
      return `${safeName}_$m(${optionsArgs})(${childrenArg})`
    }
  }

  // Determine if this is a function call vs module instantiation
  // Functions: called directly with _$f suffix, return values
  // Modules: curried pattern with _$m suffix, module(args)(children) returns geometry
  // Uses SymbolTable to check modules/functions from all sources
  const isKnownModule = ctx.symbols.isKind(name, 'module')
  const isKnownFunction = ctx.symbols.isKind(name, 'function')

  // Only use _$f suffix if it's EXCLUSIVELY a function (not also a module from any source)
  // Functions still use positional args for backward compatibility
  if (isKnownFunction && !isKnownModule) {
    return `${safeName}_$f(${positionalArgs})`
  }

  // Module call with no children: use curried pattern with _$m suffix and options object
  return `${safeName}_$m(${optionsArgs})()`
}

/**
 * Dispatch to builtin handlers if applicable
 * Returns the transpiled code if it's a builtin, or null if not
 */
function tryDispatchBuiltin(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  childCode: string | null,
  stmt: ModuleInstantiationStmt,
  hasUserDefinedModule: boolean,
  ctx: TranspileContext
): string | null {
  // Underscore-prefixed builtins (like _multmatrix, _translate) ALWAYS
  // use the builtin handler - these are BOSL2's way of calling real builtins
  const isUnderscorePrefixed = name.startsWith('_')

  if ((!hasUserDefinedModule || isUnderscorePrefixed) && isBuiltinPrimitive(name)) {
    return transpileBuiltinPrimitive(name, argsArray, ctx)
  }

  if ((!hasUserDefinedModule || isUnderscorePrefixed) && isBuiltinTransform(name)) {
    return transpileBuiltinTransform(name, argsArray, childCode, ctx)
  }

  if ((!hasUserDefinedModule || isUnderscorePrefixed) && isBuiltinBoolean(name)) {
    // Boolean ops need children passed directly, not as union
    return transpileBuiltinBoolean(name, stmt.child, ctx)
  }

  if ((!hasUserDefinedModule || isUnderscorePrefixed) && isBuiltinExtrusion(name)) {
    return transpileBuiltinExtrusion(name, argsArray, childCode, ctx)
  }

  return null
}

/**
 * Transpile a module instantiation (e.g., cube(10), translate([1,2,3]) child)
 */
function transpileModuleInstantiation(stmt: ModuleInstantiationStmt, ctx: TranspileContext): string {
  const name = stmt.name

  // Special modules that don't follow the normal pattern
  if (name === 'for') return transpileForLoop(stmt, ctx)
  if (name === 'let') return transpileLetModule(stmt, ctx)
  if (name === 'echo') return transpileEchoModule(stmt, ctx)
  if (name === 'assert') return transpileAssertModule(stmt, ctx)

  // Prepare common data needed by most handlers
  const argsArray = transpileArgsArray(stmt.args, ctx)
  const childCode = stmt.child ? transpileStatement(stmt.child, ctx) : null
  const hasUserDefinedModule = ctx.symbols.isKind(name, 'module')

  // Try builtin dispatch (primitives, transforms, booleans, extrusions)
  const builtinResult = tryDispatchBuiltin(name, argsArray, childCode, stmt, hasUserDefinedModule, ctx)
  if (builtinResult !== null) return builtinResult

  // Special modules
  if (name === 'color') return transpileColorModule(argsArray, childCode, ctx)
  if (name === 'hull') return transpileBuiltinHull(stmt.child, ctx)
  if (name === 'children') return transpileChildrenModule(stmt, argsArray, ctx)

  // User-defined module/function call
  return transpileUserDefinedCall(stmt, argsArray, childCode, ctx)
}

/**
 * Transpile arguments list - returns array of {name, value} pairs
 */
function transpileArgsArray(args: AssignmentNode[], ctx: TranspileContext): Array<{name: string | null, value: string}> {
  return args.map(arg => ({
    name: arg.name || null,
    value: transpileExpression(arg.value!, ctx)
  }))
}

/**
 * Transpile arguments as an options object: { name1: value1, name2: value2 }
 * This is the new calling convention for modules.
 *
 * For positional arguments without names, we map them to parameter names if available.
 * Special variables ($fn, $fa, $fs) are included in the options object.
 */
function transpileArgsAsOptions(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext
): string {
  if (argsArray.length === 0) return '{}'

  // Get parameter list to map positional args to names (from SymbolTable)
  const paramList = ctx.symbols.getParams(name, 'module') || ctx.symbols.getParams(name, 'function') || []

  const entries: string[] = []
  let positionalIndex = 0
  const usedNames = new Set<string>()

  for (const arg of argsArray) {
    if (arg.name) {
      // Named argument - use directly
      const safeName = safeIdentifier(arg.name)
      // Special variables need to be quoted if they start with $
      const key = arg.name.startsWith('$') ? `'${arg.name}'` : safeName
      entries.push(`${key}: ${arg.value}`)
      usedNames.add(arg.name)
    } else {
      // Positional argument - map to parameter name
      while (positionalIndex < paramList.length && usedNames.has(paramList[positionalIndex])) {
        positionalIndex++
      }
      if (positionalIndex < paramList.length) {
        const paramName = paramList[positionalIndex]
        const safeName = safeIdentifier(paramName)
        const key = paramName.startsWith('$') ? `'${paramName}'` : safeName
        entries.push(`${key}: ${arg.value}`)
        usedNames.add(paramName)
        positionalIndex++
      } else {
        // No param name available, use index as fallback (shouldn't happen often)
        entries.push(`_arg${positionalIndex}: ${arg.value}`)
        positionalIndex++
      }
    }
  }

  // Note: inherited special vars are handled by the stack - no need to inject here

  return `{ ${entries.join(', ')} }`
}

/**
 * Transpile built-in boolean operation
 */
function transpileBuiltinBoolean(name: string, child: Statement | null, ctx: TranspileContext): string {
  // Extract children from BlockStmt for boolean operations
  let childCodes: string[] = []
  const assignments: { name: string, value: Expression | null }[] = []

  if (child) {
    if (isBlockStmt(child)) {
      for (const c of child.children) {
        if (isAssignmentNode(c)) {
          assignments.push({ name: c.name, value: c.value })
        } else if (!isNoopStmt(c as Statement)) {
          const code = transpileStatement(c as Statement, ctx)
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

  // Build the boolean operation - use j$ namespace to avoid conflicts with user-defined modules
  let boolOp: string

  switch (name) {
    case 'union':
      boolOp = `j$.union(\n  ${args}\n)`
      break

    case 'difference':
      boolOp = `j$.subtract(\n  ${args}\n)`
      break

    case 'intersection':
      boolOp = `j$.intersect(\n  ${args}\n)`
      break

    case 'minkowski':
      boolOp = `j$.minkowski(\n  ${args}\n)`
      break

    default:
      return `/* unknown boolean: ${name} */`
  }

  // If there are assignments, wrap in IIFE
  if (assignments.length > 0) {
    const assignStrs = assignments.map(a => `const ${a.name} = ${transpileExpression(a.value!, ctx)}`)
    return `(() => { ${assignStrs.join('; ')}; return ${boolOp} })()`
  }

  return boolOp
}

/**
 * Transpile built-in hull operation
 */
function transpileBuiltinHull(child: Statement | null, ctx: TranspileContext): string {
  // Extract children from BlockStmt for hull operations
  // Hull takes multiple geometries as separate arguments
  let childCodes: string[] = []

  if (child) {
    if (isBlockStmt(child)) {
      childCodes = child.children.map(c => transpileStatement(c as Statement, ctx)).filter(Boolean) as string[]
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
  // Use runtime helper to avoid conflict with user-defined hull functions
  return `j$.hull(\n  ${args}\n)`
}

/**
 * Transpile a for loop to a union of mapped geometries
 * for (i = [0:10]) { cube(i); } becomes:
 * union(..._range(0, 10).map(i => cube(i)))
 *
 * for (i = [0:3], axis = [0:2]) { body } becomes:
 * union(..._range(0, 3).flatMap(i => _range(0, 2).map(axis => body)))
 */
function transpileForLoop(stmt: ModuleInstantiationStmt, ctx: TranspileContext): string {
  const args = stmt.args
  if (!args || args.length === 0) {
    return '/* empty for loop */'
  }

  // Build scope for loop variables - they shadow any outer variables with the same name
  // The loop variables are used directly as arrow function parameters (no renaming needed)
  const loopScope = new Map<string, string>()
  for (const arg of args) {
    loopScope.set(arg.name, arg.name)
  }

  // Push scope so body sees loop variables with their original names
  pushScope(ctx, loopScope)

  // Transpile the body with loop variables in scope
  const body = stmt.child ? transpileStatement(stmt.child, ctx) || 'undefined' : 'undefined'

  // Pop the scope
  popScope(ctx)

  // Handle single loop variable (most common case)
  if (args.length === 1) {
    const varName = args[0].name
    const rangeOrVector = transpileExpression(args[0].value!, ctx)
    return `j$.union(...${rangeOrVector}.map(${varName} => ${body}))`
  }

  // Multiple loop variables: for (i = [0:3], axis = [0:2]) { body }
  // Build nested flatMap/map: first vars use flatMap, last uses map
  let result = body
  for (let i = args.length - 1; i >= 0; i--) {
    const varName = args[i].name
    const rangeOrVector = transpileExpression(args[i].value!, ctx)
    // Last variable uses map, all others use flatMap to flatten
    const method = i === args.length - 1 ? 'map' : 'flatMap'
    result = `${rangeOrVector}.${method}(${varName} => ${result})`
  }
  return `j$.union(...${result})`
}

/**
 * Transpile 'let' as a module instantiation (not expression)
 * let(x=5, y=10) { children } creates local bindings for the children scope
 *
 * Transpiles to an IIFE: ((x, y) => children)(5, 10)
 */
function transpileLetModule(stmt: ModuleInstantiationStmt, ctx: TranspileContext): string {
  const args = stmt.args
  if (!args || args.length === 0) {
    // let() with no bindings - just transpile the children
    return stmt.child ? transpileStatement(stmt.child, ctx) || 'undefined' : 'undefined'
  }

  // Build scope for let bindings - they shadow any outer variables with the same name
  const letScope = new Map<string, string>()
  for (const arg of args) {
    letScope.set(arg.name, safeIdentifier(arg.name))
  }

  // Push scope so body sees let bindings
  pushScope(ctx, letScope)

  // Transpile the body (children) with let bindings in scope
  const body = stmt.child ? transpileStatement(stmt.child, ctx) || 'undefined' : 'undefined'

  // Pop the scope
  popScope(ctx)

  // Build parameter list and argument list
  const paramNames = args.map(a => safeIdentifier(a.name))
  const argValues = args.map(a => transpileExpression(a.value!, ctx))

  // Create IIFE: ((x, y) => body)(val1, val2)
  return `((${paramNames.join(', ')}) => ${body})(${argValues.join(', ')})`
}

/**
 * Transpile parameter list with defaults - regular function style
 * Handles duplicate parameter names by keeping only the last occurrence
 * (OpenSCAD allows this; JavaScript strict mode doesn't)
 */
export function transpileParamsList(args: AssignmentNode[], ctx: TranspileContext): string {
  if (args.length === 0) return ''

  const uniqueArgs = deduplicateArgs(args)

  const params = uniqueArgs.map(arg => {
    const name = safeIdentifier(arg.name)
    if (arg.value) {
      const defaultVal = transpileExpression(arg.value, ctx)
      return `${name} = ${defaultVal}`
    }
    return name
  })

  return params.join(', ')
}

/**
 * Build destructuring and default assignments for options-object style module parameters.
 * Returns lines to be inserted at the start of the module body.
 *
 * Uses stack-based dynamic scoping for special variables ($fn, $fa, $fs, etc.)
 * - Special vars from options are set on the scope stack
 * - pushScope() is called before this, popScope() after body (in transpileModuleDeclaration)
 *
 * Example output for module(a, b=5, c):
 *   let { a, b, c, ...$$sv } = _opts;
 *   if (a === j$.EXPLICIT_UNDEF) a = undefined;
 *   b = b !== undefined && b !== j$.EXPLICIT_UNDEF ? b : 5;
 *   if ($$sv['$fn'] !== undefined) j$.setSpecialVar('$fn', $$sv['$fn']);
 */
function buildOptionsDestructuring(args: AssignmentNode[], ctx: TranspileContext): string[] {
  const uniqueArgs = deduplicateArgs(args)

  const lines: string[] = []

  // Categorize parameters:
  // - regularArgs: no $ prefix - normal local variables
  // - systemSpecialArgs: $ prefix AND in stack whitelist (e.g., $fn, $fa, $fs) - use setSpecialVar()
  // - userDollarArgs: $ prefix but NOT in whitelist (e.g., $fn2, $idx) - user-defined local variables
  const regularArgs = uniqueArgs.filter(arg => !arg.name.startsWith('$'))
  const dollarArgs = uniqueArgs.filter(arg => arg.name.startsWith('$'))
  const systemSpecialArgs = dollarArgs.filter(arg => isStackSpecialVar(arg.name))
  const userDollarArgs = dollarArgs.filter(arg => !isStackSpecialVar(arg.name))

  // Build destructuring pattern for regular args and user-defined $vars, with rest for special vars
  const localVarArgs = [...regularArgs, ...userDollarArgs]
  if (localVarArgs.length > 0) {
    // For user $vars, we need quoted keys: { 'a': a, '$fn2': $fn2 }
    // But safeIdentifier converts $ to _ so we need to handle this specially
    const destructureParts = localVarArgs.map(arg => {
      if (arg.name.startsWith('$')) {
        // User-defined $var: need quoted key and renamed local var
        const safeName = safeIdentifier(arg.name) // $fn2 -> _fn2
        return `'${arg.name}': ${safeName}`
      }
      return safeIdentifier(arg.name)
    })
    lines.push(`  let { ${destructureParts.join(', ')}, ...$$sv } = _opts;`)
  } else {
    // No local args - just capture all special vars
    lines.push(`  const $$sv = _opts;`)
  }

  // Apply EXPLICIT_UNDEF conversions and defaults for all local variable args
  for (const arg of localVarArgs) {
    const name = safeIdentifier(arg.name)
    if (arg.value) {
      // Has default value
      const defaultVal = transpileExpression(arg.value, ctx)
      lines.push(`  ${name} = ${name} !== undefined && ${name} !== j$.EXPLICIT_UNDEF ? ${name} : ${defaultVal};`)
    } else {
      // No default - just convert EXPLICIT_UNDEF to undefined
      lines.push(`  if (${name} === j$.EXPLICIT_UNDEF) ${name} = undefined;`)
    }
  }

  // Handle system special variable parameters (e.g., $fn as a declared param with default)
  // No local variables needed - reads go through j$.getSpecialVar(), writes go through j$.setSpecialVar()
  for (const arg of systemSpecialArgs) {
    const varName = arg.name // e.g., '$fn'
    if (arg.value) {
      // Has default value: set on stack with fallback to default
      const defaultVal = transpileExpression(arg.value, ctx)
      lines.push(`  j$.setSpecialVar('${varName}', $$sv['${varName}'] !== undefined ? $$sv['${varName}'] : ${defaultVal});`)
    } else {
      // No default: set on stack only if provided
      lines.push(`  if ($$sv['${varName}'] !== undefined) j$.setSpecialVar('${varName}', $$sv['${varName}']);`)
    }
  }

  // Set common special vars on the stack if provided (even if not declared params)
  // These are the most commonly inherited: $fn, $fa, $fs
  const commonSpecialVars = ['$fn', '$fa', '$fs']
  for (const varName of commonSpecialVars) {
    // Skip if already handled as a declared param
    if (systemSpecialArgs.some(a => a.name === varName)) continue
    lines.push(`  if ($$sv['${varName}'] !== undefined) j$.setSpecialVar('${varName}', $$sv['${varName}']);`)
  }

  return lines
}

/**
 * Extract nested modules, assignments, and geometry statements from a module body
 */
export function extractModuleBody(stmt: Statement, _ctx: TranspileContext): {
  nestedModules: ModuleDeclarationStmt[],
  nestedFunctions: FunctionDeclarationStmt[],
  assignments: { name: string, value: Expression | null }[],
  geometryStmts: Statement[]
} {
  const nestedModules: ModuleDeclarationStmt[] = []
  const nestedFunctions: FunctionDeclarationStmt[] = []
  const assignments: { name: string, value: Expression | null }[] = []
  const geometryStmts: Statement[] = []

  if (!stmt) {
    return { nestedModules, nestedFunctions, assignments, geometryStmts }
  }

  if (isBlockStmt(stmt)) {
    for (const child of stmt.children) {
      if (isModuleDeclaration(child as Statement)) {
        nestedModules.push(child as ModuleDeclarationStmt)
      } else if (isFunctionDeclaration(child as Statement)) {
        nestedFunctions.push(child as FunctionDeclarationStmt)
      } else if (isAssignmentNode(child)) {
        assignments.push({ name: child.name, value: child.value })
      } else if (!isNoopStmt(child as Statement)) {
        geometryStmts.push(child as Statement)
      }
    }
  } else if (isAssignmentNode(stmt)) {
    assignments.push({ name: stmt.name, value: stmt.value })
  } else if (!isNoopStmt(stmt)) {
    geometryStmts.push(stmt)
  }

  return { nestedModules, nestedFunctions, assignments, geometryStmts }
}

/**
 * Recursively build the body of a module function, handling nested modules at any depth
 * @param paramNames - Set of parameter names from the parent function (to detect shadowing)
 */
export function buildModuleBody(moduleStmt: Statement, ctx: TranspileContext, indent: string = '  ', paramNames: Set<string> = new Set()): string[] {
  const { nestedModules, nestedFunctions, assignments, geometryStmts } = extractModuleBody(moduleStmt, ctx)
  const bodyParts: string[] = []
  // Track declared variables to detect reassignments
  const declaredVars = new Set<string>(paramNames)
  // Track local variable names for function call resolution (avoid _$f suffix for local vars)
  const localVarNames: string[] = []

  // Process nested function definitions (these must come first so they can be used)
  for (const f of nestedFunctions) {
    // Track as local function binding BEFORE transpiling body (for recursive calls)
    const varName = safeIdentifier(f.name)
    ctx.localFunctionBindings.set(varName, varName)
    localVarNames.push(varName)

    const funcParams = transpileParamsList(f.definitionArgs, ctx)
    const funcBody = transpileExpression(f.expr, ctx)
    bodyParts.push(`${indent}const ${f.name} = (${funcParams}) => ${funcBody}`)
    declaredVars.add(f.name)
  }

  // Recursively process nested module definitions
  for (const m of nestedModules) {
    // Track as local function binding BEFORE transpiling body (for recursive calls)
    const varName = safeIdentifier(m.name)
    ctx.localFunctionBindings.set(varName, varName)
    localVarNames.push(varName)

    const nestedParams = transpileParamsList(m.definitionArgs, ctx)
    const nestedParamNames = new Set<string>(m.definitionArgs.map(a => a.name))
    const nestedBodyParts = buildModuleBody(m.stmt, ctx, indent + '  ', nestedParamNames)
    // Curried: (params) => (_children) => body
    bodyParts.push(`${indent}const ${m.name} = (${nestedParams}) => (_children = []) => {\n${nestedBodyParts.join('\n')}\n${indent}}`)
    declaredVars.add(m.name)
  }

  // Local variable assignments
  // If a variable shadows a parameter or previous declaration, don't use 'const'
  // This handles OpenSCAD's pattern of reassigning parameters: cp = is_scalar(cp) ? ... : cp
  // Special variables use stack-based dynamic scoping via isStackSpecialVar()

  for (const a of assignments) {
    const varName = safeIdentifier(a.name)
    const isSpecialVar = isStackSpecialVar(a.name)

    // Check if this assignment is a function literal (for recursive self-reference support)
    // Function literals need binding registered BEFORE transpiling so recursive calls work
    // Non-function values need binding registered AFTER transpiling to avoid TDZ errors
    // (e.g., `path2d = path2d(path)` should call the global path2d_$f function)
    const isFuncLiteral = a.value && isFunctionLiteralExpr(a.value)

    if (isFuncLiteral) {
      // Register function binding BEFORE transpiling for recursion support
      ctx.localFunctionBindings.set(varName, varName)
      localVarNames.push(varName)
    }

    if (isSpecialVar) {
      // Special variables use stack-based dynamic scoping
      // Reads go through j$.getSpecialVar(), writes go through j$.setSpecialVar()
      const valueExpr = transpileExpression(a.value!, ctx)
      bodyParts.push(`${indent}j$.setSpecialVar('${a.name}', ${valueExpr});`)
    } else if (declaredVars.has(a.name)) {
      // Reassignment - don't use const
      bodyParts.push(`${indent}${a.name} = ${transpileExpression(a.value!, ctx)}`)
    } else {
      // New variable - use const and track it
      bodyParts.push(`${indent}const ${a.name} = ${transpileExpression(a.value!, ctx)}`)
      declaredVars.add(a.name)
    }

    // For non-function values, register binding AFTER transpiling
    // This avoids TDZ errors like `path2d = path2d(path)` where the RHS call
    // should resolve to the global function, not the local variable
    if (!isFuncLiteral) {
      ctx.localFunctionBindings.set(varName, varName)
      localVarNames.push(varName)
    }
  }

  // Geometry expression (return statement)
  // Use j$.safeUnion to filter out undefined values from side-effect statements like assert
  const geomParts = geometryStmts.map(g => transpileStatement(g, ctx)).filter(Boolean) as string[]
  const returnExpr = geomParts.length === 0 ? 'undefined' :
    geomParts.length === 1 ? geomParts[0] :
    `j$.safeUnion([\n${indent}  ${geomParts.join(',\n' + indent + '  ')}\n${indent}])`
  if (geomParts.length > 1) ctx.usedHelpers.add('safeUnion')

  // Special variable scoping is handled by pushScope/popScope in the module wrapper
  bodyParts.push(`${indent}return ${returnExpr}`)

  // Clean up local bindings (they're scoped to this module body)
  for (const name of localVarNames) {
    ctx.localFunctionBindings.delete(name)
  }

  return bodyParts
}

/**
 * Transpile a module declaration to JavaScript function
 * Uses curried function with options object pattern:
 *   module_$m({ param1: value1, param2: value2, $fn: 32 })([children])
 *
 * The options object pattern:
 * - Makes transpiled output more readable
 * - Properly passes special variables ($fn, $fa, $fs)
 * - Eliminates complex positional argument reordering
 */
export function transpileModuleDeclaration(stmt: ModuleDeclarationStmt, ctx: TranspileContext): string {
  const name = safeIdentifier(stmt.name)
  // Extract parameter names to detect shadowing assignments
  const paramNames = new Set<string>(stmt.definitionArgs.map(a => a.name))
  const bodyParts = buildModuleBody(stmt.stmt, ctx, '    ', paramNames)

  // Build options destructuring preamble
  const optionsPreamble = buildOptionsDestructuring(stmt.definitionArgs, ctx)
  // Indent preamble for try block
  const indentedPreamble = optionsPreamble.map(line => '  ' + line)

  // Curried: (_opts) => (_children) => body
  // Use _$m suffix for modules to separate from function namespace
  // Wrap in pushScope/try/finally/popScope for special var dynamic scoping
  const comment = sourceComment(stmt, ctx)
  return `${comment}const ${name}_$m = (_opts = {}) => (_children = []) => {
  j$.pushScope();
  try {
${indentedPreamble.join('\n')}
${bodyParts.join('\n')}
  } finally {
    j$.popScope();
  }
}`
}

/**
 * Build preamble to convert j$.EXPLICIT_UNDEF parameters back to undefined.
 * This is needed because we use EXPLICIT_UNDEF to bypass JavaScript's default parameter
 * behavior, but once inside the function, we need real undefined for proper semantics.
 */
function buildUndefConversionPreamble(args: AssignmentNode[]): string {
  if (args.length === 0) return ''

  const uniqueArgs = deduplicateArgs(args)

  const conversions = uniqueArgs.map(arg => {
    const name = safeIdentifier(arg.name)
    return `if (${name} === j$.EXPLICIT_UNDEF) ${name} = undefined`
  })

  return conversions.join('; ') + (conversions.length > 0 ? '; ' : '')
}

/**
 * Transpile a function declaration
 */
export function transpileFunctionDeclaration(stmt: FunctionDeclarationStmt, ctx: TranspileContext, nameOverride?: string): string {
  const name = nameOverride || safeIdentifier(stmt.name)
  const params = transpileParamsList(stmt.definitionArgs, ctx)
  const body = transpileExpression(stmt.expr, ctx)

  // Build preamble to convert EXPLICIT_UNDEF params to undefined
  const preamble = buildUndefConversionPreamble(stmt.definitionArgs)

  // Use function declaration (not arrow) for hoisting - critical for include bundling
  // Use _$f suffix for functions to separate from module namespace
  const comment = sourceComment(stmt, ctx)
  return `${comment}function ${name}_$f(${params}) { ${preamble}return ${body}; }`
}
