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
import { WarningCode, pushScope, popScope, lookupBinding } from './context.js'
import { safeIdentifier } from '../utils/identifiers.js'
import { isStackSpecialVar } from './specialVars.js'
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
 * Check if an expression evaluates to a function value
 * This includes:
 * - Direct function declarations: function(x) x*2
 * - Ternary expressions where both branches are functions: cond ? function(x) ... : function(y) ...
 * - Ternary expressions with is_function/is_func condition: is_func(x) ? x : ...
 * - Let expressions with function-valued body: let(a=1) function(x) x*2
 * - Assert expressions with function-valued body: assert(...) function(x) x*2
 * Used to track local function bindings in let expressions
 */
export function isFunctionLiteralExpr(expr: Expression | null): boolean {
  if (!expr) return false
  // Direct function declaration
  if (isFunctionDeclaration(expr as unknown as import('openscad-parser').Statement)) return true
  // Ternary where both branches are functions
  if (isTernaryExpr(expr)) {
    // Check if both branches are functions
    if (isFunctionLiteralExpr(expr.ifExpr) && isFunctionLiteralExpr(expr.elseExpr)) {
      return true
    }
    // Check if condition is is_function() or is_func() call
    // This pattern (is_func(x) ? x : table[i][1]) always returns a function
    if (isFunctionCallExpr(expr.cond)) {
      const fnExpr = expr.cond as import('openscad-parser').FunctionCallExpr
      if (isLookupExpr(fnExpr.callee)) {
        const callee = fnExpr.callee.name
        if (callee === 'is_function' || callee === 'is_func') {
          return true
        }
      }
    }
    return false
  }
  // Grouping expression - check inner (uses 'inner' property, not 'expr')
  if (isGroupingExpr(expr)) return isFunctionLiteralExpr((expr as { inner: Expression }).inner)
  // Let expression - check if body is function-valued
  if (isLetExpr(expr) || isLcLetExpr(expr)) {
    return isFunctionLiteralExpr(expr.expr)
  }
  // Assert expression - check if the result expression is function-valued
  if (isAssertExpr(expr)) {
    return isFunctionLiteralExpr((expr as import('openscad-parser').AssertExpr).expr)
  }
  return false
}

/**
 * Helper to transpile let bindings (used by both LetExpr and LcLetExpr)
 * Creates an IIFE with const bindings and returns the body expression result
 */
function transpileLetBindings(
  args: readonly { name: string; value: Expression | null }[],
  bodyExpr: Expression,
  ctx: TranspileContext
): string {
  const suffix = `$${ctx.letCounter || 1}`
  ctx.letCounter = (ctx.letCounter || 1) + 1

  const bindings: string[] = []
  const functionBindings: string[] = []  // Track which bindings are functions (for cleanup)

  // Use incremental scope: each binding value sees only earlier bindings
  const incrementalScope = new Map<string, string>()
  pushScope(ctx, incrementalScope)

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const origName = safeIdentifier(a.name)
    const newName = `${origName}${suffix}`

    // Check if this is a function literal (for recursive self-reference support)
    // This includes direct function declarations and ternary expressions returning functions
    const isFuncLiteral = a.value && isFunctionLiteralExpr(a.value)
    if (isFuncLiteral) {
      functionBindings.push(origName)
      // Register function binding IMMEDIATELY so subsequent bindings can call it
      ctx.localFunctionBindings.set(origName, newName)
      // Also add to scope for self-reference
      incrementalScope.set(origName, newName)
    }

    // Transpile value - scope lookup will find earlier bindings automatically
    const value = transpileExpression(a.value!, ctx)
    bindings.push(`const ${newName} = ${value}`)

    // Add this binding to scope for subsequent bindings
    if (!isFuncLiteral) {
      incrementalScope.set(origName, newName)
    }
  }

  // Transpile body - all bindings are now in scope
  const body = transpileExpression(bodyExpr, ctx)

  // Pop scope and clean up function bindings
  popScope(ctx)
  for (const origName of functionBindings) {
    ctx.localFunctionBindings.delete(origName)
  }

  return `(() => { ${bindings.join('; ')}; return ${body} })()`
}

/**
 * Check if an expression contains LcIfExpr (used to determine if filtering is needed)
 * Note: This does NOT recurse into LcIfExpr branches - it's looking FOR the LcIfExpr itself.
 */
