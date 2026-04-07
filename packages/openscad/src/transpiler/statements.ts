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
import { WarningCode } from './context.js'
import { generateScopeSuffix, withScope } from './scoping.js'
import { safeIdentifier, getShortFilename } from '../utils/identifiers.js'
import { transpileExpression, transpileCallArg, reorderNamedArgs, isFunctionLiteralExpr } from './expressions.js'
import { markTailCalls, clearTailCallMarks, buildBounceReassignment } from './tailCall.js'
import { getLocation } from '../parser/parse.js'
import {
  isBuiltinPrimitive,
  isBuiltinTransform,
  isBuiltinBoolean,
  isBuiltinExtrusion,
  transpileBuiltinPrimitive,
  transpileBuiltinTransform,
  transpileBuiltinExtrusion,
  shouldUseBuiltin,
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
  isLookupExpr,
} from './ast-types.js'
// isStackSpecialVar no longer used - all $-prefixed vars use dynamic scoping universally
import { deduplicateArgs, mapArgsToParams } from './utils.js'

/**
 * Set of dangerous property names that could cause prototype pollution
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Generate a source line comment if source comments are enabled
 */
function sourceComment(node: Statement | ModuleDeclarationStmt | FunctionDeclarationStmt, ctx: TranspileContext): string {
  if (!ctx.options.includeSourceComments) return ''

  const loc = getLocation(node)
  if (!loc) return ''

  const shortFilename = getShortFilename(ctx.options.currentFile)
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
      const suffix = generateScopeSuffix(ctx)
      const assignStrs: string[] = []
      const specialSaves: string[] = []
      const specialRestores: string[] = []

      // Use incremental scope: each assignment value sees only earlier assignments
      const incrementalScope = new Map<string, string>()

      // Track which special vars have been saved in this block (to avoid duplicate const)
      const savedSpecialVars = new Set<string>()

      // Build assignments and transpile geometry with scope
      const parts = withScope(ctx, incrementalScope, () => {
        for (const a of assignments) {
          const origName = safeIdentifier(a.name)
          // In OpenSCAD, ALL $-prefixed variables use dynamic scoping
          const isSpecial = a.name.startsWith('$')

          if (isSpecial) {
            // Special variable - save, set, and restore for dynamic scoping
            // This allows children to see the new value, but restores after block
            // Use stack-based getSpecialVar/setSpecialVar instead of bare variable references
            const savedName = `_saved_${origName.replace(/\$/g, '_')}${suffix}`
            const value = transpileExpression(a.value!, ctx)
            // Only save/restore once per special var (handles duplicate assignments like $fa=a; $fa=b)
            if (!savedSpecialVars.has(a.name)) {
              savedSpecialVars.add(a.name)
              specialSaves.push(`const ${savedName} = j$.getSpecialVar('${a.name}')`)
              specialRestores.push(`j$.setSpecialVar('${a.name}', ${savedName})`)
            }
            assignStrs.push(`j$.setSpecialVar('${a.name}', ${value})`)
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
        return geometryStmts.map(c => transpileStatement(c, ctx)).filter(Boolean) as string[]
      })

      // If we have special vars, we need try/finally to ensure restoration
      if (specialSaves.length > 0) {
        const allSaves = [...specialSaves, ...assignStrs.filter(s => s.startsWith('const '))].join('; ')
        const allSets = assignStrs.filter(s => !s.startsWith('const ')).join('; ')
        const allRestores = specialRestores.join('; ')
        const geometryExpr = parts.length === 0 ? 'undefined'
          : parts.length === 1 ? parts[0]
          : (ctx.codeGen.usedBooleans.add('union'), ctx.codeGen.usedHelpers.add('safeUnion'), `j$.safeUnion([${parts.join(', ')}])`)

        return `(() => { ${allSaves}; ${allSets}; try { return ${geometryExpr}; } finally { ${allRestores}; } })()`
      }

      if (parts.length === 0) {
        return `(() => { ${assignStrs.join('; ')}; return undefined })()`
      }
      if (parts.length === 1) {
        return `(() => { ${assignStrs.join('; ')}; return ${parts[0]} })()`
      }
      ctx.codeGen.usedBooleans.add('union')
      ctx.codeGen.usedHelpers.add('safeUnion')
      return `(() => { ${assignStrs.join('; ')}; return j$.safeUnion([\n    ${parts.join(',\n    ')}\n  ]) })()`
    }

    const parts = geometryStmts.map(c => transpileStatement(c, ctx)).filter(Boolean) as string[]
    if (parts.length === 0) return null

    if (parts.length === 1) return parts[0]
    ctx.codeGen.usedBooleans.add('union')
    ctx.codeGen.usedHelpers.add('safeUnion')
    return `j$.safeUnion([\n${parts.map(p => `  ${p}`).join(',\n')}\n])`
  }

  if (isIfElseStatement(stmt)) {
    // % (tagBackground) and * (tagDisabled) modifiers on if/else exclude the entire block
    if (stmt.tagBackground || stmt.tagDisabled) {
      return 'undefined'
    }
    const cond = transpileExpression(stmt.cond, ctx)
    const thenPart = transpileStatement(stmt.thenBranch, ctx) || 'undefined'
    const elsePart = stmt.elseBranch ? transpileStatement(stmt.elseBranch, ctx) : 'j$.NO_CHILD'
    ctx.codeGen.usedHelpers.add('isTruthy')
    const code = `(j$.isTruthy(${cond})) ? (${thenPart}) : (${elsePart})`
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

  // Helper: wrap code in a thunk, using async if the code contains await
  const makeThunk = (code: string) => {
    const asyncKw = code.includes('await ') ? 'async ' : ''
    return `${asyncKw}() => ${code}`
  }

  if (isBlockStmt(child)) {
    const assignments = child.children.filter(c => isAssignmentNode(c)) as AssignmentNode[]
    const hasSpecialAssignments = assignments.some(a => a.name.startsWith('$'))

    if (hasSpecialAssignments) {
      // Block has special variable assignments ($fn, $fa, etc.) - must transpile as a
      // single block (IIFE) to preserve dynamic scoping via the special var stack
      const code = transpileStatement(child, ctx)
      return code ? [makeThunk(code)] : []
    }

    if (assignments.length > 0) {
      // Block has regular (non-special) variable assignments.
      // Hoist them into an IIFE that returns the children ARRAY so that module
      // callers (e.g. xdistribute) still see each child as a separate entry.
      // This preserves variable scope without collapsing children into one thunk.
      const suffix = generateScopeSuffix(ctx)
      const assignStrs: string[] = []
      const incrementalScope = new Map<string, string>()

      const thunks = withScope(ctx, incrementalScope, () => {
        for (const a of assignments) {
          const origName = safeIdentifier(a.name)
          const newName = `${origName}${suffix}`
          const value = transpileExpression(a.value!, ctx)
          assignStrs.push(`const ${newName} = ${value}`)
          incrementalScope.set(origName, newName)
        }

        const result: string[] = []
        for (const c of child.children) {
          if (!isAssignmentNode(c) && !isNoopStmt(c as Statement)) {
            const code = transpileStatement(c as Statement, ctx)
            if (code) result.push(makeThunk(code))
          }
        }
        return result
      })

      if (thunks.length === 0) return []
      // Return children as a spread from an IIFE: [...(() => { const x=1; return [thunk1, thunk2] })()]
      return [`...(() => { ${assignStrs.join('; ')}; return [${thunks.join(', ')}] })()`]
    }

    // No assignments - collect individual statements as separate thunks
    const result: string[] = []
    for (const c of child.children) {
      if (!isNoopStmt(c as Statement)) {
        const code = transpileStatement(c as Statement, ctx)
        // Wrap in thunk for lazy evaluation
        if (code) result.push(makeThunk(code))
      }
    }
    return result
  }

  const code = transpileStatement(child, ctx)
  // Wrap in thunk for lazy evaluation
  return code ? [makeThunk(code)] : []
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
  ctx.codeGen.usedColors = true
  // color takes (colorName, alpha?) or ([r,g,b], alpha?)
  // When only 1 arg to color, alpha is undefined
  // Find color arg: named 'c' or first positional
  const colorArg = argsArray.find(a => a.name === 'c') || argsArray.find(a => !a.name)
  // Find alpha arg: named 'alpha' or second positional
  const alphaArg = argsArray.find(a => a.name === 'alpha') ||
    (() => {
      // Get second positional arg (skip first positional which is color)
      const positionalArgs = argsArray.filter(a => !a.name)
      return positionalArgs.length > 1 ? positionalArgs[1] : undefined
    })()
  const colorValue = colorArg?.value || '"gray"'
  const alphaValue = alphaArg?.value || 'undefined'
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
      const indexArg = argsArray.find(a => a.name === 'index' || !a.name)
      const indexExpr = indexArg?.value || '0'
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
  const { args: positionalArgs } = reorderNamedArgs(name, argsArray, ctx, 'function')
  const optionsArgs = transpileArgsAsOptions(name, argsArray, ctx)

  // Check if this is a LOCAL variable FIRST (no suffix needed)
  // Local variables include: let bindings, function params, local assignments
  // This must be checked BEFORE handling children to avoid adding _$m suffix
  const localBinding = ctx.scopes.lookupFunctionBinding(safeName)
  if (localBinding) {
    // Local variable - call directly using the registered binding name.
    // Usually localBinding === safeName, but when a nested module has the same name as a
    // variable (e.g., `module stack()` and `stack = ...`), the module gets a `_$m` suffix
    // so localBinding may be `stack_$m` while safeName is `stack`.
    // Nested modules use positional parameters, not object destructuring
    // If there are children, pass them via curried call (local modules are curried)
    if (childCode && childCode !== 'undefined') {
      const childrenArray = collectChildrenAsArray(stmt.child, ctx)
      if (childrenArray.length > 0) {
        const childrenArg = `[${childrenArray.join(', ')}]`
        return `${localBinding}(${positionalArgs})(${childrenArg})`
      }
    }
    // Local nested modules use curried pattern with positional args: module(arg1, arg2)()
    return `${localBinding}(${positionalArgs})()`
  }

  // If there are children, collect them as an array and pass via curried call
  if (childCode && childCode !== 'undefined') {
    const childrenArray = collectChildrenAsArray(stmt.child, ctx)
    if (childrenArray.length > 0) {
      const childrenArg = `[${childrenArray.join(', ')}]`
      // Curried call: module_$m({ options })(children)
      // Track as potential free ref if not locally bound.
      // Note: we intentionally do NOT check ctx.symbols.isDefined() here — 'inherited' symbols
      // must still be tracked so that canOptimizeInclude detects ambient include-scope refs.
      if (!ctx.scopes.lookupFunctionBinding(safeName)) {
        ctx.potentialFreeVarRefs.add(safeName)
      }
      return `${safeName}_$m(${optionsArgs})(${childrenArg})`
    }
  }

  // Determine if this is a function call vs module instantiation
  // Functions: called directly with _$f suffix, return values
  // Modules: curried pattern with _$m suffix, module(args)(children) returns geometry
  // Uses SymbolTable to check modules/functions from all sources
  const isKnownModule = ctx.symbols.isKind(name, 'module')
  const isKnownFunction = ctx.symbols.isKind(name, 'function')

  // Track as potential free ref if not locally bound.
  // Note: we intentionally do NOT check ctx.symbols.isDefined() here — 'inherited' symbols
  // must still be tracked so that canOptimizeInclude detects ambient include-scope refs.
  if (!ctx.scopes.lookupFunctionBinding(safeName)) {
    ctx.potentialFreeVarRefs.add(safeName)
  }

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
  _hasUserDefinedModule: boolean,  // Kept for API compatibility but unused
  ctx: TranspileContext
): string | null {
  // Use centralized shouldUseBuiltin logic (handles underscore-prefix and user overrides)
  const useBuiltin = shouldUseBuiltin(name, 'module', ctx)

  if (useBuiltin && isBuiltinPrimitive(name)) {
    return transpileBuiltinPrimitive(name, argsArray, ctx)
  }

  if (useBuiltin && isBuiltinTransform(name)) {
    return transpileBuiltinTransform(name, argsArray, childCode, ctx)
  }

  if (useBuiltin && isBuiltinBoolean(name)) {
    // Boolean ops need children passed directly, not as union
    return transpileBuiltinBoolean(name, stmt.child, ctx)
  }

  if (useBuiltin && isBuiltinExtrusion(name)) {
    return transpileBuiltinExtrusion(name, argsArray, childCode, ctx)
  }

  return null
}

/**
 * Transpile a module instantiation (e.g., cube(10), translate([1,2,3]) child)
 */
function transpileModuleInstantiation(stmt: ModuleInstantiationStmt, ctx: TranspileContext): string {
  const name = stmt.name

  // Handle OpenSCAD modifier characters:
  // % (tagBackground): ghost display - geometry excluded from output
  // * (tagDisabled): disabled - geometry excluded from output
  // # (tagHighlight): highlight display - geometry included (display-only difference)
  // ! (tagRoot): show only this subtree - geometry included
  if (stmt.tagBackground || stmt.tagDisabled) {
    return 'undefined'
  }

  // Special modules that don't follow the normal pattern
  if (name === 'for') return transpileForLoop(stmt, ctx)
  if (name === 'intersection_for') return transpileIntersectionForLoop(stmt, ctx)
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
  // render() forces CGAL rendering in OpenSCAD; in JSCAD we just pass children through
  if (name === 'render') return childCode || 'undefined'
  // import() loads external STL/DXF/SVG files — not supported, return undefined
  if (name === 'import') {
    ctx.warnings.push({ code: WarningCode.UNKNOWN_BUILTIN, message: 'import() is not supported', file: ctx.options.currentFile })
    return 'undefined'
  }
  if (name === 'hull') {
    const specialVarArgs = argsArray.filter(a => a.name && a.name.startsWith('$'))
    const hullCode = transpileBuiltinHull(stmt.child, ctx)
    if (specialVarArgs.length === 0) return hullCode
    // Wrap hull with special var scoping so children (e.g. sphere) see the right $fn/$fa/$fs
    const suffix = generateScopeSuffix(ctx)
    const saves = specialVarArgs.map(a => `const _sv${suffix}_${a.name!.replace(/\$/g, '_')} = j$.getSpecialVar('${a.name}')`)
    const sets = specialVarArgs.map(a => `j$.setSpecialVar('${a.name}', ${a.value})`)
    const restores = specialVarArgs.map(a => `j$.setSpecialVar('${a.name}', _sv${suffix}_${a.name!.replace(/\$/g, '_')})`)
    return `(() => { ${saves.join('; ')}; ${sets.join('; ')}; try { return ${hullCode}; } finally { ${restores.join('; ')}; } })()`
  }
  if (name === 'children') return transpileChildrenModule(stmt, argsArray, ctx)
  // offset() builtin - 2D path expansion. Only use builtin if user hasn't defined a MODULE named offset.
  // (BOSL2 defines offset as a function, not a module, so module calls still use the builtin.)
  if (name === 'offset' && shouldUseBuiltin('offset', 'module', ctx)) {
    // OpenSCAD offset() signature: offset(r, delta, chamfer=false)
    // Map positional args to their named equivalents to generate valid JS
    const offsetParamNames = ['r', 'delta', 'chamfer']
    let positionalIdx = 0
    const argsStr = argsArray.map(a => {
      if (a.name) return `${a.name}: ${a.value}`
      const paramName = offsetParamNames[positionalIdx++] || `_arg${positionalIdx - 1}`
      return `${paramName}: ${a.value}`
    }).join(', ')
    return `j$.offset({ ${argsStr} }, ${childCode || 'undefined'})`
  }

  // User-defined module/function call
  return transpileUserDefinedCall(stmt, argsArray, childCode, ctx)
}

/**
 * Transpile arguments list - returns array of {name, value} pairs
 */
function transpileArgsArray(args: AssignmentNode[], ctx: TranspileContext): Array<{name: string | null, value: string}> {
  return args.map(arg => ({
    name: arg.name || null,
    value: transpileCallArg(arg.value!, ctx)
  }))
}

/**
 * Transpile arguments as an options object: { name1: value1, name2: value2 }
 * This is the new calling convention for modules.
 *
 * For positional arguments without names, we map them to parameter names if available.
 * Special variables ($fn, $fa, $fs) are included in the options object.
 */
/**
 * Transpile arguments as an object literal for module instantiation.
 * Wrapper around mapArgsToParams for object format.
 */
function transpileArgsAsOptions(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext
): string {
  return mapArgsToParams(name, argsArray, ctx, 'object', 'module')
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
      const assignments = child.children.filter(c => isAssignmentNode(c)) as AssignmentNode[]

      if (assignments.length > 0) {
        // Block has local variable assignments — use IIFE with spread so that hull receives
        // separate geometry objects (hull(a,b) == hull(union(a,b)) but preserves intent).
        const suffix = generateScopeSuffix(ctx)
        const assignStrs: string[] = []
        const incrementalScope = new Map<string, string>()

        const geomCodes = withScope(ctx, incrementalScope, () => {
          for (const a of assignments) {
            const origName = safeIdentifier(a.name)
            const newName = `${origName}${suffix}`
            const value = transpileExpression(a.value!, ctx)
            assignStrs.push(`const ${newName} = ${value}`)
            incrementalScope.set(origName, newName)
          }
          return child.children
            .filter(c => !isAssignmentNode(c) && !isNoopStmt(c as Statement))
            .map(c => transpileStatement(c as Statement, ctx))
            .filter(Boolean) as string[]
        })

        if (geomCodes.length === 0) return 'undefined'
        ctx.codeGen.usedHulls = true
        return `j$.hull(\n  ...(() => { ${assignStrs.join('; ')}; return [${geomCodes.join(', ')}] })()\n)`
      }

      // No assignments — collect geometry children, skipping unsupported ones
      childCodes = child.children
        .filter(c => !isAssignmentNode(c) && !isNoopStmt(c as Statement))
        .map(c => transpileStatement(c as Statement, ctx))
        .filter(Boolean) as string[]
    } else {
      const code = transpileStatement(child, ctx)
      if (code) childCodes = [code]
    }
  }

  if (childCodes.length === 0) {
    return 'undefined'
  }

  ctx.codeGen.usedHulls = true
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

  // Helper: check if a name is a tuple pattern "(a, b)"
  const isTuple = (name: string) => name.startsWith('(') && name.endsWith(')')
  // Helper: parse tuple names "(a, b)" -> ["a", "b"]
  const parseTupleNames = (name: string) => name.slice(1, -1).split(',').map(s => s.trim())
  // Helper: convert tuple to JS destructuring "(a, b)" -> "[a, b]"
  const tupleToJS = (name: string) => `[${parseTupleNames(name).join(', ')}]`

  // Build scope for loop variables - they shadow any outer variables with the same name
  // The loop variables are used directly as arrow function parameters (no renaming needed)
  // For tuple-destructured variables, add each individual name
  const loopScope = new Map<string, string>()
  for (const arg of args) {
    if (isTuple(arg.name)) {
      for (const n of parseTupleNames(arg.name)) loopScope.set(n, n)
    } else {
      loopScope.set(arg.name, arg.name)
    }
  }

  // Transpile the body with loop variables in scope
  const body = withScope(ctx, loopScope, () =>
    stmt.child ? transpileStatement(stmt.child, ctx) || 'undefined' : 'undefined'
  )

  // Helper: wrap a loop iteration with j$.withScope for $-prefixed variables.
  // In OpenSCAD, $-prefixed for variables have dynamic scoping — children can access
  // them via j$.getSpecialVar(). Non-$-prefixed variables use normal lexical scoping.
  const wrapLoopVar = (varName: string, inner: string): string => {
    if (varName.startsWith('$')) {
      return `j$.withScope({'${varName}': ${varName}}, () => ${inner})`
    }
    return inner
  }

  // Handle single loop variable (most common case)
  if (args.length === 1) {
    const varName = isTuple(args[0].name) ? tupleToJS(args[0].name) : args[0].name
    const rangeOrVector = transpileExpression(args[0].value!, ctx)
    return `j$.union(...j$.iter(${rangeOrVector}).map(${varName} => ${wrapLoopVar(varName, body)}))`
  }

  // Multiple loop variables: for (i = [0:3], axis = [0:2]) { body }
  // Build nested flatMap/map: first vars use flatMap, last uses map
  // j$.iter() ensures scalar values are wrapped in an array for proper iteration
  let result = body
  for (let i = args.length - 1; i >= 0; i--) {
    const varName = isTuple(args[i].name) ? tupleToJS(args[i].name) : args[i].name
    const rangeOrVector = transpileExpression(args[i].value!, ctx)
    // Last variable uses map, all others use flatMap to flatten
    const method = i === args.length - 1 ? 'map' : 'flatMap'
    result = `j$.iter(${rangeOrVector}).${method}(${varName} => ${wrapLoopVar(varName, result)})`
  }
  return `j$.union(...${result})`
}

