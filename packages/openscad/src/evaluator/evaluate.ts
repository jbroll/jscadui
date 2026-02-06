/**
 * AST to IR Evaluator
 *
 * Converts OpenSCAD AST to geometry IR by evaluating expressions,
 * resolving modules, and building the geometry tree.
 */

import type { ScadFile, Statement, Expression } from 'openscad-parser'
import type { IRNode, IRValue, IRModuleDef, IRFunctionDef, IRParamDef } from '../ir/types.js'
import { flattenGroups } from '../ir/types.js'
import type { Scope } from './scope.js'
import {
  createRootScope,
  createChildScope,
  setVariable,
  lookupModule,
  defineModule,
  defineFunction,
} from './scope.js'
import { evaluateExpression, expandRange } from './expressions.js'
import { isBuiltinModule, invokeBuiltin } from './builtins.js'
import { getLocation, parseOrThrow } from '../parser/parse.js'
import { undefinedModule, unsupportedFeature, internalError } from '../utils/errors.js'

/**
 * File resolver for include/use statements
 * Returns the file content, or undefined if not found
 */
export type FileResolver = (path: string, fromFile?: string) => string | undefined

export interface EvaluateOptions {
  // Default $fn value
  defaultSegments?: number
  // Animation time $t
  time?: number
  // File resolver for include/use
  fileResolver?: FileResolver
  // Current file path (for relative includes)
  currentFile?: string
}

// Evaluation context for passing options through the evaluation
interface EvalContext {
  options: EvaluateOptions
  includedFiles: Set<string>  // Track included files to prevent cycles
}

let evalContext: EvalContext | null = null

/**
 * Evaluate an OpenSCAD AST to IR
 */
export function evaluate(ast: ScadFile, options: EvaluateOptions = {}): IRNode {
  const scope = createRootScope()

  // Set up evaluation context
  evalContext = {
    options,
    includedFiles: new Set()
  }

  // Apply options
  if (options.defaultSegments !== undefined) {
    setVariable(scope, '$fn', options.defaultSegments)
  }
  if (options.time !== undefined) {
    setVariable(scope, '$t', options.time)
  }

  // Evaluate all statements
  const children: IRNode[] = []
  for (const stmt of ast.statements) {
    const result = evaluateStatement(stmt, scope, [])
    if (result) {
      children.push(result)
    }
  }

  // Clean up context
  evalContext = null

  // Wrap in group and flatten
  const group: IRNode = { type: 'group', children }
  return flattenGroups(group)
}

/**
 * Evaluate a single statement
 */
function evaluateStatement(
  stmt: Statement,
  scope: Scope,
  moduleChildren: IRNode[]
): IRNode | null {
  const stmtType = stmt.constructor.name
  const loc = getLocation(stmt)

  switch (stmtType) {
    case 'ModuleInstantiationStmt':
      return evaluateModuleInstantiation(stmt as any, scope, moduleChildren)

    case 'ModuleDeclarationStmt':
      evaluateModuleDeclaration(stmt as any, scope)
      return null

    case 'FunctionDeclarationStmt':
      evaluateFunctionDeclaration(stmt as any, scope)
      return null

    case 'BlockStmt':
      return evaluateBlock(stmt as any, scope, moduleChildren)

    case 'IfElseStatement':
      return evaluateIfElse(stmt as any, scope, moduleChildren)

    case 'NoopStmt':
      return null

    case 'AssertStmt':
      // Assert is for debugging - we just ignore it
      return null

    case 'UseStmt':
      evaluateUse(stmt as any, scope)
      return null

    case 'IncludeStmt':
      return evaluateInclude(stmt as any, scope, moduleChildren)

    case 'AssignmentNode':
      evaluateAssignment(stmt as any, scope)
      return null

    default:
      // Check if it's an assignment (top-level variable assignment)
      if ('name' in stmt && 'value' in stmt) {
        evaluateAssignment(stmt as any, scope)
        return null
      }
      throw unsupportedFeature(`statement type: ${stmtType}`, loc)
  }
}

