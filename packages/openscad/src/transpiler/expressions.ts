/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Expression transpilation
 */

import type { Expression } from 'openscad-parser'
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
  isLcIfExpr,
  isLetExpr,
  isLcLetExpr,
  isEchoExpr,
  isAssertExpr,
  getNodeTypeName,
} from './ast-types.js'

/**
 * Check if an expression contains LcIfExpr (used to determine if filtering is needed)
 */
export function containsIfExpr(expr: any): boolean {
  if (!expr) return false
  if (isLcIfExpr(expr)) return true
  // Check nested expr in LcLetExpr or LetExpr
  if ((isLetExpr(expr) || isLcLetExpr(expr)) && expr.expr) return containsIfExpr(expr.expr)
  return false
}

/**
 * Transpile an expression
 */
export function transpileExpression(expr: Expression, ctx: TranspileContext): string {
  if (isLiteralExpr(expr)) {
    return transpileLiteral(expr.value)
  }

  if (isLookupExpr(expr)) {
    const name = expr.name
    // Handle special variables
    if (name === '$preview') return 'false'  // Always render as full quality
    if (name === '$t') return '0'  // Animation time defaults to 0
    if (name === '$children') return '_children.length'  // Number of children passed to module
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
      return `_eq(${left}, ${right})`
    }
    if (expr.operation === TokenType.BangEqual) {
      ctx.usedHelpers.add('eq')
      return `!_eq(${left}, ${right})`
    }
    // Handle arithmetic operators with vector support
    if (expr.operation === TokenType.Plus) {
      ctx.usedHelpers.add('vadd')
      return `_vadd(${left}, ${right})`
    }
    if (expr.operation === TokenType.Minus) {
      ctx.usedHelpers.add('vsub')
      return `_vsub(${left}, ${right})`
    }
    if (expr.operation === TokenType.Star) {
      ctx.usedHelpers.add('vmul')
      return `_vmul(${left}, ${right})`
    }
    if (expr.operation === TokenType.Slash) {
      ctx.usedHelpers.add('vdiv')
      return `_vdiv(${left}, ${right})`
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
      return `_vneg(${right})`
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
    const callee = transpileExpression(expr.callee, ctx)
    const args = expr.args.map((a: any) => transpileExpression(a.value, ctx)).join(', ')
    return transpileFunctionCall(callee, args, ctx)
  }

  if (isRangeExpr(expr)) {
    const begin = transpileExpression(expr.begin, ctx)
    const end = transpileExpression(expr.end, ctx)
    const step = expr.step ? transpileExpression(expr.step, ctx) : '1'
    return `_range(${begin}, ${end}, ${step})`
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
    const args = expr.args as any[]
    const innerExpr = transpileExpression(expr.expr, ctx)

    // Check if inner expression contains LcIfExpr (needs filtering)
    const needsFilter = containsIfExpr(expr.expr)

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

  if (isLetExpr(expr)) {
    // let(x = 1, y = 2) expr -> (() => { const x$1 = 1; const y$1 = 2; return expr })()
    // Use unique suffix for bindings to avoid temporal dead zone when shadowing
    const suffix = `$${ctx.letCounter || 1}`
    ctx.letCounter = (ctx.letCounter || 1) + 1

    // Build mapping from original names to suffixed names
    const nameMap = new Map<string, string>()
    const bindings: string[] = []

    for (const a of expr.args as any[]) {
      const origName = safeIdentifier(a.name)
      const newName = `${origName}${suffix}`
      nameMap.set(origName, newName)
      // Transpile value (references to earlier bindings will be renamed by substituteNames)
      let value = transpileExpression(a.value, ctx)
      // Replace references to previously defined let bindings
      for (const [orig, renamed] of nameMap) {
        if (orig !== origName) {
          value = replaceIdentifier(value, orig, renamed)
        }
      }
      bindings.push(`const ${newName} = ${value}`)
    }

    // Transpile body and substitute all let binding names
    let body = transpileExpression(expr.expr, ctx)
    for (const [orig, renamed] of nameMap) {
      body = replaceIdentifier(body, orig, renamed)
    }

    return `(() => { ${bindings.join('; ')}; return ${body} })()`
  }

  if (isLcLetExpr(expr)) {
    // List comprehension let: [for (x = range) let(a = 1) expr]
    // Handled the same way as LetExpr - create IIFE with bindings
    const suffix = `$${ctx.letCounter || 1}`
    ctx.letCounter = (ctx.letCounter || 1) + 1

    const nameMap = new Map<string, string>()
    const bindings: string[] = []

    for (const a of expr.args as any[]) {
      const origName = safeIdentifier(a.name)
      const newName = `${origName}${suffix}`
      nameMap.set(origName, newName)
      let value = transpileExpression(a.value, ctx)
      for (const [orig, renamed] of nameMap) {
        if (orig !== origName) {
          value = replaceIdentifier(value, orig, renamed)
        }
      }
      bindings.push(`const ${newName} = ${value}`)
    }

    let body = transpileExpression(expr.expr, ctx)
    for (const [orig, renamed] of nameMap) {
      body = replaceIdentifier(body, orig, renamed)
    }

    return `(() => { ${bindings.join('; ')}; return ${body} })()`
  }

  if (isEchoExpr(expr)) {
    // echo(x) expr -> logs x and returns expr (or x if no expr follows)
    // In JavaScript: (console.log(x), expr) or just (console.log(x), x)
    const args = (expr.args as any[]).map((a: any) => {
      if (a.name) {
        return `"${a.name}=", ${transpileExpression(a.value, ctx)}`
      }
      return transpileExpression(a.value, ctx)
    }).join(', ')
    const innerExpr = transpileExpression(expr.expr, ctx)
    return `(console.log(${args}), ${innerExpr})`
  }

  if (isAssertExpr(expr)) {
    // assert(cond, msg) expr -> checks condition, returns expr (or undef if no expr)
    // In JavaScript: we use console.assert which doesn't throw, then return expr
    const args = expr.args as any[]
    const condition = args.length > 0 ? transpileExpression(args[0].value, ctx) : 'true'
    const message = args.length > 1 ? transpileExpression(args[1].value, ctx) : '"Assertion failed"'
    // expr may be undefined when assert is at the end of a chain
    const innerExpr = expr.expr ? transpileExpression(expr.expr, ctx) : 'undefined'
    return `(console.assert(${condition}, ${message}), ${innerExpr})`
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

export function transpileLiteral(value: any): string {
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

export function transpileFunctionCall(callee: string, args: string, ctx: TranspileContext): string {
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