/**
 * Transpile 'intersection_for' — like for but intersects bodies instead of unioning.
 * intersection_for(i = [1:n]) { body } ≡ intersection() { for (i = [1:n]) { body } }
 */
function transpileIntersectionForLoop(stmt: ModuleInstantiationStmt, ctx: TranspileContext): string {
  const args = stmt.args
  if (!args || args.length === 0) {
    return '/* empty intersection_for loop */'
  }

  const isTuple = (name: string) => name.startsWith('(') && name.endsWith(')')
  const parseTupleNames = (name: string) => name.slice(1, -1).split(',').map(s => s.trim())
  const tupleToJS = (name: string) => `[${parseTupleNames(name).join(', ')}]`

  const loopScope = new Map<string, string>()
  for (const arg of args) {
    if (isTuple(arg.name)) {
      for (const n of parseTupleNames(arg.name)) loopScope.set(n, n)
    } else {
      loopScope.set(arg.name, arg.name)
    }
  }

  const body = withScope(ctx, loopScope, () =>
    stmt.child ? transpileStatement(stmt.child, ctx) || 'undefined' : 'undefined'
  )

  if (args.length === 1) {
    const varName = isTuple(args[0].name) ? tupleToJS(args[0].name) : args[0].name
    const rangeOrVector = transpileExpression(args[0].value!, ctx)
    return `j$.intersect(...j$.iter(${rangeOrVector}).map(${varName} => ${body}))`
  }

  let result = body
  for (let i = args.length - 1; i >= 0; i--) {
    const varName = isTuple(args[i].name) ? tupleToJS(args[i].name) : args[i].name
    const rangeOrVector = transpileExpression(args[i].value!, ctx)
    const method = i === args.length - 1 ? 'map' : 'flatMap'
    result = `j$.iter(${rangeOrVector}).${method}(${varName} => ${result})`
  }
  return `j$.intersect(...${result})`
}