export function containsIfExpr(expr: Expression | null): boolean {
  if (!expr) return false
  if (isLcIfExpr(expr)) return true
  // Check nested expr in LcLetExpr or LetExpr
  if ((isLetExpr(expr) || isLcLetExpr(expr)) && expr.expr) return containsIfExpr(expr.expr)
  return false
}

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
function directlyProducesArray(expr: Expression | null): boolean {
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
function containsNestedForExpr(expr: Expression | null): boolean {
  return containsComprehensionExpr(expr, e => isLcForExpr(e) || isLcForCExpr(e))
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
    // Handle special constant variables
    if (name === '$preview') return 'false'  // Always render as full quality
    if (name === '$t') return '0'  // Animation time defaults to 0
    if (name === '$children') return '_children.length'  // Number of children passed to module
    if (name === '$parent_modules') return '0'  // Module nesting depth (stub: always top-level)
    // Constants from j$ namespace
    if (name === 'PI') return 'j$.PI'

    const safeName = safeIdentifier(name)

    // Check if this variable has been renamed in an enclosing scope (let/for bindings)
    // This must happen FIRST to handle shadowing - a local variable should shadow
    // any special variable from the stack
    const scopedName = lookupBinding(ctx, safeName)
    if (scopedName !== undefined) {
      return scopedName
    }

    // For special variables that aren't locally bound, use stack-based dynamic scoping
    if (isStackSpecialVar(name)) {
      return `j$.getSpecialVar('${name}')`
    }

    // Regular identifier - ensure it's safe for JavaScript
    return safeName
  }

  if (isVectorExpr(expr)) {
    const children = expr.children
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
    // Handle 'each' keyword, for comprehensions, and conditionals in list literals
    // - 'each' keyword: [0, each arr] -> [0, ...arr] (flattens its argument)
    // - 'for' comprehension: [0, for (i=r) i, 1] -> [0, ...r.map(i=>i), 1]
    //   When a for comprehension is mixed with other elements, it needs to be spread
    //   because the for generates an array, and we want the elements flattened
    // - 'if' conditional: [0, if(cond) val, 1] -> [0, cond?val:undefined, 1].filter(x=>x!==undefined)
    //   Conditionals produce undefined when false, which must be filtered out
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
          // Transpile the conditional for spread context, handling nested if/else chains
          const transpileForSpread = (ifEx: { cond: Expression, ifExpr: Expression, elseExpr?: Expression | null }): string => {
            const cond = transpileExpression(ifEx.cond, ctx)
            const body = transpileExpression(ifEx.ifExpr, ctx)
            if (!ifEx.elseExpr) {
              // No else - use empty array when false
              return `(${cond} ? ${body} : [])`
            }
            // Check if else DIRECTLY produces array (not through nested conditionals)
            const elseDirectlyProducesArray = directlyProducesArray(ifEx.elseExpr)
            if (elseDirectlyProducesArray) {
              // Else directly produces array (each/for) - use it directly
              const elsePart = transpileExpression(ifEx.elseExpr, ctx)
              return `(${cond} ? ${body} : ${elsePart})`
            } else if (isLcIfExpr(ifEx.elseExpr)) {
              // Else is a nested conditional - recursively handle it
              const nestedIf = ifEx.elseExpr as { cond: Expression, ifExpr: Expression, elseExpr?: Expression | null }
              const nestedProducesArray = containsNestedForExpr(nestedIf.ifExpr) || isEachExpr(nestedIf.ifExpr)
              if (nestedProducesArray) {
                // Nested if also produces array - recurse
                const elsePart = transpileForSpread(nestedIf)
                return `(${cond} ? ${body} : ${elsePart})`
              } else {
                // Nested if doesn't produce array - wrap the whole else
                const elsePart = transpileExpression(ifEx.elseExpr, ctx)
                return `(${cond} ? ${body} : [${elsePart}])`
              }
            } else {
              // else is a single value - wrap it in array
              const elsePart = transpileExpression(ifEx.elseExpr, ctx)
              return `(${cond} ? ${body} : [${elsePart}])`
            }
          }
          return `...${transpileForSpread(ifExpr)}`
        }
      }
      return transpileExpression(c, ctx)
    })
    // If there are conditionals (LcIfExpr), filter out undefined values
    // OpenSCAD: [if(cond) x] produces [] when cond is false, not [undefined]
    // Note: conditionals with for-loops are already spread, so they don't produce undefined
    if (hasConditionals) {
      return `[${parts.join(', ')}].filter(x => x !== undefined)`
    }
    return `[${parts.join(', ')}]`
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
    // Handle logical operators with OpenSCAD truthiness
    // In OpenSCAD, empty arrays are falsy (unlike JavaScript)
    if (expr.operation === TokenType.AND) {
      ctx.usedHelpers.add('isTruthy')
      // a && b: if a is truthy, return b; otherwise return a
      return `(j$.isTruthy(${left}) ? ${right} : ${left})`
    }
    if (expr.operation === TokenType.OR) {
      ctx.usedHelpers.add('isTruthy')
      // a || b: if a is truthy, return a; otherwise return b
      return `(j$.isTruthy(${left}) ? ${left} : ${right})`
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
    // Logical NOT needs OpenSCAD truthiness semantics
    // In OpenSCAD, empty arrays [] are falsy, but in JavaScript they're truthy
    if (op === '!') {
      ctx.usedHelpers.add('isTruthy')
      return `!j$.isTruthy(${right})`
    }
    return `${op}${right}`
  }

  if (isTernaryExpr(expr)) {
    const cond = transpileExpression(expr.cond, ctx)
    const ifExpr = transpileExpression(expr.ifExpr, ctx)
    const elseExpr = transpileExpression(expr.elseExpr, ctx)
    // Use j$.isTruthy() for OpenSCAD semantics (empty arrays are falsy)
    ctx.usedHelpers.add('isTruthy')
    return `(j$.isTruthy(${cond}) ? ${ifExpr} : ${elseExpr})`
  }

  if (isArrayLookupExpr(expr)) {
    const array = transpileExpression(expr.array, ctx)
    const index = transpileExpression(expr.index, ctx)
    // Use optional chaining to handle undefined arrays gracefully (OpenSCAD returns undef)
    return `${array}?.[${index}]`
  }

  if (isFunctionCallExpr(expr)) {
    const fnExpr = expr as FunctionCallExpr
    // OpenSCAD has separate namespaces for functions and variables.
    // When calling rot(...), it calls the FUNCTION rot(), not a parameter named rot.
    // For simple identifiers, use the original name without scope lookup.
    // For complex expressions (array[0](...), obj.method(...)), transpile normally.
    let callee: string
    if (isLookupExpr(fnExpr.callee)) {
      // Simple identifier - use original name (function namespace)
      callee = safeIdentifier(fnExpr.callee.name)
    } else {
      // Complex expression - transpile normally
      callee = transpileExpression(fnExpr.callee, ctx)
    }

    // Build args array with name+value pairs (like statements.ts does for modules)
    const argsArray = fnExpr.args.map(a => ({
      name: a.name || null,
      value: transpileExpression(a.value!, ctx)
    }))

    // Separate special variables ($fn, $fa, $fs, etc.) from regular args
    // Special variables use dynamic scoping in OpenSCAD
    const specialVars: Array<{name: string, value: string}> = []
    const regularArgs: Array<{name: string | null, value: string}> = []

    for (const arg of argsArray) {
      if (arg.name && arg.name.startsWith('$')) {
        specialVars.push({ name: arg.name, value: arg.value })
      } else {
        regularArgs.push(arg)
      }
    }

    // Reorder named arguments to match parameter definition order
    // Note: function calls use _$f suffix which is added in transpileFunctionCall
    // preferFunction=true because this is a function call (uses return value)
    const args = reorderNamedArgs(callee, regularArgs, ctx, true)

    const callExpr = transpileFunctionCall(callee, args, ctx)

    // If special variables were passed, wrap in dynamic scoping context
    // OpenSCAD special vars ($fn, $fa, $fs, etc.) use stack-based dynamic scoping
    if (specialVars.length > 0) {
      // Generate pushScope/setSpecialVar/call/popScope code
      // Example: (() => { j$.pushScope(); j$.setSpecialVar('$fn', 6); try { return expr; } finally { j$.popScope(); } })()
      const sets = specialVars.map(sv => `j$.setSpecialVar('${sv.name}', ${sv.value})`).join('; ')
      return `(() => { j$.pushScope(); ${sets}; try { return ${callExpr}; } finally { j$.popScope(); } })()`
    }

    return callExpr
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

    // Build scope for loop variables - they shadow any outer variables with the same name
    // The loop variables are used directly as arrow function parameters (no renaming needed)
    const loopScope = new Map<string, string>()
    for (const arg of args) {
      loopScope.set(arg.name, arg.name)
    }

    // Push scope so inner expression sees loop variables with their original names
    pushScope(ctx, loopScope)
    const innerExpr = transpileExpression(forExpr.expr, ctx)
    popScope(ctx)

    // Check if inner expression contains LcIfExpr (needs filtering)
    const needsFilter = containsIfExpr(forExpr.expr)
    // Check if inner expression uses 'each' or contains nested 'for' (needs flatMap for flattening)
    // In OpenSCAD: [for (i=...) for (j=...) expr] produces a flat list, not nested arrays
    const needsFlatMap = isEachExpr(forExpr.expr) || containsNestedForExpr(forExpr.expr)

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

    // Build scope incrementally - each initializer can see previous variables
    // This is important for patterns like: for (i=0, x=f(i), y=f(x); ...)
    const loopScope = new Map<string, string>()
    pushScope(ctx, loopScope)

    // Initial assignments - each value is transpiled with current scope,
    // then the variable is added to scope for subsequent initializers
    const initParts: string[] = []
    for (const a of forCExpr.args) {
      // Transpile value BEFORE adding this var to scope (it shouldn't see itself)
      const value = transpileExpression(a.value!, ctx)
      const origName = safeIdentifier(a.name)
      const suffixedName = `${origName}${suffix}`
      initParts.push(`let ${suffixedName} = ${value}`)
      // Now add to scope so subsequent initializers can reference it
      loopScope.set(origName, suffixedName)
    }
    const inits = initParts.join('; ')

    // Scope already pushed above for condition, body, and increment

    // Add increment-only variables to scope BEFORE transpiling condition/body/incr
    // Increment section may have new variables not in init (e.g., v1, c1, etc.)
    // and they reference each other (c1 = v1*v1), so all need to be in scope
    // Also collect increment-only vars to declare them
    const incrOnlyVars: string[] = []
    for (const a of forCExpr.incrArgs) {
      const origName = safeIdentifier(a.name)
      if (!loopScope.has(origName)) {
        const suffixedName = `${origName}${suffix}`
        loopScope.set(origName, suffixedName)
        incrOnlyVars.push(suffixedName)
      }
    }
    // Declare increment-only variables (they'll be assigned in the while loop)
    const incrOnlyDecl = incrOnlyVars.length > 0 ? `let ${incrOnlyVars.join(', ')};` : ''

    // Condition
    const cond = transpileExpression(forCExpr.cond, ctx)

    // Body expression
    const body = transpileExpression(forCExpr.expr, ctx)

    // Increment assignments - MUST be sequential, not parallel!
    // In OpenSCAD, later increment expressions can use earlier variables' new values:
    // e.g., "v1 = path[i+1]-path[i], c1 = v1*v1" - c1 uses the NEW v1
    // Using destructuring like [v1, c1] = [expr1, expr2] would evaluate expr2
    // with the OLD v1, which is wrong.
    const incrParts: string[] = []
    for (const a of forCExpr.incrArgs) {
      const value = transpileExpression(a.value!, ctx)
      const varName = `${safeIdentifier(a.name)}${suffix}`
      incrParts.push(`${varName} = ${value}`)
    }
    const incrUpdate = incrParts.join('; ')

    popScope(ctx)

    return `(() => { const _result${suffix} = []; ${inits}; ${incrOnlyDecl} while (${cond}) { _result${suffix}.push(${body}); ${incrUpdate}; } return _result${suffix}; })()`
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
    return transpileLetBindings((expr as LetExpr).args, (expr as LetExpr).expr, ctx)
  }

  if (isLcLetExpr(expr)) {
    // List comprehension let: [for (x = range) let(a = 1) expr]
    // Handled the same way as LetExpr - create IIFE with bindings
    return transpileLetBindings((expr as LcLetExpr).args, (expr as LcLetExpr).expr, ctx)
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
  ctx: TranspileContext,
  preferFunction = false
): string {
  // Get parameter list for this module/function
  // preferFunction=true means this is a function call context (uses return value)
  // In that case, prefer functionParamLists since functions often have extra params (like p in rot)
  const moduleParams = ctx.moduleParamLists.get(name)
  const functionParams = ctx.functionParamLists.get(name)

  // Choose the best parameter list based on call context:
  // - preferFunction=true (function call): prefer function params
  // - preferFunction=false (module instantiation): prefer module params
  // IMPORTANT: Module and function definitions can have different parameter orders
  // (e.g., BOSL2's prismoid module has xang/yang before rounding, but the function has them at the end)
  // We must respect the call context to get the correct parameter order.
  let paramList: string[] | undefined
  if (preferFunction) {
    // Function call context - prefer function params, fall back to module params
    paramList = functionParams || moduleParams
  } else {
    // Module instantiation context - prefer module params, fall back to function params
    paramList = moduleParams || functionParams
  }

  // If we don't have parameter info, or no named args, fall back to positional order
  const hasNamedArgs = argsArray.some(a => a.name !== null)
  if (!paramList || !hasNamedArgs) {
    return argsArray.map(a => a.value).join(', ')
  }

  // Build a map of named arguments
  const namedArgMap = new Map<string, string>()
  // Track which parameters were explicitly provided (not just filled with undefined)
  const explicitlyProvided = new Set<string>()
  let positionalIndex = 0

  for (const arg of argsArray) {
    if (arg.name) {
      namedArgMap.set(arg.name, arg.value)
      explicitlyProvided.add(arg.name)
    } else {
      // Track positional args by their index in the parameter list
      while (positionalIndex < paramList.length && namedArgMap.has(paramList[positionalIndex])) {
        positionalIndex++
      }
      if (positionalIndex < paramList.length) {
        namedArgMap.set(paramList[positionalIndex], arg.value)
        explicitlyProvided.add(paramList[positionalIndex])
        positionalIndex++
      }
    }
  }

  // Build reordered argument list
  const result: string[] = []
  const wasExplicit: boolean[] = []
  for (const paramName of paramList) {
    if (namedArgMap.has(paramName)) {
      let value = namedArgMap.get(paramName)!
      const isExplicit = explicitlyProvided.has(paramName)
      // If caller explicitly passed 'undefined' (from 'undef' literal), use the EXPLICIT_UNDEF sentinel.
      // This prevents JavaScript's default parameter behavior from overriding the caller's intent.
      // j$.EXPLICIT_UNDEF is a Symbol that won't trigger defaults and is treated as undefined in comparisons.
      if (value === 'undefined' && isExplicit) {
        value = 'j$.EXPLICIT_UNDEF'
      }
      result.push(value)
      wasExplicit.push(isExplicit)
    } else {
      result.push('undefined')
      wasExplicit.push(false)
    }
  }

  // Trim trailing undefined values, but only if they weren't explicitly provided
  // This is important for cases like `foo(x=undef)` where undef should override the default
  // Note: j$.EXPLICIT_UNDEF values are always explicit, so they won't be trimmed
  while (result.length > 0 && result[result.length - 1] === 'undefined' && !wasExplicit[result.length - 1]) {
    result.pop()
    wasExplicit.pop()
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
    log: 'Math.log10',  // OpenSCAD log() is base 10
    ln: 'Math.log',     // OpenSCAD ln() is natural log (base e)
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

  // is_undef() -> typeof value === 'undefined' OR value is j$.EXPLICIT_UNDEF
  // Using typeof prevents ReferenceError when checking undefined variables (like BOSL2 flags)
  // We also check for j$.EXPLICIT_UNDEF because that sentinel represents explicit undef passed as argument
  if (callee === 'is_undef') {
    return `((typeof (${args}) === 'undefined') || (${args}) === j$.EXPLICIT_UNDEF)`
  }

  // is_def() -> typeof value !== 'undefined' AND value is not j$.EXPLICIT_UNDEF  (BOSL compatibility)
  if (callee === 'is_def') {
    return `((typeof (${args}) !== 'undefined') && (${args}) !== j$.EXPLICIT_UNDEF)`
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

  // is_function() -> typeof === 'function' (OpenSCAD 2021.01+)
  if (callee === 'is_function') {
    return `(typeof (${args}) === 'function')`
  }

  // concat() -> [..., ...]
  if (callee === 'concat') {
    return `[].concat(${args})`
  }

  // Helper functions from j$ runtime
  const helperFuncs = ['norm', 'cross', 'lookup', 'rands', 'search', 'version_num', 'str', 'chr', 'ord', 'reverse']
  if (helperFuncs.includes(callee)) {
    return `j$.${callee}(${args})`
  }

  // echo() for debugging - map to console.log
  if (callee === 'echo') {
    return `console.log(${args})`
  }

  // Check if this is a local function binding (from a let/for expression)
  // In OpenSCAD, variables and functions have SEPARATE namespaces
  // e.g., let(scale = [1,2,3]) scale(cube(1)) - scale is a variable, scale() is a function
  // We only intercept if we're SURE the binding is a function value
  // This is tracked via localFunctionBindings (detected via isFunctionLiteralExpr)
  const localBinding = ctx.localFunctionBindings.get(callee)
  if (localBinding) {
    return `${localBinding}(${args})`
  }

  // User-defined function call - use _$f suffix for namespace separation
  // Only add suffix for simple identifiers (named function calls)
  // Don't add for complex expressions like array[0](args) or obj.method(args)
  const isSimpleIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(callee)
  if (isSimpleIdentifier) {
    return `${callee}_$f(${args})`
  }
  // Complex expression (array access, member access, etc.) - call directly
  return `${callee}(${args})`
}
