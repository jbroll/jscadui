/**
 * Expression evaluator for OpenSCAD expressions
 */

import { type Expression, TokenType } from 'openscad-parser'
import type { IRValue, IRRange, SourceLocation } from '../ir/types.js'
import type { Scope } from './scope.js'
import { lookupVariable, lookupFunction, createChildScope, setVariable } from './scope.js'
import { undefinedVariable, undefinedFunction, typeError, internalError } from '../utils/errors.js'
import { getLocation } from '../parser/parse.js'

/**
 * Evaluate an expression to a value
 */
export function evaluateExpression(expr: Expression, scope: Scope): IRValue {
  const loc = getLocation(expr)

  switch (expr.constructor.name) {
    case 'LiteralExpr':
      return evaluateLiteral(expr as any)

    case 'LookupExpr':
      return evaluateLookup(expr as any, scope, loc)

    case 'VectorExpr':
      return evaluateVector(expr as any, scope)

    case 'BinaryOpExpr':
      return evaluateBinaryOp(expr as any, scope)

    case 'UnaryOpExpr':
      return evaluateUnaryOp(expr as any, scope)

    case 'TernaryExpr':
      return evaluateTernary(expr as any, scope)

    case 'ArrayLookupExpr':
      return evaluateArrayLookup(expr as any, scope, loc)

    case 'RangeExpr':
      return evaluateRange(expr as any, scope)

    case 'FunctionCallExpr':
      return evaluateFunctionCall(expr as any, scope, loc)

    case 'MemberLookupExpr':
      return evaluateMemberLookup(expr as any, scope, loc)

    case 'GroupingExpr':
      return evaluateExpression((expr as any).inner, scope)

    case 'LcForExpr':
      return evaluateLcFor(expr as any, scope)

    case 'LcIfExpr':
      return evaluateLcIf(expr as any, scope)

    case 'LcEachExpr':
      return evaluateLcEach(expr as any, scope)

    case 'LetExpr':
      return evaluateLet(expr as any, scope)

    default:
      throw internalError(`Unknown expression type: ${expr.constructor.name}`)
  }
}

function evaluateLiteral(expr: { value: any }): IRValue {
  return expr.value
}

function evaluateLookup(
  expr: { name: string },
  scope: Scope,
  loc?: SourceLocation
): IRValue {
  const value = lookupVariable(scope, expr.name)
  if (value === undefined) {
    throw undefinedVariable(expr.name, loc)
  }
  return value
}

function evaluateVector(expr: { children: Expression[] }, scope: Scope): IRValue[] {
  const result: IRValue[] = []

  for (const child of expr.children) {
    const childType = child.constructor.name
    const value = evaluateExpression(child, scope)

    // Handle each keyword for flattening
    if (value && typeof value === 'object' && '__each' in value) {
      result.push(...(value as any).values)
    }
    // Handle list comprehensions - spread results into vector
    else if (childType === 'LcForExpr' && Array.isArray(value)) {
      result.push(...value)
    }
    // Filter out undefined from conditional list comprehensions
    else if (value !== undefined) {
      result.push(value)
    }
  }

  return result
}

function evaluateBinaryOp(
  expr: { left: Expression; right: Expression; operation: number },
  scope: Scope
): IRValue {
  const left = evaluateExpression(expr.left, scope)
  const right = evaluateExpression(expr.right, scope)

  // operation is a TokenType enum value (number)
  const op = expr.operation

  // Arithmetic operations
  if (op === TokenType.Plus) {
    if (typeof left === 'number' && typeof right === 'number') {
      return left + right
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      // Vector addition
      return left.map((v, i) => (v as number) + (right[i] as number))
    }
    if (typeof left === 'string' || typeof right === 'string') {
      return String(left) + String(right)
    }
  }

  if (op === TokenType.Minus) {
    if (typeof left === 'number' && typeof right === 'number') {
      return left - right
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      return left.map((v, i) => (v as number) - (right[i] as number))
    }
  }

  if (op === TokenType.Star) {
    if (typeof left === 'number' && typeof right === 'number') {
      return left * right
    }
    if (typeof left === 'number' && Array.isArray(right)) {
      return right.map((v) => left * (v as number))
    }
    if (Array.isArray(left) && typeof right === 'number') {
      return left.map((v) => (v as number) * right)
    }
  }

  if (op === TokenType.Slash) {
    if (typeof left === 'number' && typeof right === 'number') {
      return left / right
    }
    if (Array.isArray(left) && typeof right === 'number') {
      return left.map((v) => (v as number) / right)
    }
  }

  if (op === TokenType.Percent) {
    if (typeof left === 'number' && typeof right === 'number') {
      return left % right
    }
  }

  if (op === TokenType.Caret) {
    if (typeof left === 'number' && typeof right === 'number') {
      return Math.pow(left, right)
    }
  }

  // Comparison operations
  if (op === TokenType.Less) {
    return (left as number) < (right as number)
  }
  if (op === TokenType.LessEqual) {
    return (left as number) <= (right as number)
  }
  if (op === TokenType.Greater) {
    return (left as number) > (right as number)
  }
  if (op === TokenType.GreaterEqual) {
    return (left as number) >= (right as number)
  }
  if (op === TokenType.EqualEqual) {
    return left === right
  }
  if (op === TokenType.BangEqual) {
    return left !== right
  }

  // Logical operations
  if (op === TokenType.AND) {
    return Boolean(left) && Boolean(right)
  }
  if (op === TokenType.OR) {
    return Boolean(left) || Boolean(right)
  }

  throw internalError(`Unknown binary operator: ${op} (${TokenType[op]})`)
}

