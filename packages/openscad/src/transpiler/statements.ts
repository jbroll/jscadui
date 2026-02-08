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
import { safeIdentifier, replaceIdentifier } from '../utils/identifiers.js'
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
        let value = transpileExpression(a.value!, ctx)
        // Replace references to previously defined assignments in this block
        for (const [orig, renamed] of nameMap) {
          if (orig !== origName) {
            value = replaceIdentifier(value, orig, renamed)
          }
        }
        assignStrs.push(`const ${newName} = ${value}`)
      }

      // Update references in geometry parts
      for (const [orig, renamed] of nameMap) {
        parts = parts.map(p => replaceIdentifier(p, orig, renamed))
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
 * Collect children as an array of transpiled expressions
 * Used for passing children to user-defined modules
 */
export function collectChildrenAsArray(child: Statement | null, ctx: TranspileContext): string[] {
  if (!child) return []

  if (isBlockStmt(child)) {
    const result: string[] = []
    for (const c of child.children) {
      if (!isNoopStmt(c as Statement) && !isAssignmentNode(c)) {
        const code = transpileStatement(c as Statement, ctx)
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
    return `j$.color(${colorValue}, ${alphaValue}, ${childCode || 'undefined'})`
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
      return `(_children.length === 0 ? undefined : _children.length === 1 ? _children[0] : j$.union(..._children))`
    } else {
      // Indexed access - check if argument is a vector (array of indices) or simple index
      const arg = stmt.args[0]
      const argValue = arg.value

      if (argValue && isVectorExpr(argValue)) {
        // Array of indices: children([0, 2, 3]) → union children at those indices
        const indices = argValue.children.map(c => transpileExpression(c, ctx))
        return `j$.union(${indices.map(i => `_children[${i}]`).join(', ')})`
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

  // Apply safeIdentifier to handle reserved keywords (like 'let')
  const safeName = safeIdentifier(name)

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
      return `${safeName}(${positionalArgs})(${childrenArg})`
    }
  }

  // Determine if this is a function call vs module instantiation
  // Functions: called directly, return values
  // Modules: curried pattern, module(args)(children) returns geometry
  //
  // We know it's a function if:
  // - It's in our local functionNames list (and not overridden by a module)
  // - It's in our importedFunctions set (tracked from dependency's functionExports)
  // Note: Use original name for lookups since context stores original names, not safe names
  const isLocalFunction = ctx.functionNames.includes(name)
  const isLocalModule = ctx.moduleNames.includes(name)
  const isImportedFunction = ctx.importedFunctions.has(name)
  const isImportedModule = ctx.importedModules.has(name)

  if (isLocalFunction && !isLocalModule) {
    // Pure local function call - no currying
    return `${safeName}(${positionalArgs})`
  }

  if (isImportedFunction && !isImportedModule) {
    // Imported function (not a module) - no currying needed
    return `${safeName}(${positionalArgs})`
  }

  // Module call with no children: use curried pattern with empty array
  return `${safeName}(${positionalArgs})()`
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
    const nestedParamNames = new Set<string>(m.definitionArgs.map(a => a.name))
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
      bodyParts.push(`${indent}${a.name} = ${transpileExpression(a.value!, ctx)}`)
    } else {
      // New variable - use const and track it
      bodyParts.push(`${indent}const ${a.name} = ${transpileExpression(a.value!, ctx)}`)
      declaredVars.add(a.name)
    }
  }

  // Geometry expression (return statement)
  // Use j$.safeUnion to filter out undefined values from side-effect statements like assert
  const geomParts = geometryStmts.map(g => transpileStatement(g, ctx)).filter(Boolean) as string[]
  const returnExpr = geomParts.length === 0 ? 'undefined' :
    geomParts.length === 1 ? geomParts[0] :
    `j$.safeUnion([\n${indent}  ${geomParts.join(',\n' + indent + '  ')}\n${indent}])`
  if (geomParts.length > 1) ctx.usedHelpers.add('safeUnion')

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
export function transpileModuleDeclaration(stmt: ModuleDeclarationStmt, ctx: TranspileContext): string {
  const name = safeIdentifier(stmt.name)
  const params = transpileParamsList(stmt.definitionArgs, ctx)
  // Extract parameter names to detect shadowing assignments
  const paramNames = new Set<string>(stmt.definitionArgs.map(a => a.name))
  const bodyParts = buildModuleBody(stmt.stmt, ctx, '  ', paramNames)

  // Curried: (params) => (_children) => body
  return `const ${name} = (${params}) => (_children = []) => {\n${bodyParts.join('\n')}\n}`
}

/**
 * Transpile a function declaration
 */
export function transpileFunctionDeclaration(stmt: FunctionDeclarationStmt, ctx: TranspileContext, nameOverride?: string): string {
  const name = nameOverride || safeIdentifier(stmt.name)
  const params = transpileParamsList(stmt.definitionArgs, ctx)
  const body = transpileExpression(stmt.expr, ctx)

  // Use function declaration (not arrow) for hoisting - critical for include bundling
  return `function ${name}(${params}) { return ${body}; }`
}
