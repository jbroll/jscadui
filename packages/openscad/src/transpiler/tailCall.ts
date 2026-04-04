/**
 * Tail-call optimization for self-recursive OpenSCAD functions.
 *
 * Detects self-recursive calls in tail position and transforms them into
 * bounce objects that are caught by an inline while-loop trampoline.
 * This converts O(n) stack depth to O(1) for accumulator-style recursion.
 *
 * Design:
 * - No runtime helpers needed — trampoline logic is inlined into each function
 * - Bounce is a plain object: { __bounce__: true, args: { param: value, ... } }
 * - Both _$f and _$f$obj variants get the same while-loop wrapper
 * - Only handles self-recursion (not mutual recursion)
 */

import type { Expression, FunctionCallExpr, TernaryExpr, LetExpr, AssertExpr, EchoExpr, GroupingExpr } from './ast-types.js'  // EchoExpr and GroupingExpr used in type assertions
import {
  isTernaryExpr,
  isLetExpr,
  isFunctionCallExpr,
  isLookupExpr,
  isAssertExpr,
  isEchoExpr,
  isGroupingExpr,
} from './ast-types.js'
import { safeIdentifier } from '../utils/identifiers.js'

// Track which AST nodes are tail-position self-calls, without mutating the AST.
// Using a Set<object> (not WeakSet) so we can clear it between transpilation passes.
let tailCallMarked = new Set<object>()

/**
 * Check if a function body contains self-calls in tail position.
 * Also marks the tail-call AST nodes with _tailCallBounce = true.
 *
 * @param funcName - The OpenSCAD function name (before _$f suffix)
 * @param expr - The function body expression AST
 * @returns true if any tail-position self-calls were found and marked
 */
export function markTailCalls(funcName: string, expr: Expression): boolean {
  return markInTailPosition(funcName, expr)
}

/**
 * Walk the expression tree, following tail positions only.
 * When a self-call is found in tail position, mark it.
 */
function markInTailPosition(funcName: string, expr: Expression): boolean {
  if (!expr) return false

  // Ternary: both branches are in tail position
  if (isTernaryExpr(expr)) {
    const t = expr as TernaryExpr
    const a = markInTailPosition(funcName, t.ifExpr)
    const b = markInTailPosition(funcName, t.elseExpr)
    return a || b
  }

  // Let expression: body is in tail position
  if (isLetExpr(expr)) {
    const l = expr as LetExpr
    return markInTailPosition(funcName, l.expr)
  }

  // Assert expression: body (continuation) is in tail position
  if (isAssertExpr(expr)) {
    const a = expr as AssertExpr
    if (a.expr) return markInTailPosition(funcName, a.expr)
    return false
  }

  // Echo expression: body (continuation) is in tail position
  if (isEchoExpr(expr)) {
    const e = expr as EchoExpr
    if (e.expr) return markInTailPosition(funcName, e.expr)
    return false
  }

  // Grouping expression (parentheses): inner is in tail position
  if (isGroupingExpr(expr)) {
    return markInTailPosition(funcName, (expr as GroupingExpr).inner)
  }

  // Function call: check if it's a self-call
  if (isFunctionCallExpr(expr)) {
    const fn = expr as FunctionCallExpr
    // The callee must be a simple lookup (identifier), not a complex expression
    if (isLookupExpr(fn.callee) && fn.callee.name === funcName) {
      tailCallMarked.add(fn)
      return true
    }
    return false
  }

  // Everything else (binary ops, unary ops, array access, etc.) is NOT tail position
  return false
}

/**
 * Check if a function call expression was marked as a tail-position self-call.
 */
export function isTailCallMarked(expr: FunctionCallExpr): boolean {
  return tailCallMarked.has(expr)
}

/**
 * Clear all tail-call marks. Call after transpilation to reset state.
 */
export function clearTailCallMarks(): void {
  tailCallMarked = new Set()
}

/**
 * Generate the bounce object for a tail-position self-call.
 * Maps call arguments (positional and named) to parameter names.
 *
 * @param paramNames - The function's parameter names (safe identifiers)
 * @param fnExpr - The function call AST node
 * @param transpileExprFn - Function to transpile argument expressions to JS strings
 * @returns JS string for the bounce object: { __bounce__: true, args: { ... } }
 */
export function emitBounce(
  paramNames: string[],
  fnExpr: FunctionCallExpr,
  transpileExprFn: (expr: Expression) => string
): string {
  const args = fnExpr.args || []
  const entries: string[] = []
  const usedNames = new Set<string>()
  let positionalIndex = 0

  // First pass: collect named args
  for (const arg of args) {
    if (arg.name) {
      const safeName = safeIdentifier(arg.name)
      // Skip $-prefixed special variables (they're handled by withScope)
      if (safeName.startsWith('$')) continue
      entries.push(`${safeName}: ${transpileExprFn(arg.value!)}`)
      usedNames.add(safeName)
    }
  }

  // Second pass: map positional args to param names
  for (const arg of args) {
    if (!arg.name) {
      // Find next unused param slot
      while (positionalIndex < paramNames.length && usedNames.has(paramNames[positionalIndex])) {
        positionalIndex++
      }
      if (positionalIndex < paramNames.length) {
        const paramName = paramNames[positionalIndex]
        entries.push(`${paramName}: ${transpileExprFn(arg.value!)}`)
        usedNames.add(paramName)
        positionalIndex++
      }
    }
  }

  return `{__bounce__: true, args: {${entries.join(', ')}}}`
}

/**
 * Generate the destructuring reassignment for the while-loop continuation.
 * Creates: ({p1 = default1, p2, p3 = default3, ...} = _r.args)
 *
 * @param paramNames - The function's parameter names (safe identifiers)
 * @param paramDefaults - Map of param name → default value JS string (undefined = no default)
 * @returns JS statement string for the destructuring reassignment
 */
export function buildBounceReassignment(
  paramNames: string[],
  paramDefaults: Map<string, string>
): string {
  const parts = paramNames.map(name => {
    const defaultVal = paramDefaults.get(name)
    return defaultVal !== undefined ? `${name} = ${defaultVal}` : name
  })
  return `({${parts.join(', ')}} = _r.args)`
}
