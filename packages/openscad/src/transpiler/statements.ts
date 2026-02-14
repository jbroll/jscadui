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
import { transpileExpression, reorderNamedArgs } from './expressions.js'
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

/**
 * Transpile a statement
 */
export function transpileStatement(stmt: Statement, ctx: TranspileContext): string | null {
  if (isModuleInstantiation(stmt)) {
    return transpileModuleInstantiation(stmt as ModuleInstantiationStmt, ctx)
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

    // Special variables that should be assigned globally (not locally scoped)
    // These use dynamic scoping in OpenSCAD - children inherit parent's values
    const blockSpecialVars = new Set([
      '$fn', '$fa', '$fs', '$t', '$vpr', '$vpt', '$vpd', '$vpf', '$preview',
      // BOSL2 attachment system variables
      '$transform', '$parent_anchor', '$parent_spin', '$parent_orient',
      '$parent_geom', '$parent_size', '$parent_parts', '$attach_to',
      '$attach_anchor', '$attach_alignment', '$attach_inside',
      '$tags', '$tag', '$save_tag', '$tag_prefix', '$overlap',
      '$color', '$save_color', '$anchor_override',
      '$edge_angle', '$edge_length', '$tags_shown', '$tags_hidden',
      '$ghost_this', '$ghost', '$ghosting', '$highlight_this', '$highlight',
      '$anchor_inside'
    ])

    // Transpile geometry statements first
    // If there are assignments, we need to create an IIFE to scope them
    // Use suffixed names to avoid temporal dead zone when shadowing parameters
    // EXCEPT for special variables which should be assigned globally
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
        const isSpecial = blockSpecialVars.has(a.name)

        if (isSpecial) {
          // Special variable - save, set, and restore for dynamic scoping
          // This allows children to see the new value, but restores after block
          const savedName = `_saved_${origName.replace(/\$/g, '_')}${suffix}`
          const value = transpileExpression(a.value!, ctx)
          specialSaves.push(`const ${savedName} = ${origName}`)
          assignStrs.push(`${origName} = ${value}`)
          specialRestores.push(`${origName} = ${savedName}`)
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
    return `(${cond}) ? (${thenPart}) : (${elsePart})`
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
 * Transpile a module instantiation (e.g., cube(10), translate([1,2,3]) child)
 */
function transpileModuleInstantiation(stmt: ModuleInstantiationStmt, ctx: TranspileContext): string {
  const name = stmt.name

  // Special handling for 'for' loops (parsed as ModuleInstantiationStmt)
  if (name === 'for') {
    return transpileForLoop(stmt, ctx)
  }

  // Special handling for 'let' module - creates local bindings for children
  // let(x=5, y=10) { children } → ((x, y) => children)(5, 10)
  if (name === 'let') {
    return transpileLetModule(stmt, ctx)
  }

  // echo() for debugging - outputs to console but returns undefined (no geometry)
  if (name === 'echo') {
    const args = stmt.args.map(a => transpileExpression(a.value!, ctx)).join(', ')
    return `(console.log(${args}), undefined)`
  }

  // assert(condition, message?) - check condition and throw if false
  // In OpenSCAD, `assert(cond, msg) statement;` is valid - statement is child of assert
  if (name === 'assert') {
    const condition = stmt.args.length > 0 ? transpileExpression(stmt.args[0].value!, ctx) : 'true'
    const message = stmt.args.length > 1 ? transpileExpression(stmt.args[1].value!, ctx) : '"Assertion failed"'
    // If assert has a child statement, execute it after the assertion
    if (stmt.child) {
      const childCode = transpileStatement(stmt.child, ctx)
      return `(console.assert(${condition}, ${message}), ${childCode || 'undefined'})`
    }
    return `(console.assert(${condition}, ${message}), undefined)`
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

  // Check if there's a user-defined module that should override builtins
  // This allows BOSL2's square(anchor=...) to override the builtin square
  // Check local definitions, direct imports, and modules from includes
  const hasUserDefinedModule = ctx.moduleNames.includes(name) ||
    ctx.importedModules.has(name) ||
    ctx.includedModuleNames.has(name)

  // Check if it's a built-in primitive/transform/boolean
  // ONLY use builtins if there's no user-defined module with the same name
  if (!hasUserDefinedModule && isBuiltinPrimitive(name)) {
    return transpileBuiltinPrimitive(name, argsArray, ctx)
  }

  if (!hasUserDefinedModule && isBuiltinTransform(name)) {
    return transpileBuiltinTransform(name, argsArray, childCode, ctx)
  }

  if (!hasUserDefinedModule && isBuiltinBoolean(name)) {
    // Boolean ops need children passed directly, not as union
    return transpileBuiltinBoolean(name, stmt.child, ctx)
  }

  if (!hasUserDefinedModule && isBuiltinExtrusion(name)) {
    return transpileBuiltinExtrusion(name, argsArray, childCode, ctx)
  }

  // Special modules
  if (name === 'color') {
    ctx.usedColors = true
    // color takes (colorName, alpha?) or ([r,g,b], alpha?)
    // When only 1 arg to color, alpha is undefined
    const colorValue = argsArray[0]?.value || '"gray"'
    const alphaValue = argsArray[1]?.value || 'undefined'
    return `j$.color(${colorValue}, ${alphaValue}, ${childCode || 'undefined'})`
  }

  if (name === 'hull') {
    // Hull needs children passed as separate args, not wrapped in union
    return transpileBuiltinHull(stmt.child, ctx)
  }

  // children() - access children passed to this module
  // Children are passed as thunks (lazy functions) to ensure proper scoping
  // of special variables like $parent_geom. We call the thunks here.
  if (name === 'children') {
    // children() with no args returns all children as union
    // children(n) returns the nth child
    // children([indices...]) returns union of specified children
    if (argsArray.length === 0) {
      // All children: union of _children array (call each thunk)
      return `(_children.length === 0 ? undefined : _children.length === 1 ? _children[0]() : j$.union(..._children.map(_c => _c())))`
    } else {
      // Indexed access - check if argument is a vector (array of indices) or simple index
      const arg = stmt.args[0]
      const argValue = arg.value

      if (argValue && isVectorExpr(argValue)) {
        // Array of indices: children([0, 2, 3]) → union children at those indices (call thunks)
        const indices = argValue.children.map(c => transpileExpression(c, ctx))
        return `j$.union(${indices.map(i => `_children[${i}]()`).join(', ')})`
      } else {
        // Simple index: children(0) or children(i) → single child access (call thunk)
        const indexExpr = argsArray[0].value
        return `_children[${indexExpr}]()`
      }
    }
  }

  // User-defined module/function - direct call (late binding)
  // Symbol is available if it's local or imported via use
  // Curried pattern: module(args)(children)

  // Apply safeIdentifier to handle reserved keywords (like 'let')
  const safeName = safeIdentifier(name)

  // Reorder named arguments to match parameter definition order
  const positionalArgs = reorderNamedArgs(name, argsArray, ctx)

  // Just emit a direct call - the symbol should be available from:
  // - Local module/function definitions
  // - Destructured imports from use statements

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
        return `${safeName}(${positionalArgs})(${childrenArg})`
      }
    }
    return `${safeName}(${positionalArgs})`
  }

  // If there are children, collect them as an array and pass via curried call
  if (childCode && childCode !== 'undefined') {
    const childrenArray = collectChildrenAsArray(stmt.child, ctx)
    if (childrenArray.length > 0) {
      const childrenArg = `[${childrenArray.join(', ')}]`
      // Curried call: module_$m(args)(children)
      return `${safeName}_$m(${positionalArgs})(${childrenArg})`
    }
  }

  // Determine if this is a function call vs module instantiation
  // Functions: called directly with _$f suffix, return values
  // Modules: curried pattern with _$m suffix, module(args)(children) returns geometry
  const isLocalFunction = ctx.functionNames.includes(name)
  const isLocalModule = ctx.moduleNames.includes(name)
  const isImportedFunction = ctx.importedFunctions.has(name)
  const isImportedModule = ctx.importedModules.has(name)

  if (isLocalFunction && !isLocalModule) {
    // Global function - use _$f suffix
    return `${safeName}_$f(${positionalArgs})`
  }

  if (isImportedFunction && !isImportedModule) {
    // Imported function - use _$f suffix
    return `${safeName}_$f(${positionalArgs})`
  }

  // Module call with no children: use curried pattern with _$m suffix
  return `${safeName}_$m(${positionalArgs})()`
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

  // Transpile the body
  const body = stmt.child ? transpileStatement(stmt.child, ctx) || 'undefined' : 'undefined'

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

  // Transpile the body (children)
  const body = stmt.child ? transpileStatement(stmt.child, ctx) || 'undefined' : 'undefined'

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

  // Deduplicate: keep last occurrence of each parameter name
  const seenNames = new Map<string, number>()
  args.forEach((arg, i) => seenNames.set(arg.name, i))
  const uniqueArgs = args.filter((arg, i) => seenNames.get(arg.name) === i)

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
  // Special variables ($fn, $fa, $fs, etc.) are declared with 'let' at top level
  // OpenSCAD special variables and BOSL2 attachment variables
  // These need special handling to avoid temporal dead zone when reassigned
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

  // Track which special variables are modified so we can restore them
  const modifiedSpecialVars: string[] = []

  for (const a of assignments) {
    // Track as local binding AFTER transpiling the value expression
    // This ensures that `path2d = path2d(path)` calls the global `path2d_$f` function,
    // not the local variable being assigned (which would cause a TDZ error).
    // Note: This differs from function definitions which add to localFunctionBindings
    // BEFORE transpiling to support recursion.
    const varName = safeIdentifier(a.name)
    const isSpecialVar = specialVars.has(a.name)

    if (isSpecialVar) {
      // Track that this special var is modified (for save/restore wrapping)
      if (!modifiedSpecialVars.includes(a.name)) {
        modifiedSpecialVars.push(a.name)
        // Save the original value BEFORE any modifications
        bodyParts.push(`${indent}const _saved${a.name} = ${a.name}`)
      }
      // Special variables are pre-declared with 'let' at module top level
      // When self-referencing (e.g., $fn = _default(rounding_fn, $fn)),
      // we need to use the saved value to avoid temporal dead zone
      const valueExpr = transpileExpression(a.value!, ctx)
      // Check if the expression contains a reference to the same variable
      // Use word boundary check to avoid false positives
      const selfRefPattern = new RegExp(`\\b\\${a.name}\\b`)
      if (selfRefPattern.test(valueExpr)) {
        // Replace all references to the variable with the saved version
        const fixedExpr = valueExpr.replace(new RegExp(`\\b\\${a.name}\\b`, 'g'), `_saved${a.name}`)
        bodyParts.push(`${indent}${a.name} = ${fixedExpr}`)
      } else {
        // No self-reference, simple reassignment
        bodyParts.push(`${indent}${a.name} = ${valueExpr}`)
      }
    } else if (declaredVars.has(a.name)) {
      // Reassignment - don't use const
      bodyParts.push(`${indent}${a.name} = ${transpileExpression(a.value!, ctx)}`)
    } else {
      // New variable - use const and track it
      bodyParts.push(`${indent}const ${a.name} = ${transpileExpression(a.value!, ctx)}`)
      declaredVars.add(a.name)
    }

    // NOW add to localFunctionBindings (after transpiling the value)
    // This allows the variable to be called as a local function in subsequent code
    ctx.localFunctionBindings.set(varName, varName)
    localVarNames.push(varName)
  }

  // Geometry expression (return statement)
  // Use j$.safeUnion to filter out undefined values from side-effect statements like assert
  const geomParts = geometryStmts.map(g => transpileStatement(g, ctx)).filter(Boolean) as string[]
  const returnExpr = geomParts.length === 0 ? 'undefined' :
    geomParts.length === 1 ? geomParts[0] :
    `j$.safeUnion([\n${indent}  ${geomParts.join(',\n' + indent + '  ')}\n${indent}])`
  if (geomParts.length > 1) ctx.usedHelpers.add('safeUnion')

  // If special variables were modified, wrap return in try/finally to restore them
  // This implements dynamic scoping: children see the modified values, but they're
  // restored after the module returns so siblings/parents see the original values
  if (modifiedSpecialVars.length > 0) {
    const restores = modifiedSpecialVars.map(name => `${name} = _saved${name}`).join('; ')
    bodyParts.push(`${indent}try { return ${returnExpr}; } finally { ${restores}; }`)
  } else {
    bodyParts.push(`${indent}return ${returnExpr}`)
  }

  // Clean up local bindings (they're scoped to this module body)
  for (const name of localVarNames) {
    ctx.localFunctionBindings.delete(name)
  }

  return bodyParts
}

/**
 * Transpile a module declaration to JavaScript function
 * Uses curried function: outer takes OpenSCAD params, inner takes children
 * This allows calling with defaults while still passing children:
 *   module(arg1, arg2)([child1, child2])  - explicit args
 *   module()([child1, child2])            - default args
 */
export function transpileModuleDeclaration(stmt: ModuleDeclarationStmt, ctx: TranspileContext): string {
  const name = safeIdentifier(stmt.name)
  const params = transpileParamsList(stmt.definitionArgs, ctx)
  // Extract parameter names to detect shadowing assignments
  const paramNames = new Set<string>(stmt.definitionArgs.map(a => a.name))
  const bodyParts = buildModuleBody(stmt.stmt, ctx, '  ', paramNames)

  // Build preamble to convert EXPLICIT_UNDEF params to undefined
  const preamble = buildUndefConversionPreamble(stmt.definitionArgs)
  const preambleLine = preamble ? `  ${preamble}\n` : ''

  // Curried: (params) => (_children) => body
  // Use _$m suffix for modules to separate from function namespace
  return `const ${name}_$m = (${params}) => (_children = []) => {\n${preambleLine}${bodyParts.join('\n')}\n}`
}

/**
 * Build preamble to convert j$.EXPLICIT_UNDEF parameters back to undefined.
 * This is needed because we use EXPLICIT_UNDEF to bypass JavaScript's default parameter
 * behavior, but once inside the function, we need real undefined for proper semantics.
 */
function buildUndefConversionPreamble(args: AssignmentNode[]): string {
  if (args.length === 0) return ''

  // Deduplicate: keep last occurrence of each parameter name (matching transpileParamsList)
  const seenNames = new Map<string, number>()
  args.forEach((arg, i) => seenNames.set(arg.name, i))
  const uniqueArgs = args.filter((arg, i) => seenNames.get(arg.name) === i)

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
  return `function ${name}_$f(${params}) { ${preamble}return ${body}; }`
}
