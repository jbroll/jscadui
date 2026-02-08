/**
 * Expression transpilation
 */

import type {
  Expression,
  FunctionCallExpr,
  LcForExpr,
  LetExpr,
  LcLetExpr,
  EchoExpr,
  AssertExpr,
  FunctionDeclarationStmt,
  AssignmentNode,
} from 'openscad-parser'
import type { TranspileContext } from './context.js'
import { WarningCode } from './context.js'
import { safeIdentifier, replaceIdentifier } from '../utils/identifiers.js'
import { TokenType } from '../utils/tokens.js'
import {
  isLiteralExpr,
  isLookupExpr,
  isVectorExpr,
  isBinaryOpExpr,
  isUnaryOpExpr,
  isTernaryExpr,
  isArrayLookupExpr,
  isFunctionCallExpr,
  isRangeExpr,
  isGroupingExpr,
  isMemberLookupExpr,
  isLcForExpr,
  isLcForCExpr,
  isLcIfExpr,
  isLcEachExpr,
  isLetExpr,
  isLcLetExpr,
  isEchoExpr,
  isAssertExpr,
  isFunctionDeclaration,
  getNodeTypeName,
} from './ast-types.js'
import type { LcForCExpr } from './ast-types.js'

/**
 * Check if an expression contains LcIfExpr (used to determine if filtering is needed)
 */
export function containsIfExpr(expr: Expression | null): boolean {
  if (!expr) return false
  if (isLcIfExpr(expr)) return true
  // Check nested expr in LcLetExpr or LetExpr
  if ((isLetExpr(expr) || isLcLetExpr(expr)) && expr.expr) return containsIfExpr(expr.expr)
  return false
}

/**
 * Check if an expression is or directly contains LcEachExpr (needs flatMap instead of map)
 */
export function isEachExpr(expr: Expression | null): boolean {
  if (!expr) return false
  if (isLcEachExpr(expr)) return true
  // Check nested expr in LcLetExpr or LetExpr
  if ((isLetExpr(expr) || isLcLetExpr(expr)) && expr.expr) return isEachExpr(expr.expr)
  // Check inside LcIfExpr
  if (isLcIfExpr(expr)) {
    return isEachExpr(expr.ifExpr) || (expr.elseExpr ? isEachExpr(expr.elseExpr) : false)
  }
  return false
}

/**
 * Transpile an expression
 */