/**
 * Transpile 'let' as a module instantiation (not expression)
 * let(x=5, y=10) { children } creates local bindings for the children scope
 *
 * Regular variables: IIFE parameters — ((x, y) => body)(val1, val2)
 * Special variables ($ghost_this, $fn, etc.): save/set/restore via j$.setSpecialVar()
 * because child modules read special vars through j$.getSpecialVar(), not JS scope.
 */
function transpileLetModule(stmt: ModuleInstantiationStmt, ctx: TranspileContext): string {
  const args = stmt.args
  if (!args || args.length === 0) {
    // let() with no bindings - just transpile the children
    return stmt.child ? transpileStatement(stmt.child, ctx) || 'undefined' : 'undefined'
  }

  // Separate special vars from regular vars.
  // In OpenSCAD, ALL $-prefixed variables use dynamic scoping — not just the known ones.
  const specialArgs = args.filter(a => a.name.startsWith('$'))
  const regularArgs = args.filter(a => !a.name.startsWith('$'))

  // Build scope for let bindings - they shadow any outer variables with the same name
  const letScope = new Map<string, string>()
  for (const arg of regularArgs) {
    letScope.set(arg.name, safeIdentifier(arg.name))
  }
  // Special vars are NOT added to letScope — they're read via j$.getSpecialVar by child modules

  // Transpile the body (children) with let bindings in scope
  const body = withScope(ctx, letScope, () =>
    stmt.child ? transpileStatement(stmt.child, ctx) || 'undefined' : 'undefined'
  )

  // Build chained IIFEs for sequential let bindings so each binding can reference previous ones.
  // e.g., let(l = leds[$i], b = f(l)) => (l => (b => body)(f(l)))(leds[$i])
  // This is necessary because argument evaluation in a multi-param call happens before binding,
  // which would make `b = f(l)` reference the outer `l` instead of the just-bound `l`.
  function wrapChainedLetIIFE(args: AssignmentNode[], innerBody: string, evalCtx: TranspileContext): string {
    if (args.length === 0) return innerBody
    // Build from right to left: innermost binding wraps the body, outermost wraps all
    let result = innerBody
    for (let i = args.length - 1; i >= 0; i--) {
      const a = args[i]
      const paramName = safeIdentifier(a.name)
      const argValue = transpileExpression(a.value!, evalCtx)
      result = `(${paramName} => ${result})(${argValue})`
    }
    return result
  }

  // If no special args, use chained IIFEs for regular args only
  if (specialArgs.length === 0) {
    if (regularArgs.length === 0) return body
    return wrapChainedLetIIFE(regularArgs, body, ctx)
  }

  // Special vars need save/set/restore so child modules see updated values via j$.getSpecialVar
  const suffix = generateScopeSuffix(ctx)
  const saves: string[] = []
  const sets: string[] = []
  const restores: string[] = []
  for (const a of specialArgs) {
    const savedName = `_sv${suffix}_${safeIdentifier(a.name).replace(/\$/g, '_')}`
    const value = transpileExpression(a.value!, ctx)
    saves.push(`const ${savedName} = j$.getSpecialVar('${a.name}')`)
    sets.push(`j$.setSpecialVar('${a.name}', ${value})`)
    restores.push(`j$.setSpecialVar('${a.name}', ${savedName})`)
  }

  // Wrap body in chained IIFEs for regular vars if any
  let innerBody: string
  if (regularArgs.length === 0) {
    innerBody = body
  } else {
    innerBody = wrapChainedLetIIFE(regularArgs, body, ctx)
  }

  return `(() => { ${saves.join('; ')}; ${sets.join('; ')}; try { return ${innerBody}; } finally { ${restores.join('; ')}; } })()`
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
 * Categorize module parameters into distinct types.
 *
 * Categories:
 * - regular: Normal parameters without $ prefix (e.g., a, size, center)
 * - userDollar: User-defined $ variables not in stack whitelist (e.g., $idx, $fn2)
 * - stackSpecial: System $ variables in stack whitelist (e.g., $fn, $fa, $fs)
 * - localVars: Combined regular + userDollar for convenience
 */
interface ParameterCategories {
  regular: AssignmentNode[]
  userDollar: AssignmentNode[]
  stackSpecial: AssignmentNode[]
  localVars: AssignmentNode[]
}

function categorizeParameters(args: AssignmentNode[]): ParameterCategories {
  const regular: AssignmentNode[] = []
  const userDollar: AssignmentNode[] = []
  const stackSpecial: AssignmentNode[] = []

  for (const arg of args) {
    if (!arg.name.startsWith('$')) {
      regular.push(arg)
    } else {
      // In OpenSCAD, ALL $-prefixed parameters use dynamic scoping
      stackSpecial.push(arg)
    }
  }

  return {
    regular,
    userDollar,
    stackSpecial,
    localVars: [...regular, ...userDollar],
  }
}

/**
 * Build destructuring pattern for local variables (regular + user $vars).
 * selfRefAliases: params whose default is the same identifier (e.g. `screw = screw`).
 * These are renamed in the destructure (e.g. `screw: _screw_alias$1`) so the outer
 * variable remains accessible (no TDZ) for use as the fallback default.
 */
function buildDestructurePattern(categories: ParameterCategories, ctx: TranspileContext, selfRefAliases: Map<string, string> = new Map()): string[] {
  const { localVars } = categories

  // Filter out dangerous parameter names and emit warnings
  const safeLocalVars = localVars.filter(arg => {
    if (DANGEROUS_KEYS.has(arg.name)) {
      ctx.warnings.push({
        code: WarningCode.DANGEROUS_PARAMETER_NAME,
        message: `Parameter name '${arg.name}' is reserved and will be skipped to prevent prototype pollution`,
        file: ctx.options.currentFile
      })
      return false
    }
    return true
  })

  if (safeLocalVars.length === 0) {
    return ['  const $$sv = _opts;']
  }

  // Build destructuring with quoted keys for user $vars, and renamed keys for self-ref params
  const destructureParts = safeLocalVars.map(arg => {
    if (arg.name.startsWith('$')) {
      const safeName = safeIdentifier(arg.name)
      return `'${arg.name}': ${safeName}`
    }
    const safeName = safeIdentifier(arg.name)
    const alias = selfRefAliases.get(safeName)
    if (alias) {
      // Rename in destructure: `screw: _screw_alias$1` so outer 'screw' stays accessible
      return `${safeName}: ${alias}`
    }
    return safeName
  })

  return [`  let { ${destructureParts.join(', ')}, ...$$sv } = _opts;`]
}

/**
 * Build EXPLICIT_UNDEF conversions and default value assignments.
 * Also adds _argN positional fallbacks for when callers didn't know param names.
 */
function buildLocalVarConversions(
  categories: ParameterCategories,
  ctx: TranspileContext,
  selfRefAliases: Map<string, string> = new Map()
): string[] {
  const lines: string[] = []

  // _argN positional fallback: when caller used _arg0/_arg1/... (didn't know param names),
  // map them to named params before applying defaults.
  // This happens when a module is called cross-file and the transpiler lacked its param list.
  if (categories.localVars.length > 0) {
    const varNames = categories.localVars.map(arg => {
      const name = safeIdentifier(arg.name)
      return selfRefAliases.get(name) ?? name
    })
    lines.push(`  [${varNames.join(', ')}] = j$.applyPositionalArgs(_opts, [${varNames.join(', ')}]);`)
  }

  // Resolve EXPLICIT_UNDEF and apply defaults in a single call.
  // For each param: if defined and not EXPLICIT_UNDEF, keep it; otherwise use the default.
  // Self-referencing params use the outer variable as default (alias → name fallback).
  if (categories.localVars.length > 0) {
    const varNames: string[] = []
    const defaults: string[] = []
    for (const arg of categories.localVars) {
      const name = safeIdentifier(arg.name)
      const alias = selfRefAliases.get(name)
      varNames.push(alias ?? name)
      if (alias) {
        // Self-referencing: default is the outer variable (still accessible because param was renamed)
        defaults.push(name)
      } else if (arg.value) {
        defaults.push(transpileExpression(arg.value, ctx))
      } else {
        defaults.push('undefined')
      }
    }
    lines.push(`  [${varNames.join(', ')}] = j$.resolveParams([${varNames.join(', ')}], [${defaults.join(', ')}]);`)
  }

  return lines
}

// Note: buildDeclaredStackUpdates and buildInheritedStackUpdates were removed
// Special variables are now passed directly to j$.withScope() in transpileModuleDeclaration()

/**
 * Build destructuring and default assignments for options-object style module parameters.
 * Returns lines to be inserted at the start of the module body, plus a flag indicating
 * if special variables need scoping.
 *
 * With explicit scoping, special vars are passed directly to j$.withScope() instead of
 * using pushScope/setSpecialVar/popScope pattern.
 *
 * Example output for module(a, b=5, c):
 *   let { a, b, c, ...$$sv } = _opts;
 *   if (a === j$.EXPLICIT_UNDEF) a = undefined;
 *   b = b !== undefined && b !== j$.EXPLICIT_UNDEF ? b : 5;
 *   // $$sv will be passed to j$.withScope() if hasSpecialVars is true
 */
function buildOptionsDestructuring(args: AssignmentNode[], ctx: TranspileContext, selfRefAliases: Map<string, string> = new Map()): { lines: string[], hasSpecialVars: boolean } {
  const uniqueArgs = deduplicateArgs(args)
  const categories = categorizeParameters(uniqueArgs)

  // We always use withScope($$sv) to pass through any special variables that
  // the caller might provide, even if not declared as parameters. This maintains
  // OpenSCAD semantics where special vars are implicitly passed to all modules.
  // Example: foo(x=20, $fn=32) passes $fn even if foo doesn't declare it
  const hasSpecialVars = true

  const lines = [
    ...buildDestructurePattern(categories, ctx, selfRefAliases),
    ...buildLocalVarConversions(categories, ctx, selfRefAliases),
    ...buildStackSpecialDefaults(categories, ctx),
  ]

  return { lines, hasSpecialVars }
}

/**
 * For stackSpecial parameters with default values (e.g., $fn=12 in anchor_arrow),
 * apply the default to $$sv if the caller didn't provide the value.
 *
 * This ensures OpenSCAD semantics: `module foo($fn=12)` shadows the ambient $fn
 * even when called without explicit $fn argument.
 */
function buildStackSpecialDefaults(categories: ParameterCategories, ctx: TranspileContext): string[] {
  const lines: string[] = []
  for (const arg of categories.stackSpecial) {
    if (arg.value) {
      const defaultVal = transpileExpression(arg.value, ctx)
      lines.push(`  if (!('${arg.name}' in $$sv)) $$sv = { ...$$sv, '${arg.name}': ${defaultVal} };`)
    }
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

  // Snapshot function bindings on entry so nested scopes can shadow outer bindings
  // without permanently losing them. Restored on exit instead of manual cleanup.
  const bindingsSnapshot = ctx.scopes.snapshotFunctionBindings()

  // Save outer currentLocalBindings and add this scope's params.
  // (transpileModuleDeclaration already added them for top-level modules; adding again is idempotent.)
  // This ensures the body expressions see params as locally bound, not free vars.
  const savedLocalBindings = ctx.currentLocalBindings
  ctx.currentLocalBindings = new Set(ctx.currentLocalBindings)
  for (const p of paramNames) ctx.currentLocalBindings.add(safeIdentifier(p))

  // Save outer localNestedModuleNames (will be restored on exit).
  const savedLocalNestedModuleNames = ctx.localNestedModuleNames
  ctx.localNestedModuleNames = new Set(ctx.localNestedModuleNames)

  // Pre-register function-valued variable assignments as known function literals.
  // This must happen BEFORE nested function transpilation so that function bodies
  // can recognize forward-referenced function-valued variables (e.g., `_dedup` uses
  // `_dedup_add_some` which is defined later in the same scope as a function literal).
  for (const a of assignments) {
    if (a.value && isFunctionLiteralExpr(a.value)) {
      const varName = safeIdentifier(a.name)
      ctx.scopes.registerFunctionBinding(varName, varName, true)
    }
  }

  // Process nested function definitions (these must come first so they can be used)
  // First pass: register ALL function names so mutual/forward references within this scope work.
  const funcVarNames = new Map<string, string>()
  for (const f of nestedFunctions) {
    const varName = safeIdentifier(f.name)
    // If a variable assignment or parameter in the same scope has the same name, use _$f suffix
    // to avoid a `const sex` conflict: nested function `sex` vs variable `sex`.
    // In OpenSCAD, function and variable namespaces are separate, so they coexist.
    const hasVarConflict = assignments.some(a => safeIdentifier(a.name) === varName) ||
      [...paramNames].some(p => safeIdentifier(p) === varName)
    const funcVarName = hasVarConflict ? varName + '_$f' : varName
    funcVarNames.set(f.name, funcVarName)
    ctx.scopes.registerFunctionBinding(varName, funcVarName)
    ctx.currentLocalBindings.add(varName)
    if (hasVarConflict) ctx.currentLocalBindings.add(funcVarName)
  }
  // Second pass: transpile each function body (all sibling names are now registered)
  for (const f of nestedFunctions) {
    const funcVarName = funcVarNames.get(f.name)!
    // Transpile nested function: add its params before transpiling BOTH defaults and body
    // (defaults can reference earlier params, e.g., function foo(x, y = x + 1))
    const savedForFunc = ctx.currentLocalBindings
    ctx.currentLocalBindings = new Set(ctx.currentLocalBindings)
    for (const a of f.definitionArgs) ctx.currentLocalBindings.add(safeIdentifier(a.name))
    const funcParams = transpileParamsList(f.definitionArgs, ctx)
    const safeParamNames = f.definitionArgs.map(a => safeIdentifier(a.name))

    // Apply TCO to self-tail-recursive local functions (same mechanism as top-level functions).
    // Without this, deeply recursive functions like _de_pairs or _travel overflow the JS stack.
    const isTailRecursive = f.definitionArgs.length > 0 && markTailCalls(f.name, f.expr)

    let funcCode: string
    if (isTailRecursive) {
      const savedTailCallParams = ctx._tailCallParamNames
      ctx._tailCallParamNames = safeParamNames
      const bouncedBody = transpileExpression(f.expr, ctx)
      ctx._tailCallParamNames = savedTailCallParams
      clearTailCallMarks()
      const paramDefaults = new Map<string, string>()
      for (const arg of f.definitionArgs) {
        const pName = safeIdentifier(arg.name)
        if (arg.value) paramDefaults.set(pName, transpileExpression(arg.value, ctx))
      }
      const reassign = buildBounceReassignment(safeParamNames, paramDefaults)
      funcCode = `${indent}const ${funcVarName} = (${funcParams}) => { while (true) { const _r = ${bouncedBody}; if (!_r || !_r.__bounce__) return _r; ${reassign}; } }`
    } else {
      const funcBody = transpileExpression(f.expr, ctx)
      funcCode = `${indent}const ${funcVarName} = (${funcParams}) => ${funcBody}`
    }
    ctx.currentLocalBindings = savedForFunc

    bodyParts.push(funcCode)
    // Only add the actual JS name to declaredVars so the variable gets a fresh const declaration.
    const hasVarConflict = funcVarName !== safeIdentifier(f.name)
    declaredVars.add(hasVarConflict ? f.name + '_$f' : f.name)
  }

  // Recursively process nested module definitions — two-pass like nested functions.
  // Pass 1: register ALL names so that forward/mutual references between sibling nested
  // modules resolve correctly (e.g., module head() calling module eyebrow() defined later).
  const moduleVarNames = new Map<string, string>()
  for (const m of nestedModules) {
    const varName = safeIdentifier(m.name)
    // If a variable assignment or parameter in the same scope has the same name, use _$m suffix
    // to avoid a `const colour` conflict: nested module `colour` vs parameter/variable `colour`.
    // In OpenSCAD, module and variable namespaces are separate, so they coexist.
    const hasVarConflict = assignments.some(a => safeIdentifier(a.name) === varName) ||
      [...paramNames].some(p => safeIdentifier(p) === varName)
    const moduleVarName = hasVarConflict ? varName + '_$m' : varName
    moduleVarNames.set(m.name, moduleVarName)
    ctx.scopes.registerFunctionBinding(varName, moduleVarName)
    ctx.currentLocalBindings.add(varName)
    ctx.localNestedModuleNames.add(varName)  // track for shouldUseBuiltin
    if (hasVarConflict) ctx.currentLocalBindings.add(moduleVarName)
  }
  // Pass 2: transpile each nested module body (all sibling names are now registered).
  for (const m of nestedModules) {
    const moduleVarName = moduleVarNames.get(m.name)!
    const varName = safeIdentifier(m.name)
    const hasVarConflict = moduleVarName !== varName
    // Nested module defaults are transpiled in the outer scope (current currentLocalBindings).
    // The recursive buildModuleBody call will handle adding the nested module's own params.
    const nestedParams = transpileParamsList(m.definitionArgs, ctx)
    const nestedParamNames = new Set<string>(m.definitionArgs.map(a => a.name))
    const nestedBodyParts = buildModuleBody(m.stmt, ctx, indent + '  ', nestedParamNames)
    // Curried: (params) => (_children) => body
    bodyParts.push(`${indent}const ${moduleVarName} = (${nestedParams}) => (_children = []) => {\n${nestedBodyParts.join('\n')}\n${indent}}`)
    // Only add to declaredVars using the actual JS name (with suffix if conflict exists).
    // If there's a var conflict, don't add m.name so the variable gets a fresh const declaration.
    declaredVars.add(hasVarConflict ? m.name + '_$m' : m.name)
  }

  // Local variable assignments
  // If a variable shadows a parameter or previous declaration, don't use 'const'
  // This handles OpenSCAD's pattern of reassigning parameters: cp = is_scalar(cp) ? ... : cp
  // Special variables use stack-based dynamic scoping via isStackSpecialVar()

  for (const a of assignments) {
    const varName = safeIdentifier(a.name)
    // In OpenSCAD, ALL $-prefixed variables use dynamic scoping
    const isSpecialVar = a.name.startsWith('$')

    // Check if this assignment is a function literal (for recursive self-reference support)
    // Function literals need binding registered BEFORE transpiling so recursive calls work
    // Non-function values need binding registered AFTER transpiling to avoid TDZ errors
    // (e.g., `path2d = path2d(path)` should call the global path2d_$f function)
    const isFuncLiteral = a.value && isFunctionLiteralExpr(a.value)

    if (isFuncLiteral) {
      // Register function binding BEFORE transpiling for recursion support
      // Mark as function literal so isFunctionLiteralExpr can recognize references to it
      ctx.scopes.registerFunctionBinding(varName, varName, true)
    }

    if (isSpecialVar) {
      // Special variables use stack-based dynamic scoping
      // Reads go through j$.getSpecialVar(), writes go through j$.setSpecialVar()
      const valueExpr = transpileExpression(a.value!, ctx)
      bodyParts.push(`${indent}j$.setSpecialVar('${a.name}', ${valueExpr});`)
    } else if (declaredVars.has(a.name)) {
      // Reassignment - don't use const
      bodyParts.push(`${indent}${varName} = ${transpileExpression(a.value!, ctx)}`)
    } else {
      // New variable - use const and track it
      bodyParts.push(`${indent}const ${varName} = ${transpileExpression(a.value!, ctx)}`)
      declaredVars.add(a.name)
      ctx.currentLocalBindings.add(varName)  // track for free-var detection
    }

    // For non-function values, register binding AFTER transpiling
    // This avoids TDZ errors like `path2d = path2d(path)` where the RHS call
    // should resolve to the global function, not the local variable.
    // Do NOT register as function binding if this variable shadows a known module/function:
    // in OpenSCAD, variable and module namespaces are SEPARATE, so a local variable `washer`
    // does not shadow the `washer()` module — `washer(x)` should still call the module.
    // We check both defined symbols (include/inherited) and param-only storage (use imports).
    // Also, if a nested module was renamed to varName_$m due to hasVarConflict, don't override
    // that binding — the module's rename should take precedence for call resolution.
    if (!isFuncLiteral) {
      const isKnownModuleOrFunc = ctx.symbols.isKind(varName, 'module')
        || ctx.symbols.isKind(varName, 'function')
        || ctx.symbols.getParams(varName, 'module') !== undefined
      const existingBinding = ctx.scopes.lookupFunctionBinding(varName)
      const hasRenamedModuleBinding = existingBinding !== undefined && existingBinding !== varName
      if (!isKnownModuleOrFunc && !hasRenamedModuleBinding) {
        ctx.scopes.registerFunctionBinding(varName, varName)
      }
    }
  }

  // Geometry expression (return statement)
  // Use j$.safeUnion to filter out undefined values from side-effect statements like assert
  const geomParts = geometryStmts.map(g => transpileStatement(g, ctx)).filter(Boolean) as string[]
  const returnExpr = geomParts.length === 0 ? 'undefined' :
    geomParts.length === 1 ? geomParts[0] :
    `j$.safeUnion([\n${indent}  ${geomParts.join(',\n' + indent + '  ')}\n${indent}])`
  if (geomParts.length > 1) ctx.codeGen.usedHelpers.add('safeUnion')

  // Special variable scoping is handled by j$.withScope() in the module wrapper (if special vars exist)
  bodyParts.push(`${indent}return ${returnExpr}`)

  // Restore function bindings to the pre-entry snapshot.
  // This cleans up all local registrations AND restores any outer-scope bindings
  // that were shadowed by same-name nested modules/functions (e.g., fern_ball inside fern_ball).
  ctx.scopes.restoreFunctionBindings(bindingsSnapshot)

  // Restore currentLocalBindings and localNestedModuleNames to outer scope
  ctx.currentLocalBindings = savedLocalBindings
  ctx.localNestedModuleNames = savedLocalNestedModuleNames

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

  // Detect self-referencing defaults: `module foo(screw = screw)` where the default
  // expression is the same identifier as the parameter. The `let { screw }` destructuring
  // would shadow the outer 'screw', making the default unavailable. Fix: rename the param
  // in the destructuring (screw → alias) and use the alias throughout the module body.
  const selfRefSuffix = generateScopeSuffix(ctx)
  const selfRefAliases = new Map<string, string>()  // original → alias
  for (const arg of stmt.definitionArgs) {
    if (arg.name.startsWith('$')) continue  // $-vars don't destructure the same way
    const paramName = safeIdentifier(arg.name)
    if (arg.value && isLookupExpr(arg.value) && safeIdentifier(arg.value.name) === paramName) {
      selfRefAliases.set(paramName, `_${paramName}_param${selfRefSuffix}`)
    }
  }

  // Add params to currentLocalBindings before transpiling body AND default values.
  // This prevents params from being falsely flagged as free variable references.
  // Both buildModuleBody and buildOptionsDestructuring transpile expressions that may
  // reference these params (e.g., cross-param defaults like `module foo(x, y = x + 1)`).
  const savedLocalBindings = ctx.currentLocalBindings
  ctx.currentLocalBindings = new Set(ctx.currentLocalBindings)
  for (const a of stmt.definitionArgs) ctx.currentLocalBindings.add(safeIdentifier(a.name))

  // Build body with self-referencing params mapped to their aliases in scope
  // This ensures body references (e.g., 'screw') use the alias ('_screw_param$17')
  const bodyParts = selfRefAliases.size > 0
    ? withScope(ctx, selfRefAliases, () => buildModuleBody(stmt.stmt, ctx, '    ', paramNames))
    : buildModuleBody(stmt.stmt, ctx, '    ', paramNames)

  // Build options destructuring preamble
  const { lines: optionsPreamble, hasSpecialVars } = buildOptionsDestructuring(stmt.definitionArgs, ctx, selfRefAliases)

  ctx.currentLocalBindings = savedLocalBindings

  const comment = sourceComment(stmt, ctx)

  // If the body contains async calls (e.g. text()), the inner lambda must be async
  const bodyStr = bodyParts.join('\n')
  const innerAsync = bodyStr.includes('await ') ? 'async ' : ''

  let code: string
  if (hasSpecialVars) {
    // Wrap body in j$.withScope() for special variable scoping
    // Indent preamble for withScope callback
    const indentedPreamble = optionsPreamble.map(line => '  ' + line)
    code = `${comment}var ${name}_$m = (_opts = {}) => ${innerAsync}(_children = []) => {
${indentedPreamble.join('\n')}
  return j$.withScope($$sv, ${innerAsync}() => {
${bodyParts.join('\n')}
  });
}`
  } else {
    // No special variables - simpler code without scope wrapper
    const indentedPreamble = optionsPreamble.map(line => '  ' + line)
    code = `${comment}var ${name}_$m = (_opts = {}) => ${innerAsync}(_children = []) => {
${indentedPreamble.join('\n')}
${bodyParts.join('\n')}
}`
  }

  // Track this declaration for AST-based bundling
  const paramNamesArray = stmt.definitionArgs.map(arg => arg.name)
  ctx.declarations.addModule(
    `${name}_$m`,
    code,
    stmt,
    paramNamesArray,
    {
      file: ctx.options.currentFile || 'input.scad',
      kind: 'local',
    }
  )

  return code
}

/**
 * Build preamble to convert j$.EXPLICIT_UNDEF parameters back to undefined.
 * This is needed because we use EXPLICIT_UNDEF to bypass JavaScript's default parameter
 * behavior, but once inside the function, we need real undefined for proper semantics.
 */
function buildUndefConversionPreamble(args: AssignmentNode[], selfRefRenames?: Map<string, string>): string {
  if (args.length === 0) return ''

  const uniqueArgs = deduplicateArgs(args)
  const names = uniqueArgs.map(arg => {
    const name = safeIdentifier(arg.name)
    return selfRefRenames?.get(name) ?? name
  })

  return `[${names.join(', ')}] = j$.resolveUndef(${names.join(', ')}); `
}

/**
 * Transpile a function declaration
 *
 * Generates TWO versions of each function:
 * 1. foo_$f(...) - positional parameters (backward compatible)
 * 2. foo_$f$obj({...}) - object parameters (for named argument calls)
 *
 * This avoids runtime detection which breaks with valid positional calls like foo({a:1}, 2)
 */
export function transpileFunctionDeclaration(stmt: FunctionDeclarationStmt, ctx: TranspileContext, nameOverride?: string): string {
  const name = nameOverride || safeIdentifier(stmt.name)
  const comment = sourceComment(stmt, ctx)
  // Register parameters as function bindings when there is no known user-defined or
  // built-in function with the same name. This allows function-literal parameters
  // (e.g., `func` in `_all_func(l, func)`) to be called directly as `func(x)` without
  // the _$f suffix. Parameters that share a name with a real function (e.g., `reverse`)
  // must NOT be registered — calling `reverse(arr)` should still resolve to `reverse_$f`.
  const paramBindings = stmt.definitionArgs
    .map(a => safeIdentifier(a.name))
    .filter(p => !ctx.symbols.isKind(p, 'function'))
  const paramBindingsSnapshot = ctx.scopes.snapshotFunctionBindings()
  for (const p of paramBindings) ctx.scopes.registerFunctionBinding(p, p)

  // Add params to currentLocalBindings for free-var detection (covers both body and defaults)
  const savedLocalBindings = ctx.currentLocalBindings
  ctx.currentLocalBindings = new Set(ctx.currentLocalBindings)
  for (const a of stmt.definitionArgs) ctx.currentLocalBindings.add(safeIdentifier(a.name))

  const body = transpileExpression(stmt.expr, ctx)
  ctx.scopes.restoreFunctionBindings(paramBindingsSnapshot)

  if (stmt.definitionArgs.length === 0) {
    ctx.currentLocalBindings = savedLocalBindings
    // No parameters - simple function (no object version needed)
    const code = `${comment}function ${name}_$f() { return ${body}; }`
    ctx.declarations.addFunction(
      `${name}_$f`,
      code,
      stmt,
      [],
      {
        file: ctx.options.currentFile || 'input.scad',
        kind: 'local',
      }
    )
    return code
  }

  const uniqueArgs = deduplicateArgs(stmt.definitionArgs)

  // Detect self-referencing defaults: `function f(x = x)` where the default is the same
  // identifier as the parameter. In JavaScript this causes TDZ. Fix by renaming the parameter
  // in the JS signature and using a scope mapping so body references use the renamed version.
  // Example: `function f(screw = screw)` becomes `function f(screw$p = screw) { ... }`
  // where the body's `screw` is mapped to `screw$p` via withScope.
  const suffix = generateScopeSuffix(ctx)
  const selfRefRenames = new Map<string, string>()  // original → renamed (e.g., 'screw' → 'screw$1')
  for (const arg of uniqueArgs) {
    const paramName = safeIdentifier(arg.name)
    if (arg.value && isLookupExpr(arg.value) && safeIdentifier(arg.value.name) === paramName) {
      selfRefRenames.set(paramName, `${paramName}${suffix}`)
    }
  }

  // Re-generate body with self-referencing params renamed (so they don't shadow the outer vars)
  let finalBody = selfRefRenames.size > 0
    ? withScope(ctx, selfRefRenames, () => transpileExpression(stmt.expr, ctx))
    : body

  // ── Tail-call optimization ─────────────────────────────────────────────────
  // Detect self-recursive calls in tail position. If found, re-transpile the body
  // with tail calls replaced by bounce objects, and wrap both variants with a while loop.
  // Skip for functions with self-referencing defaults (complex renaming interaction).
  const safeParamNames = uniqueArgs.map(a => safeIdentifier(a.name))
  const tailRecursive = selfRefRenames.size === 0 && markTailCalls(stmt.name, stmt.expr)

  if (tailRecursive) {
    // Re-transpile body with tail calls emitting bounce objects
    const savedTailCallParams = ctx._tailCallParamNames
    ctx._tailCallParamNames = safeParamNames
    finalBody = transpileExpression(stmt.expr, ctx)
    ctx._tailCallParamNames = savedTailCallParams

    // Clean up AST marks
    clearTailCallMarks()
  }

  // Generate positional version (existing behavior)
  // Build params with renamed self-referencing defaults
  const positionalParams = uniqueArgs.map(arg => {
    const paramName = safeIdentifier(arg.name)
    const renamedParam = selfRefRenames.get(paramName)
    if (renamedParam) {
      // Self-referencing default: rename param, use outer var as default
      // e.g., `screw$1 = screw` accesses outer 'screw' without TDZ
      return `${renamedParam} = ${paramName}`
    }
    if (arg.value) {
      const defaultVal = transpileExpression(arg.value, ctx)
      return `${paramName} = ${defaultVal}`
    }
    return paramName
  }).join(', ')

  const positionalPreamble = buildUndefConversionPreamble(uniqueArgs, selfRefRenames)

  let positionalCode: string
  if (tailRecursive) {
    // Build destructuring reassignment for bounce continuation:
    // ({n, r, angle = undefined, wedge = false} = _r.args)
    const paramDefaults = new Map<string, string>()
    for (const arg of uniqueArgs) {
      const pName = safeIdentifier(arg.name)
      if (arg.value) {
        paramDefaults.set(pName, transpileExpression(arg.value, ctx))
      }
    }
    const reassign = buildBounceReassignment(safeParamNames, paramDefaults)
    positionalCode = `${comment}function ${name}_$f(${positionalParams}) { ${positionalPreamble}while (true) { const _r = ${finalBody}; if (!_r || !_r.__bounce__) return _r; ${reassign}; } }`
  } else {
    positionalCode = `${comment}function ${name}_$f(${positionalParams}) { ${positionalPreamble}return ${finalBody}; }`
  }

  // Generate object version as thin delegation wrapper.
  // Destructure WITHOUT defaults so that missing args stay undefined (triggering
  // JS default params in _$f), while EXPLICIT_UNDEF passes through for _$f's preamble.
  const objectDestructureNames = uniqueArgs.map(arg => {
    const paramName = safeIdentifier(arg.name)
    const renamedParam = selfRefRenames.get(paramName)
    return renamedParam ?? paramName
  }).join(', ')

  // Build delegation call: _$f(a, b, c) using the (possibly renamed) param names
  const delegationArgs = uniqueArgs.map(arg => {
    const paramName = safeIdentifier(arg.name)
    return selfRefRenames.get(paramName) ?? paramName
  }).join(', ')

  ctx.currentLocalBindings = savedLocalBindings

  const objectCode = `function ${name}_$f$obj(_opts = {}) { let { ${objectDestructureNames} } = _opts; return ${name}_$f(${delegationArgs}); }`

  // Combine both versions
  const code = `${positionalCode}\n${objectCode}`

  // Track this declaration for AST-based bundling
  const paramNames = stmt.definitionArgs.map(arg => arg.name)
  ctx.declarations.addFunction(
    `${name}_$f`,
    code,
    stmt,
    paramNames,
    {
      file: ctx.options.currentFile || 'input.scad',
      kind: 'local',
    }
  )

  return code
}