function evaluateUnaryOp(
  expr: { right: Expression; operation: number },
  scope: Scope
): IRValue {
  const value = evaluateExpression(expr.right, scope)
  const op = expr.operation

  if (op === TokenType.Minus) {
    if (typeof value === 'number') {
      return -value
    }
    if (Array.isArray(value)) {
      return value.map((v) => -(v as number))
    }
  }

  if (op === TokenType.Plus) {
    return value
  }

  if (op === TokenType.Bang) {
    return !value
  }

  throw internalError(`Unknown unary operator: ${op} (${TokenType[op]})`)
}

function evaluateTernary(
  expr: { cond: Expression; ifExpr: Expression; elseExpr: Expression },
  scope: Scope
): IRValue {
  const cond = evaluateExpression(expr.cond, scope)
  if (cond) {
    return evaluateExpression(expr.ifExpr, scope)
  } else {
    return evaluateExpression(expr.elseExpr, scope)
  }
}

function evaluateArrayLookup(
  expr: { array: Expression; index: Expression },
  scope: Scope,
  loc?: SourceLocation
): IRValue {
  const array = evaluateExpression(expr.array, scope)
  const index = evaluateExpression(expr.index, scope)

  if (!Array.isArray(array)) {
    throw typeError('Cannot index non-array value', loc)
  }
  if (typeof index !== 'number') {
    throw typeError('Array index must be a number', loc)
  }

  return array[Math.floor(index)]
}

function evaluateRange(
  expr: { begin: Expression; end: Expression; step?: Expression | null },
  scope: Scope
): IRRange {
  const start = evaluateExpression(expr.begin, scope) as number
  const end = evaluateExpression(expr.end, scope) as number
  const step = expr.step ? (evaluateExpression(expr.step, scope) as number) : undefined

  return { type: 'range', start, end, step }
}

function evaluateFunctionCall(
  expr: { callee: Expression; args: Array<{ name?: string; value: Expression }> },
  scope: Scope,
  loc?: SourceLocation
): IRValue {
  // Get function name from callee
  const callee = expr.callee as any
  if (callee.constructor.name !== 'LookupExpr') {
    throw typeError('Function callee must be an identifier', loc)
  }

  const name = callee.name

  // Built-in functions
  const result = evaluateBuiltinFunction(name, expr.args, scope)
  if (result !== undefined) {
    return result
  }

  // User-defined functions
  const funcDef = lookupFunction(scope, name)
  if (!funcDef) {
    throw undefinedFunction(name, loc)
  }

  // Create child scope and bind arguments
  const funcScope = createChildScope(scope)

  // Set default values first
  for (const param of funcDef.params) {
    if (param.default !== undefined) {
      setVariable(funcScope, param.name, param.default)
    }
  }

  // Then bind provided arguments
  for (let i = 0; i < expr.args.length; i++) {
    const arg = expr.args[i]
    const value = evaluateExpression(arg.value, scope)

    if (arg.name) {
      // Named argument
      setVariable(funcScope, arg.name, value)
    } else if (i < funcDef.params.length) {
      // Positional argument
      setVariable(funcScope, funcDef.params[i].name, value)
    }
  }

  // Evaluate function body
  return evaluateExpression(funcDef.expr as Expression, funcScope)
}