export function transpileExpression(expr: Expression, ctx: TranspileContext): string {
  if (isLiteralExpr(expr)) {
    return transpileLiteral(expr.value as string | number | boolean | null)
  }

  if (isLookupExpr(expr)) {
    const name = expr.name
    // Handle special variables
    if (name === '$preview') return 'false'  // Always render as full quality
    if (name === '$t') return '0'  // Animation time defaults to 0
    if (name === '$children') return '_children.length'  // Number of children passed to module
    if (name === '$parent_modules') return '0'  // Module nesting depth (stub: always top-level)
    // Constants from j$ namespace
    if (name === 'PI') return 'j$.PI'
    // Ensure the identifier is safe for JavaScript
    return safeIdentifier(name)
  }

  if (isVectorExpr(expr)) {
    const children = expr.children
    // List comprehension: [for (i = range) expr] has single LcForExpr child
    // LcForExpr already returns an array via .map(), so don't double-wrap
    if (children.length === 1 && isLcForExpr(children[0])) {
      return transpileExpression(children[0], ctx)
    }
    return `[${children.map(c => transpileExpression(c, ctx)).join(', ')}]`
  }

  if (isBinaryOpExpr(expr)) {
    const left = transpileExpression(expr.left, ctx)
    const right = transpileExpression(expr.right, ctx)
    // Handle equality operators specially - need deep comparison for arrays
    if (expr.operation === TokenType.EqualEqual) {
      ctx.usedHelpers.add('eq')
      return `j$.eq(${left}, ${right})`
    }
    if (expr.operation === TokenType.BangEqual) {
      ctx.usedHelpers.add('eq')
      return `!j$.eq(${left}, ${right})`
    }
    // Handle arithmetic operators with vector support
    if (expr.operation === TokenType.Plus) {
      ctx.usedHelpers.add('vadd')
      return `j$.vadd(${left}, ${right})`
    }
    if (expr.operation === TokenType.Minus) {
      ctx.usedHelpers.add('vsub')
      return `j$.vsub(${left}, ${right})`
    }
    if (expr.operation === TokenType.Star) {
      ctx.usedHelpers.add('vmul')
      return `j$.vmul(${left}, ${right})`
    }
    if (expr.operation === TokenType.Slash) {
      ctx.usedHelpers.add('vdiv')
      return `j$.vdiv(${left}, ${right})`
    }
    const op = transpileBinaryOp(expr.operation)
    return `(${left} ${op} ${right})`
  }

  if (isUnaryOpExpr(expr)) {
    const right = transpileExpression(expr.right, ctx)
    const op = transpileUnaryOp(expr.operation)
    // Unary minus on vectors needs special handling (negate each element)
    // But for literal numbers, we can use regular negation
    if (op === '-' && !isLiteralExpr(expr.right)) {
      ctx.usedHelpers.add('vneg')
      return `j$.vneg(${right})`
    }
    return `${op}${right}`
  }

  if (isTernaryExpr(expr)) {
    const cond = transpileExpression(expr.cond, ctx)
    const ifExpr = transpileExpression(expr.ifExpr, ctx)
    const elseExpr = transpileExpression(expr.elseExpr, ctx)
    return `(${cond} ? ${ifExpr} : ${elseExpr})`
  }

  if (isArrayLookupExpr(expr)) {
    const array = transpileExpression(expr.array, ctx)
    const index = transpileExpression(expr.index, ctx)
    return `${array}[${index}]`
  }

  if (isFunctionCallExpr(expr)) {
    const fnExpr = expr as FunctionCallExpr
    let callee = transpileExpression(fnExpr.callee, ctx)

    // Build args array with name+value pairs (like statements.ts does for modules)
    const argsArray = fnExpr.args.map(a => ({
      name: a.name || null,
      value: transpileExpression(a.value!, ctx)
    }))

    // If this name has both module and function versions, use __fn suffix for function calls
    if (ctx.dualDefinedNames.has(callee)) {
      callee = `${callee}__fn`
    }

    // Reorder named arguments to match parameter definition order
    const args = reorderNamedArgs(callee, argsArray, ctx)

    return transpileFunctionCall(callee, args, ctx)
  }

  if (isRangeExpr(expr)) {
    const begin = transpileExpression(expr.begin, ctx)
    const end = transpileExpression(expr.end, ctx)
    const step = expr.step ? transpileExpression(expr.step, ctx) : '1'
    return `j$.range(${begin}, ${end}, ${step})`
  }

  if (isGroupingExpr(expr)) {
    return `(${transpileExpression(expr.inner, ctx)})`
  }

  if (isMemberLookupExpr(expr)) {
    const obj = transpileExpression(expr.expr, ctx)
    // OpenSCAD vector accessor notation: v.x, v.y, v.z -> v[0], v[1], v[2]
    const member = expr.member
    if (member === 'x') return `${obj}[0]`
    if (member === 'y') return `${obj}[1]`
    if (member === 'z') return `${obj}[2]`
    return `${obj}.${member}`
  }

  if (isLcForExpr(expr)) {
    // List comprehension: [for (i = [0:10]) i * 2]
    const forExpr = expr as LcForExpr
    const args = forExpr.args
    const innerExpr = transpileExpression(forExpr.expr, ctx)

    // Check if inner expression contains LcIfExpr (needs filtering)
    const needsFilter = containsIfExpr(forExpr.expr)
    // Check if inner expression uses 'each' (needs flatMap for flattening)
    const needsFlatMap = isEachExpr(forExpr.expr)

    if (args.length === 1) {
      const varName = args[0].name
      const range = transpileExpression(args[0].value!, ctx)
      // Use flatMap when 'each' is used, otherwise map
      const method = needsFlatMap ? 'flatMap' : 'map'
      // Wrap range with j$.iter() to handle strings (OpenSCAD: for (c = "str") iterates chars)
      const mapExpr = `j$.iter(${range}).${method}(${varName} => ${innerExpr})`
      return needsFilter ? `${mapExpr}.filter(x => x !== undefined)` : mapExpr
    }
    // Multiple loop variables: for (i = [0:3], j = [0:2]) becomes nested flatMap/map
    // Each outer loop uses flatMap to flatten the nested arrays, innermost uses map
    // If 'each' is used, innermost also uses flatMap
    let result = innerExpr
    for (let i = args.length - 1; i >= 0; i--) {
      const varName = args[i].name
      const range = transpileExpression(args[i].value!, ctx)
      const isInnermost = i === args.length - 1
      const method = isInnermost ? (needsFlatMap ? 'flatMap' : 'map') : 'flatMap'
      // Wrap range with j$.iter() to handle strings (OpenSCAD: for (c = "str") iterates chars)
      result = `j$.iter(${range}).${method}(${varName} => ${result})`
    }
    return needsFilter ? `${result}.filter(x => x !== undefined)` : result
  }

  if (isLcForCExpr(expr)) {
    // C-style for loop: [for (c = 1, i = 0; i <= n; c = c*(...), i = i+1) c]
    // Transpile to an IIFE with a while loop
    const forCExpr = expr as LcForCExpr
    const suffix = `$${ctx.letCounter || 1}`
    ctx.letCounter = (ctx.letCounter || 1) + 1

    // Initial assignments
    const inits = forCExpr.args.map(a =>
      `let ${safeIdentifier(a.name)}${suffix} = ${transpileExpression(a.value!, ctx)}`
    ).join('; ')

    // Condition - replace variable names with suffixed versions
    let cond = transpileExpression(forCExpr.cond, ctx)
    for (const a of forCExpr.args) {
      cond = replaceIdentifier(cond, safeIdentifier(a.name), `${safeIdentifier(a.name)}${suffix}`)
    }

    // Body expression - replace variable names
    let body = transpileExpression(forCExpr.expr, ctx)
    for (const a of forCExpr.args) {
      body = replaceIdentifier(body, safeIdentifier(a.name), `${safeIdentifier(a.name)}${suffix}`)
    }

    // Increment assignments - replace variable names and create tuple update
    const incrParts = forCExpr.incrArgs.map(a => {
      let val = transpileExpression(a.value!, ctx)
      for (const arg of forCExpr.args) {
        val = replaceIdentifier(val, safeIdentifier(arg.name), `${safeIdentifier(arg.name)}${suffix}`)
      }
      return val
    })
    const incrVars = forCExpr.incrArgs.map(a => `${safeIdentifier(a.name)}${suffix}`).join(', ')
    const incrUpdate = `[${incrVars}] = [${incrParts.join(', ')}]`

    return `(() => { const _result${suffix} = []; ${inits}; while (${cond}) { _result${suffix}.push(${body}); ${incrUpdate}; } return _result${suffix}; })()`
  }

  if (isLcIfExpr(expr)) {
    // Conditional in list comprehension: [for (i = range) if (cond) expr]
    // Returns undefined when condition is false, to be filtered out by LcForExpr
    const cond = transpileExpression(expr.cond, ctx)
    const body = transpileExpression(expr.ifExpr, ctx)
    // If there's an else branch, use it; otherwise return undefined
    if (expr.elseExpr) {
      const elsePart = transpileExpression(expr.elseExpr, ctx)
      return `(${cond} ? ${body} : ${elsePart})`
    }
    return `(${cond} ? ${body} : undefined)`
  }

  if (isLcEachExpr(expr)) {
    // 'each' in list comprehension: [for (x = arr) each x]
    // When used outside of a for loop context (standalone), we can't really flatten
    // The parent LcForExpr should detect this and use flatMap
    // For standalone cases, just transpile the inner expression (caller handles flattening)
    return transpileExpression(expr.expr, ctx)
  }

  if (isLetExpr(expr)) {
    // let(x = 1, y = 2) expr -> (() => { const x$1 = 1; const y$1 = 2; return expr })()
    // Use unique suffix for bindings to avoid temporal dead zone when shadowing
    const letExpr = expr as LetExpr
    const suffix = `$${ctx.letCounter || 1}`
    ctx.letCounter = (ctx.letCounter || 1) + 1

    // Build mapping from original names to suffixed names
    const nameMap = new Map<string, string>()
    const bindings: string[] = []

    for (const a of letExpr.args) {
      const origName = safeIdentifier(a.name)
      const newName = `${origName}${suffix}`
      nameMap.set(origName, newName)
      // Transpile value (references to earlier bindings will be renamed by substituteNames)
      let value = transpileExpression(a.value!, ctx)
      // Replace references to previously defined let bindings
      for (const [orig, renamed] of nameMap) {
        if (orig !== origName) {
          value = replaceIdentifier(value, orig, renamed)
        }
      }
      bindings.push(`const ${newName} = ${value}`)
    }

    // Transpile body and substitute all let binding names
    let body = transpileExpression(letExpr.expr, ctx)
    for (const [orig, renamed] of nameMap) {
      body = replaceIdentifier(body, orig, renamed)
    }

    return `(() => { ${bindings.join('; ')}; return ${body} })()`
  }

  if (isLcLetExpr(expr)) {
    // List comprehension let: [for (x = range) let(a = 1) expr]
    // Handled the same way as LetExpr - create IIFE with bindings
    const lcLetExpr = expr as LcLetExpr
    const suffix = `$${ctx.letCounter || 1}`
    ctx.letCounter = (ctx.letCounter || 1) + 1

    const nameMap = new Map<string, string>()
    const bindings: string[] = []

    for (const a of lcLetExpr.args) {
      const origName = safeIdentifier(a.name)
      const newName = `${origName}${suffix}`
      nameMap.set(origName, newName)
      let value = transpileExpression(a.value!, ctx)
      for (const [orig, renamed] of nameMap) {
        if (orig !== origName) {
          value = replaceIdentifier(value, orig, renamed)
        }
      }
      bindings.push(`const ${newName} = ${value}`)
    }

    let body = transpileExpression(lcLetExpr.expr, ctx)
    for (const [orig, renamed] of nameMap) {
      body = replaceIdentifier(body, orig, renamed)
    }

    return `(() => { ${bindings.join('; ')}; return ${body} })()`
  }

  if (isEchoExpr(expr)) {
    // echo(x) expr -> logs x and returns expr (or x if no expr follows)
    // In JavaScript: (console.log(x), expr) or just (console.log(x), x)
    const echoExpr = expr as EchoExpr
    const args = echoExpr.args.map(a => {
      if (a.name) {
        return `"${a.name}=", ${transpileExpression(a.value!, ctx)}`
      }
      return transpileExpression(a.value!, ctx)
    }).join(', ')
    const innerExpr = transpileExpression(echoExpr.expr, ctx)
    return `(console.log(${args}), ${innerExpr})`
  }

  if (isAssertExpr(expr)) {
    // assert(cond, msg) expr -> checks condition, returns expr (or undef if no expr)
    // j$.assert throws if condition is false, matching OpenSCAD behavior
    const assertExpr = expr as AssertExpr
    const args = assertExpr.args
    const condition = args.length > 0 ? transpileExpression(args[0].value!, ctx) : 'true'
    const message = args.length > 1 ? transpileExpression(args[1].value!, ctx) : '"Assertion failed"'
    // expr may be undefined when assert is at the end of a chain
    const innerExpr = assertExpr.expr ? transpileExpression(assertExpr.expr, ctx) : 'undefined'
    return `(j$.assert(${condition}, ${message}), ${innerExpr})`
  }

  // Handle function declaration as expression (local/anonymous functions)
  // In OpenSCAD: function helper(x) = x * 2  or  let(fn(x) = x * 2) ...
  // In JavaScript: (x) => x * 2
  if (isFunctionDeclaration(expr as unknown as import('openscad-parser').Statement)) {
    const funcDecl = expr as unknown as FunctionDeclarationStmt
    const params = (funcDecl.definitionArgs || [])
      .map((a: AssignmentNode) => {
        const name = safeIdentifier(a.name)
        if (a.value !== undefined && a.value !== null) {
          return `${name} = ${transpileExpression(a.value, ctx)}`
        }
        return name
      })
      .join(', ')
    const body = transpileExpression(funcDecl.expr, ctx)
    return `(${params}) => ${body}`
  }

  // Unsupported expression - add warning
  const exprType = getNodeTypeName(expr)
  ctx.warnings.push({
    code: WarningCode.UNSUPPORTED_EXPRESSION,
    message: `Unsupported expression type: ${exprType}`,
    file: ctx.options.currentFile,
  })
  return `/* unsupported expr: ${exprType} */`
}