/**
 * Evaluate a module instantiation (module call)
 */
function evaluateModuleInstantiation(
  stmt: {
    name: string
    args: Array<{ name?: string; value: Expression }>
    child: Statement | null
  },
  scope: Scope,
  moduleChildren: IRNode[]
): IRNode | null {
  const { name, args, child } = stmt
  const loc = getLocation(stmt as any)

  // Handle for loop specially - don't evaluate args yet
  if (name === 'for') {
    return evaluateForLoop(args, child, scope, 'union')
  }

  // Handle intersection_for - like for but wraps in intersection
  if (name === 'intersection_for') {
    return evaluateForLoop(args, child, scope, 'intersection')
  }

  // Handle children() - returns the module's children
  if (name === 'children') {
    if (moduleChildren.length === 0) {
      return { type: 'empty' }
    }

    // children() with no args returns all children
    if (args.length === 0) {
      if (moduleChildren.length === 1) {
        return moduleChildren[0]
      }
      return { type: 'group', children: moduleChildren }
    }

    // children(i) returns specific child
    const indexArg = args[0]
    if (indexArg && indexArg.value) {
      const index = evaluateExpression(indexArg.value, scope) as number
      if (typeof index === 'number' && index >= 0 && index < moduleChildren.length) {
        return moduleChildren[Math.floor(index)]
      }
    }

    return { type: 'empty' }
  }

  // Evaluate arguments
  const positionalArgs: IRValue[] = []
  const namedArgs: Record<string, IRValue> = {}

  for (const arg of args) {
    const value = evaluateExpression(arg.value, scope)
    if (arg.name) {
      namedArgs[arg.name] = value
    } else {
      positionalArgs.push(value)
    }
  }

  // Evaluate children (pass moduleChildren for nested children() calls)
  const children: IRNode[] = []
  if (child) {
    const childResult = evaluateStatement(child, scope, moduleChildren)
    if (childResult) {
      // Flatten block children
      if (childResult.type === 'group') {
        children.push(...childResult.children)
      } else {
        children.push(childResult)
      }
    }
  }

  // Check for built-in module
  if (isBuiltinModule(name)) {
    const result = invokeBuiltin(
      name,
      { positional: positionalArgs, named: namedArgs },
      children,
      scope
    )
    return result
  }

  // Check for user-defined module
  const moduleDef = lookupModule(scope, name)
  if (moduleDef) {
    return invokeUserModule(moduleDef, positionalArgs, namedArgs, children, scope)
  }

  // Unknown module
  throw undefinedModule(name, loc)
}

/**
 * Invoke a user-defined module
 */
function invokeUserModule(
  def: IRModuleDef,
  positionalArgs: IRValue[],
  namedArgs: Record<string, IRValue>,
  children: IRNode[],
  parentScope: Scope
): IRNode {
  // Create new scope for module body
  const moduleScope = createChildScope(parentScope)

  // Bind default parameter values
  for (const param of def.params) {
    if (param.default !== undefined) {
      setVariable(moduleScope, param.name, param.default)
    }
  }

  // Bind positional arguments
  for (let i = 0; i < positionalArgs.length && i < def.params.length; i++) {
    setVariable(moduleScope, def.params[i].name, positionalArgs[i])
  }

  // Bind named arguments
  for (const [name, value] of Object.entries(namedArgs)) {
    setVariable(moduleScope, name, value)
  }

  // Set $children
  setVariable(moduleScope, '$children', children.length)

  // Evaluate module body with children available
  const results: IRNode[] = []
  for (const bodyNode of def.body) {
    // Pass children to the module body for children() calls
    const result = evaluateStatement(bodyNode as unknown as Statement, moduleScope, children)
    if (result) {
      results.push(result)
    }
  }

  if (results.length === 0) {
    return { type: 'empty' }
  }
  if (results.length === 1) {
    return results[0]
  }
  return { type: 'group', children: results }
}

/**
 * Evaluate a module declaration
 */