function evaluateMemberLookup(
  expr: { expr: Expression; member: string },
  scope: Scope,
  loc?: SourceLocation
): IRValue {
  const obj = evaluateExpression(expr.expr, scope)
  const member = expr.member

  // Vector member access: v.x, v.y, v.z
  if (Array.isArray(obj)) {
    if (member === 'x') return obj[0]
    if (member === 'y') return obj[1]
    if (member === 'z') return obj[2]
  }

  throw typeError(`Cannot access member '${member}' on value`, loc)
}

/**
 * Evaluate built-in OpenSCAD functions
 */
function evaluateBuiltinFunction(
  name: string,
  args: Array<{ name?: string; value: Expression }>,
  scope: Scope
): IRValue | undefined {
  // Helper to get evaluated arguments
  const evalArgs = () => args.map((a) => evaluateExpression(a.value, scope))

  switch (name) {
    // Math functions
    case 'abs':
      return Math.abs(evalArgs()[0] as number)
    case 'sign':
      return Math.sign(evalArgs()[0] as number)
    case 'sin':
      return Math.sin(((evalArgs()[0] as number) * Math.PI) / 180)
    case 'cos':
      return Math.cos(((evalArgs()[0] as number) * Math.PI) / 180)
    case 'tan':
      return Math.tan(((evalArgs()[0] as number) * Math.PI) / 180)
    case 'asin':
      return (Math.asin(evalArgs()[0] as number) * 180) / Math.PI
    case 'acos':
      return (Math.acos(evalArgs()[0] as number) * 180) / Math.PI
    case 'atan':
      return (Math.atan(evalArgs()[0] as number) * 180) / Math.PI
    case 'atan2': {
      const [y, x] = evalArgs() as number[]
      return (Math.atan2(y, x) * 180) / Math.PI
    }
    case 'floor':
      return Math.floor(evalArgs()[0] as number)
    case 'ceil':
      return Math.ceil(evalArgs()[0] as number)
    case 'round':
      return Math.round(evalArgs()[0] as number)
    case 'sqrt':
      return Math.sqrt(evalArgs()[0] as number)
    case 'pow': {
      const [base, exp] = evalArgs() as number[]
      return Math.pow(base, exp)
    }
    case 'exp':
      return Math.exp(evalArgs()[0] as number)
    case 'log':
      return Math.log(evalArgs()[0] as number)
    case 'ln':
      return Math.log(evalArgs()[0] as number)
    case 'min':
      return Math.min(...(evalArgs() as number[]))
    case 'max':
      return Math.max(...(evalArgs() as number[]))

    // Vector/array functions
    case 'len': {
      const val = evalArgs()[0]
      if (Array.isArray(val)) return val.length
      if (typeof val === 'string') return val.length
      return undefined
    }
    case 'concat': {
      const arrays = evalArgs()
      return ([] as IRValue[]).concat(...(arrays as IRValue[][]))
    }
    case 'norm': {
      const v = evalArgs()[0] as number[]
      return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
    }
    case 'cross': {
      const [a, b] = evalArgs() as number[][]
      return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ]
    }

    // String functions
    case 'str':
      return evalArgs()
        .map((v) => String(v))
        .join('')
    case 'chr': {
      const codes = evalArgs()
      if (Array.isArray(codes[0])) {
        return (codes[0] as number[]).map(c => String.fromCharCode(c)).join('')
      }
      return String.fromCharCode(codes[0] as number)
    }
    case 'ord': {
      const s = evalArgs()[0] as string
      return s.charCodeAt(0)
    }

    // Search and lookup functions
    case 'search': {
      const [needle, haystack, numMatches, indexBase] = evalArgs()
      const base = (indexBase as number) ?? 0
      const results: number[] = []

      if (Array.isArray(haystack)) {
        for (let i = 0; i < haystack.length; i++) {
          if (haystack[i] === needle) {
            results.push(i + base)
            if (numMatches && results.length >= (numMatches as number)) break
          }
        }
      }
      return results
    }
    case 'lookup': {
      const [key, table] = evalArgs()
      const k = key as number
      const t = table as number[][]

      if (!Array.isArray(t) || t.length === 0) return undefined

      // Sort table by key
      const sorted = [...t].sort((a, b) => a[0] - b[0])

      // Find interpolation
      if (k <= sorted[0][0]) return sorted[0][1]
      if (k >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1]

      for (let i = 0; i < sorted.length - 1; i++) {
        if (k >= sorted[i][0] && k <= sorted[i + 1][0]) {
          const x0 = sorted[i][0]
          const x1 = sorted[i + 1][0]
          const y0 = sorted[i][1]
          const y1 = sorted[i + 1][1]
          return y0 + (y1 - y0) * (k - x0) / (x1 - x0)
        }
      }
      return undefined
    }

    // Type checking
    case 'is_undef':
      return evalArgs()[0] === undefined
    case 'is_bool':
      return typeof evalArgs()[0] === 'boolean'
    case 'is_num':
      return typeof evalArgs()[0] === 'number'
    case 'is_string':
      return typeof evalArgs()[0] === 'string'
    case 'is_list':
      return Array.isArray(evalArgs()[0])

    default:
      return undefined
  }
}

