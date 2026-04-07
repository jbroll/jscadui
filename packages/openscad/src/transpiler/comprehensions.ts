/**
 * List comprehension and vector expression handling
 */
import type { Expression } from 'openscad-parser'
import type { TranspileContext } from './context.js'
import {
  isLcEachExpr,
  isLcForExpr,
  isLcForCExpr,
  isLcIfExpr,
  isLetExpr,
  isLcLetExpr,
} from './ast-types.js'

// Circular dependency is OK here - transpileExpression is only called at runtime,
// not at module initialization time
import { transpileExpression } from './expressions.js'

/**
 * Generic walker for list comprehension expressions.
 * Recurses through Let expressions and checks both branches of If expressions (OR logic).
 * Used by isEachExpr and containsNestedForExpr which share identical traversal structure.
 */
function containsComprehensionExpr(
  expr: Expression | null,
  predicate: (e: Expression) => boolean
): boolean {
  if (!expr) return false
  if (predicate(expr)) return true
  // Check nested expr in LcLetExpr or LetExpr
  if ((isLetExpr(expr) || isLcLetExpr(expr)) && expr.expr) {
    return containsComprehensionExpr(expr.expr, predicate)
  }
  // Check inside LcIfExpr (either branch may contain the target)
  if (isLcIfExpr(expr)) {
    return containsComprehensionExpr(expr.ifExpr, predicate) ||
           (expr.elseExpr ? containsComprehensionExpr(expr.elseExpr, predicate) : false)
  }
  return false
}

/**
 * Check if an expression is or directly contains LcEachExpr (needs flatMap instead of map)
 */
export function isEachExpr(expr: Expression | null): boolean {
  return containsComprehensionExpr(expr, isLcEachExpr)
}

/**
 * Check if an expression directly produces an array when evaluated
 * Unlike isEachExpr/containsNestedForExpr, this does NOT recurse into LcIfExpr branches
 * because a conditional itself doesn't produce an array - only specific branches do
 * This is used to determine if a specific branch needs array wrapping in spread context
 */
export function directlyProducesArray(expr: Expression | null): boolean {
  if (!expr) return false
  // Direct array-producing expressions
  if (isLcEachExpr(expr)) return true
  if (isLcForExpr(expr) || isLcForCExpr(expr)) return true
  // Check through let wrappers
  if ((isLetExpr(expr) || isLcLetExpr(expr)) && expr.expr) return directlyProducesArray(expr.expr)
  // For LcIfExpr, check if BOTH branches produce arrays (then the whole conditional does)
  // If only some branches produce arrays, the conditional doesn't reliably produce arrays
  if (isLcIfExpr(expr)) {
    const ifProduces = directlyProducesArray(expr.ifExpr)
    const elseProduces = expr.elseExpr ? directlyProducesArray(expr.elseExpr) : false
    // Only return true if ALL branches produce arrays, or if it's an if-only (no else) and if produces
    return ifProduces && (expr.elseExpr ? elseProduces : true)
  }
  return false
}

/**
 * Check if an expression is or directly contains a nested for expression
 * In OpenSCAD: [for (i=...) for (j=...) expr] produces a flat list, not nested arrays
 * This function detects such nested for expressions through let/if wrappers
 */
export function containsNestedForExpr(expr: Expression | null): boolean {
  return containsComprehensionExpr(expr, e => isLcForExpr(e) || isLcForCExpr(e))
}

/**
 * Transpile a conditional expression for spread context in vectors.
 * Handles nested if/else chains where branches produce arrays.
 */
export function transpileConditionalForSpread(
  ifEx: { cond: Expression, ifExpr: Expression, elseExpr?: Expression | null },
  ctx: TranspileContext
): string {
  const cond = transpileExpression(ifEx.cond, ctx)
  ctx.codeGen.usedHelpers.add('isTruthy')
  const boolCond = `j$.isTruthy(${cond})`
  const body = transpileExpression(ifEx.ifExpr, ctx)
  if (!ifEx.elseExpr) {
    // No else - use empty array when false
    return `(${boolCond} ? ${body} : [])`
  }
  // Check if else DIRECTLY produces array (not through nested conditionals)
  const elseDirectlyProducesArray = directlyProducesArray(ifEx.elseExpr)
  if (elseDirectlyProducesArray) {
    // Else directly produces array (each/for) - use it directly
    const elsePart = transpileExpression(ifEx.elseExpr, ctx)
    return `(${boolCond} ? ${body} : ${elsePart})`
  } else if (isLcIfExpr(ifEx.elseExpr)) {
    // Else is a nested conditional - recursively handle it
    const nestedIf = ifEx.elseExpr as { cond: Expression, ifExpr: Expression, elseExpr?: Expression | null }
    const nestedProducesArray = containsNestedForExpr(nestedIf.ifExpr) || isEachExpr(nestedIf.ifExpr)
    if (nestedProducesArray) {
      // Nested if also produces array - recurse
      const elsePart = transpileConditionalForSpread(nestedIf, ctx)
      return `(${boolCond} ? ${body} : ${elsePart})`
    } else {
      // Nested if doesn't produce array - wrap the whole else
      const elsePart = transpileExpression(ifEx.elseExpr, ctx)
      return `(${boolCond} ? ${body} : [${elsePart}])`
    }
  } else {
    // else is a single value - wrap it in array
    const elsePart = transpileExpression(ifEx.elseExpr, ctx)
    return `(${boolCond} ? ${body} : [${elsePart}])`
  }
}