export function transpileLiteral(value: string | number | boolean | null | undefined): string {
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
export function reorderNamedArgs(
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

export function transpileBinaryOp(op: number): string {
  // Note: EqualEqual and BangEqual are handled specially in transpileExpression
  // because they need deep comparison for arrays
  const opMap: Record<number, string> = {
    [TokenType.Plus]: '+',
    [TokenType.Minus]: '-',
    [TokenType.Star]: '*',
    [TokenType.Slash]: '/',
    [TokenType.Percent]: '%',
    [TokenType.Caret]: '**',  // Power operator (^ in OpenSCAD, ** in JavaScript)
    [TokenType.Less]: '<',
    [TokenType.LessEqual]: '<=',
    [TokenType.Greater]: '>',
    [TokenType.GreaterEqual]: '>=',
    [TokenType.EqualEqual]: '===',  // (see special handling)
    [TokenType.BangEqual]: '!==',   // (see special handling)
    [TokenType.AND]: '&&',
    [TokenType.OR]: '||',
  }
  return opMap[op] || String(op)
}

export function transpileUnaryOp(op: number): string {
  const opMap: Record<number, string> = {
    [TokenType.Bang]: '!',
    [TokenType.Minus]: '-',
    [TokenType.Plus]: '+',
  }
  return opMap[op] || String(op)
}

export function transpileFunctionCall(callee: string, args: string, _ctx: TranspileContext): string {
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
    return `j$.${callee}(${args})`
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

  // is_undef() -> typeof value === 'undefined'
  // Using typeof prevents ReferenceError when checking undefined variables (like BOSL2 flags)
  if (callee === 'is_undef') {
    return `(typeof (${args}) === 'undefined')`
  }

  // is_def() -> typeof value !== 'undefined'  (BOSL compatibility)
  if (callee === 'is_def') {
    return `(typeof (${args}) !== 'undefined')`
  }

  // is_list() -> Array.isArray()
  if (callee === 'is_list') {
    return `Array.isArray(${args})`
  }

  // is_num() -> typeof === 'number'
  if (callee === 'is_num') {
    return `(typeof (${args}) === 'number' && !isNaN(${args}))`
  }

  // is_str() / is_string() -> typeof === 'string'
  if (callee === 'is_str' || callee === 'is_string') {
    return `(typeof (${args}) === 'string')`
  }

  // is_vector() -> runtime helper (handles optional length parameter)
  if (callee === 'is_vector') {
    return `j$.is_vector(${args})`
  }

  // is_bool() -> typeof === 'boolean'
  if (callee === 'is_bool') {
    return `(typeof (${args}) === 'boolean')`
  }

  // concat() -> [..., ...]
  if (callee === 'concat') {
    return `[].concat(${args})`
  }

  // Helper functions from j$ runtime
  const helperFuncs = ['norm', 'cross', 'lookup', 'rands', 'search', 'version_num', 'str']
  if (helperFuncs.includes(callee)) {
    return `j$.${callee}(${args})`
  }

  // echo() for debugging - map to console.log
  if (callee === 'echo') {
    return `console.log(${args})`
  }

  // User-defined function call
  return `${callee}(${args})`
}