/**
 * Expand a range to an array
 */
export function expandRange(range: IRRange): number[] {
  const { start, end, step = 1 } = range
  const result: number[] = []

  if (step > 0) {
    for (let i = start; i <= end; i += step) {
      result.push(i)
    }
  } else if (step < 0) {
    for (let i = start; i >= end; i += step) {
      result.push(i)
    }
  }

  return result
}

/**
 * Evaluate a list comprehension for expression: [for (i = [0:5]) expr]
 */
function evaluateLcFor(
  expr: {
    args: Array<{ name: string; value: Expression }>
    expr: Expression
  },
  scope: Scope
): IRValue[] {
  const result: IRValue[] = []

  // Handle single or multiple loop variables
  function iterate(argIndex: number, loopScope: Scope) {
    if (argIndex >= expr.args.length) {
      // All variables bound, evaluate the body
      const value = evaluateExpression(expr.expr, loopScope)
      // Handle nested list comprehension results
      if (Array.isArray(value) && expr.expr.constructor.name === 'LcForExpr') {
        result.push(...value)
      }
      // Handle conditional (LcIfExpr) that returns undefined for filtered items
      else if (value !== undefined) {
        result.push(value)
      }
      return
    }

    const arg = expr.args[argIndex]
    const rangeValue = evaluateExpression(arg.value, loopScope)

    // Expand range or use array directly
    let values: IRValue[]
    if (rangeValue && typeof rangeValue === 'object' && 'type' in rangeValue && rangeValue.type === 'range') {
      values = expandRange(rangeValue as IRRange)
    } else if (Array.isArray(rangeValue)) {
      values = rangeValue
    } else {
      values = [rangeValue]
    }

    // Iterate over values
    for (const value of values) {
      const iterScope = createChildScope(loopScope)
      setVariable(iterScope, arg.name, value)
      iterate(argIndex + 1, iterScope)
    }
  }

  iterate(0, scope)
  return result
}

/**
 * Evaluate a list comprehension if expression: [for (i = [0:5]) if (i > 2) expr]
 */
function evaluateLcIf(
  expr: {
    cond: Expression
    ifExpr: Expression
    elseExpr?: Expression | null
  },
  scope: Scope
): IRValue {
  const cond = evaluateExpression(expr.cond, scope)

  if (cond) {
    return evaluateExpression(expr.ifExpr, scope)
  } else if (expr.elseExpr) {
    return evaluateExpression(expr.elseExpr, scope)
  }

  // Return a special marker that will be filtered out
  return undefined as any
}

/**
 * Evaluate each expression: [each arr] to flatten
 */
function evaluateLcEach(
  expr: {
    expr: Expression
  },
  scope: Scope
): IRValue {
  const value = evaluateExpression(expr.expr, scope)
  // Mark this for flattening - the VectorExpr handler should flatten these
  if (Array.isArray(value)) {
    return { __each: true, values: value } as any
  }
  return value
}

/**
 * Evaluate let expression: let(x = 5) expr
 */
function evaluateLet(
  expr: {
    args: Array<{ name: string; value: Expression }>
    expr: Expression
  },
  scope: Scope
): IRValue {
  // Create new scope for let bindings
  const letScope = createChildScope(scope)

  // Bind each variable (they can reference previous ones)
  for (const arg of expr.args) {
    const value = evaluateExpression(arg.value, letScope)
    setVariable(letScope, arg.name, value)
  }

  // Evaluate the body expression
  return evaluateExpression(expr.expr, letScope)
}