function evaluateModuleDeclaration(
  stmt: {
    name: string
    definitionArgs: Array<{ name: string; value?: Expression }>
    stmt: Statement
  },
  scope: Scope
): void {
  const params: IRParamDef[] = stmt.definitionArgs.map((arg) => ({
    name: arg.name,
    default: arg.value ? evaluateExpression(arg.value, scope) : undefined,
  }))

  // Check if module uses children()
  const hasChildren = checkForChildrenCall(stmt.stmt)

  // Store the body statements
  const body: Statement[] = []
  if ((stmt.stmt as any).constructor.name === 'BlockStmt') {
    body.push(...(stmt.stmt as any).children)
  } else {
    body.push(stmt.stmt)
  }

  const def: IRModuleDef = {
    name: stmt.name,
    params,
    body: body as any,
    hasChildren,
  }

  defineModule(scope, stmt.name, def)
}

/**
 * Check if a statement tree contains children() calls
 */
function checkForChildrenCall(stmt: Statement): boolean {
  const stmtType = stmt.constructor.name

  if (stmtType === 'ModuleInstantiationStmt') {
    const inst = stmt as any
    if (inst.name === 'children') return true
    if (inst.child && checkForChildrenCall(inst.child)) return true
  }

  if (stmtType === 'BlockStmt') {
    const block = stmt as any
    return block.children.some((child: Statement) => checkForChildrenCall(child))
  }

  if (stmtType === 'IfElseStatement') {
    const ifStmt = stmt as any
    if (checkForChildrenCall(ifStmt.thenBranch)) return true
    if (ifStmt.elseBranch && checkForChildrenCall(ifStmt.elseBranch)) return true
  }

  return false
}

/**
 * Evaluate a function declaration
 */
function evaluateFunctionDeclaration(
  stmt: {
    name: string
    definitionArgs: Array<{ name: string; value?: Expression }>
    expr: Expression
  },
  scope: Scope
): void {
  const params: IRParamDef[] = stmt.definitionArgs.map((arg) => ({
    name: arg.name,
    default: arg.value ? evaluateExpression(arg.value, scope) : undefined,
  }))

  const def: IRFunctionDef = {
    name: stmt.name,
    params,
    expr: stmt.expr,
  }

  defineFunction(scope, stmt.name, def)
}

/**
 * Evaluate a block statement
 */
function evaluateBlock(
  stmt: { children: Statement[] },
  scope: Scope,
  moduleChildren: IRNode[]
): IRNode {
  const results: IRNode[] = []

  for (const child of stmt.children) {
    const result = evaluateStatement(child, scope, moduleChildren)
    if (result) {
      results.push(result)
    }
  }

  if (results.length === 0) {
    return { type: 'empty' }
  }
  if (results.length === 1) {
    return results[0]
  }
  return { type: 'group', children: results }
}

/**
 * Evaluate an if/else statement
 */
function evaluateIfElse(
  stmt: {
    cond: Expression
    thenBranch: Statement
    elseBranch: Statement | null
  },
  scope: Scope,
  moduleChildren: IRNode[]
): IRNode | null {
  const cond = evaluateExpression(stmt.cond, scope)

  if (cond) {
    return evaluateStatement(stmt.thenBranch, scope, moduleChildren)
  } else if (stmt.elseBranch) {
    return evaluateStatement(stmt.elseBranch, scope, moduleChildren)
  }

  return null
}

/**
 * Evaluate an assignment
 */
function evaluateAssignment(
  stmt: { name: string; value: Expression },
  scope: Scope
): void {
  const value = evaluateExpression(stmt.value, scope)
  setVariable(scope, stmt.name, value)
}

/**
 * Evaluate a for loop
 */