/**
 * Handle pure list comprehension: [for (i = range) expr] or [let(a=1) for (i = range) expr]
 */
export function handlePureComprehension(
  children: Expression[],
  ctx: TranspileContext
): string | null {
  // List comprehension: [for (i = range) expr] has single LcForExpr child
  // LcForExpr already returns an array via .map(), so don't double-wrap
  // Also handle C-style for loops (LcForCExpr) which return an array via IIFE
  if (children.length === 1 && (isLcForExpr(children[0]) || isLcForCExpr(children[0]))) {
    return transpileExpression(children[0], ctx)
  }
  // List comprehension with let: [let(a=1) for (i = range) expr] has single LcLetExpr child
  // The LcLetExpr wraps an LcForExpr, so we need to unwrap
  if (children.length === 1 && isLcLetExpr(children[0])) {
    return transpileExpression(children[0], ctx)
  }
  return null
}

/**
 * Handle mixed vector with comprehensions, 'each', and conditionals:
 * [0, each arr, for(i=r) i, if(c) val]
 */
export function handleMixedVector(
  children: Expression[],
  ctx: TranspileContext
): string {
  // Handle 'each' keyword, for comprehensions, and conditionals in list literals
  // - 'each' keyword: [0, each arr] -> [0, ...arr] (flattens its argument)
  // - 'for' comprehension: [0, for (i=r) i, 1] -> [0, ...r.map(i=>i), 1]
  //   When a for comprehension is mixed with other elements, it needs to be spread
  //   because the for generates an array, and we want the elements flattened
  // - 'if' conditional: [0, if(cond) val, 1] -> [0, cond?val:j$.SKIP, 1].filter(x=>x!==j$.SKIP)
  //   Conditionals produce j$.SKIP when false, which must be filtered out
  // - 'if' with for inside: [if(cond) for(...) expr] -> [...(cond ? forResult : [])]
  //   When the conditional body is a for-loop, the result is an array that needs spreading
  const hasConditionals = children.some(c => isLcIfExpr(c))
  const parts = children.map(c => {
    if (isLcEachExpr(c)) {
      // Spread the inner expression
      return `...${transpileExpression(c.expr, ctx)}`
    }
    if (isLcForExpr(c) || isLcForCExpr(c)) {
      // For comprehensions inside mixed vectors need to be spread
      // [a, for(x=arr) f(x), b] -> [a, ...arr.map(x => f(x)), b]
      // Also handles C-style for loops (LcForCExpr)
      return `...${transpileExpression(c, ctx)}`
    }
    // Check if this is an LcIfExpr containing a for-loop or 'each'
    // [if(cond) for(...) expr] -> [...(cond ? forResult : [])]
    // [if(cond) each arr] -> [...(cond ? arr : [])]
    if (isLcIfExpr(c)) {
      const ifExpr = c as { cond: Expression, ifExpr: Expression, elseExpr?: Expression | null }
      // Check if the body contains a for-loop or 'each' that produces an array
      const ifProducesArray = containsNestedForExpr(ifExpr.ifExpr) || isEachExpr(ifExpr.ifExpr)
      if (ifProducesArray) {
        return `...${transpileConditionalForSpread(ifExpr, ctx)}`
      }
    }
    return transpileExpression(c, ctx)
  })

  // If there are conditionals (LcIfExpr), filter out j$.SKIP sentinels
  // OpenSCAD: [if(cond) x] produces [] when cond is false, not [undefined]
  // Note: conditionals with for-loops are already spread, so they don't produce j$.SKIP.
  // Using j$.SKIP (not undefined) lets OpenSCAD undef values survive the filter —
  // e.g. [if(true) undef, if(false) x] should produce [undef], not [].
  if (hasConditionals) {
    return `[${parts.join(', ')}].filter(x => x !== j$.SKIP)`
  }
  return `[${parts.join(', ')}]`
}

/**
 * Transpile vector expressions: [a, b, c] or [for (i=r) expr] etc.
 * Handles list comprehensions, 'each' spreading, and conditionals.
 */
export function transpileVectorExpr(
  children: Expression[],
  ctx: TranspileContext
): string {
  // Reset inFlatMapContext when entering a vector literal.
  // inFlatMapContext should only affect the TOP-LEVEL expression of a for body.
  // Inside a nested vector like `each [a, if(cond) b]`, the `if(cond) b` item
  // should return undefined (filter-based), not [] (flatMap-based).
  // The for handler will re-set inFlatMapContext if it produces a nested for/each.
  const savedFlatMapContext = ctx.inFlatMapContext
  ctx.inFlatMapContext = false

  // Try pure comprehension first
  const pureResult = handlePureComprehension(children, ctx)
  if (pureResult !== null) {
    ctx.inFlatMapContext = savedFlatMapContext
    return pureResult
  }

  // Handle mixed vectors (default case)
  const result = handleMixedVector(children, ctx)
  ctx.inFlatMapContext = savedFlatMapContext
  return result
}