function evaluateForLoop(
  args: Array<{ name?: string; value: Expression }>,
  body: Statement | null,
  scope: Scope,
  mode: 'union' | 'intersection' = 'union'
): IRNode {
  if (!body || args.length === 0) {
    return { type: 'empty' }
  }

  const results: IRNode[] = []

  // Recursively iterate over multiple loop variables
  function iterate(argIndex: number, loopScope: Scope) {
    if (argIndex >= args.length) {
      // All variables bound, evaluate the body
      const result = evaluateStatement(body!, loopScope, [])
      if (result) {
        results.push(result)
      }
      return
    }

    const loopArg = args[argIndex]
    if (!loopArg.name) {
      throw internalError('For loop requires named variable')
    }

    const varName = loopArg.name
    const rangeValue = evaluateExpression(loopArg.value, loopScope)

    // Expand range or array
    let values: IRValue[]
    if (rangeValue && typeof rangeValue === 'object' && 'type' in rangeValue && rangeValue.type === 'range') {
      values = expandRange(rangeValue)
    } else if (Array.isArray(rangeValue)) {
      values = rangeValue
    } else {
      values = [rangeValue]
    }

    // Iterate over values
    for (const value of values) {
      const innerScope = createChildScope(loopScope)
      setVariable(innerScope, varName, value)
      iterate(argIndex + 1, innerScope)
    }
  }

  iterate(0, scope)

  if (results.length === 0) {
    return { type: 'empty' }
  }
  if (results.length === 1) {
    return results[0]
  }

  // Return group or intersection based on mode
  if (mode === 'intersection') {
    return { type: 'boolean', operation: 'intersection', children: results } as IRNode
  }
  return { type: 'group', children: results }
}

/**
 * Evaluate a use statement - imports modules and functions but doesn't execute geometry
 */
function evaluateUse(
  stmt: { filename: string },
  scope: Scope
): void {
  if (!evalContext?.options.fileResolver) {
    // No file resolver - silently skip
    return
  }

  const filename = stmt.filename
  const currentFile = evalContext.options.currentFile

  // Check for cycles
  if (evalContext.includedFiles.has(filename)) {
    return
  }
  evalContext.includedFiles.add(filename)

  // Resolve and read the file
  const source = evalContext.options.fileResolver(filename, currentFile)
  if (!source) {
    // File not found - silently skip (OpenSCAD behavior)
    return
  }

  // Parse the file
  const ast = parseOrThrow(source, filename)

  // Evaluate only module and function declarations
  for (const stmt of ast.statements) {
    const stmtType = stmt.constructor.name
    if (stmtType === 'ModuleDeclarationStmt') {
      evaluateModuleDeclaration(stmt as any, scope)
    } else if (stmtType === 'FunctionDeclarationStmt') {
      evaluateFunctionDeclaration(stmt as any, scope)
    } else if (stmtType === 'UseStmt') {
      evaluateUse(stmt as any, scope)
    } else if (stmtType === 'IncludeStmt') {
      // Treat include inside use as use
      evaluateUse({ filename: (stmt as any).filename }, scope)
    }
  }
}

/**
 * Evaluate an include statement - includes everything including geometry
 */
function evaluateInclude(
  stmt: { filename: string },
  scope: Scope,
  moduleChildren: IRNode[]
): IRNode | null {
  if (!evalContext?.options.fileResolver) {
    // No file resolver - silently skip
    return null
  }

  const filename = stmt.filename
  const currentFile = evalContext.options.currentFile

  // Check for cycles
  if (evalContext.includedFiles.has(filename)) {
    return null
  }
  evalContext.includedFiles.add(filename)

  // Resolve and read the file
  const source = evalContext.options.fileResolver(filename, currentFile)
  if (!source) {
    // File not found - silently skip (OpenSCAD behavior)
    return null
  }

  // Parse the file
  const ast = parseOrThrow(source, filename)

  // Evaluate all statements (including geometry)
  const children: IRNode[] = []
  for (const astStmt of ast.statements) {
    const result = evaluateStatement(astStmt, scope, moduleChildren)
    if (result) {
      children.push(result)
    }
  }

  if (children.length === 0) {
    return null
  }
  if (children.length === 1) {
    return children[0]
  }
  return { type: 'group', children }
}
