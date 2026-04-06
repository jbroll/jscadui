/**
 * Expression transpilation
 */

import { emitBounce, isTailCallMarked } from './tailCall.js'
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
import { WarningCode, lookupBinding } from './context.js'
import { safeIdentifier, isValidIdentifier } from '../utils/identifiers.js'
import { TokenType } from '../utils/tokens.js'
import { generateScopeSuffix, withScope } from './scoping.js'
import {
  transpileVectorExpr,
  isEachExpr,
  containsNestedForExpr,
  directlyProducesArray,
} from './comprehensions.js'
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
import { mapArgsToParams } from './utils.js'
import { shouldUseBuiltin } from './builtins.js'
import type { LcForCExpr } from './ast-types.js'

/**
 * Check if an expression evaluates to a function value
 * This includes:
 * - Direct function declarations: function(x) x*2
 * - Ternary expressions where both branches are functions: cond ? function(x) ... : function(y) ...
 * - Ternary expressions with is_function/is_func condition: is_func(x) ? x : ...
 * - Identifier lookups referencing a known function (when ctx is provided)
 * - Let expressions with function-valued body: let(a=1) function(x) x*2
 * - Assert expressions with function-valued body: assert(...) function(x) x*2
 * Used to track local function bindings in let expressions
 */
export function isFunctionLiteralExpr(expr: Expression | null, ctx?: TranspileContext): boolean {
  if (!expr) return false
  // Direct function declaration
  if (isFunctionDeclaration(expr as unknown as import('openscad-parser').Statement)) return true
  // Identifier lookup for a known function (e.g. let binding assigned a function reference)
  if (ctx && isLookupExpr(expr)) {
    const name = (expr as { name: string }).name
    const binding = ctx.scopes.lookupFunctionBinding(name)
    // For renamed bindings (e.g. `center` → `center$3`), the rename proves
    // it's a let-bound function, not a parameter.
    if (binding !== undefined && binding !== name) return true
    // For identity bindings (name → name), only treat as function-valued if the
    // ScopeManager explicitly recorded it as a function literal assignment.
    // This distinguishes `_dedup_add_some = function(...)` (known function literal)
    // from parameter-scope bindings like `center` which are NOT function-valued.
    if (ctx.scopes.isKnownFunctionLiteral(name)) return true
  }
  // Ternary where both branches are functions
  if (isTernaryExpr(expr)) {
    const ifIsFunc = isFunctionLiteralExpr(expr.ifExpr, ctx)
    const elseIsFunc = isFunctionLiteralExpr(expr.elseExpr, ctx)
    // Check if both branches are functions
    if (ifIsFunc && elseIsFunc) {
      return true
    }
    // If one branch is a function and the other is an assert (which throws on failure
    // and returns undef on success), the ternary is effectively function-valued.
    // Pattern: `cond ? function(...) ... : assert("error")`
    if (ifIsFunc && isAssertExpr(expr.elseExpr)) return true
    if (elseIsFunc && isAssertExpr(expr.ifExpr)) return true
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
  if (isGroupingExpr(expr)) return isFunctionLiteralExpr((expr as { inner: Expression }).inner, ctx)
  // Let expression - check if body is function-valued
  if (isLetExpr(expr) || isLcLetExpr(expr)) {
    return isFunctionLiteralExpr(expr.expr, ctx)
  }
  // Assert expression - check if the result expression is function-valued
  if (isAssertExpr(expr)) {
    return isFunctionLiteralExpr((expr as import('openscad-parser').AssertExpr).expr, ctx)
  }
  return false
}

/**
 * Helper to transpile let bindings (used by both LetExpr and LcLetExpr)
 * Creates an IIFE with const bindings and returns the body expression result.
 *
 * Special variable bindings ($attach_to, $fn, etc.) use j$.withScope() for
 * dynamic scoping, since they must be readable via j$.getSpecialVar() not just
 * as local JS variables.
 */
function transpileLetBindings(
  args: readonly { name: string; value: Expression | null }[],
  bodyExpr: Expression,
  ctx: TranspileContext
): string {
  const suffix = generateScopeSuffix(ctx)

  const bindings: string[] = []
  const functionBindingPairs: Array<[string, string]> = []  // Track function bindings for cleanup
  // Special variable bindings: name -> transpiled value string
  const specialVarBindings: Array<[string, string]> = []

  // Use incremental scope: each binding value sees only earlier bindings
  const incrementalScope = new Map<string, string>()

  // Build bindings and transpile body with scope
  // Note: We manually manage function bindings because they're added incrementally
  const body = withScope(ctx, incrementalScope, () => {
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      const origName = safeIdentifier(a.name)

      // Special variables ($attach_to, $fn, etc.) must use dynamic scoping via
      // j$.withScope so that j$.getSpecialVar() sees the overridden value.
      // A local `const` binding would only affect lexical JS scope, not the
      // dynamic scope stack that getSpecialVar reads from.
      if (a.name.startsWith('$')) {
        const value = transpileExpression(a.value!, ctx)
        specialVarBindings.push([a.name, value])
        // Do NOT add to incrementalScope: subsequent let bindings that reference
        // this special var will still use j$.getSpecialVar (correct behavior),
        // and the body will see the overridden value via withScope.
        continue
      }

      const newName = `${origName}${suffix}`

      // Check if this is a function literal (for recursive self-reference support)
      // This includes direct function declarations, ternary expressions returning functions,
      // and identifier lookups referencing known functions (e.g. cond ? fn1 : fn2)
      const isFuncLiteral = a.value && isFunctionLiteralExpr(a.value, ctx)
      if (isFuncLiteral) {
        // Track for cleanup
        functionBindingPairs.push([origName, newName])
        // Register function binding IMMEDIATELY so subsequent bindings can call it
        // Mark as function literal so isFunctionLiteralExpr can recognize references
        ctx.scopes.registerFunctionBinding(origName, newName, true)
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
    return transpileExpression(bodyExpr, ctx)
  })

  // Clean up function bindings
  for (const [origName] of functionBindingPairs) {
    ctx.scopes.unregisterFunctionBinding(origName)
  }

  // Wrap body in j$.withScope if there are any special variable bindings
  let bodyExprCode: string
  if (specialVarBindings.length > 0) {
    const scopeObj = specialVarBindings.map(([name, val]) => `'${name}': ${val}`).join(', ')
    bodyExprCode = `j$.withScope({ ${scopeObj} }, () => ${body})`
  } else {
    bodyExprCode = body
  }

  if (bindings.length === 0) {
    // No regular bindings - no need for IIFE (unless we still need to wrap)
    return specialVarBindings.length > 0 ? bodyExprCode : body
  }

  return `(() => { ${bindings.join('; ')}; return ${bodyExprCode} })()`
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
 * Transpile variable lookup expression.
 */
function transpileLookupExpr(expr: { name: string }, ctx: TranspileContext): string {
  const name = expr.name
  // Handle special constant variables
  if (name === '$preview') return ctx.options.preview ? 'true' : 'false'
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

  // For special variables that aren't locally bound, use stack-based dynamic scoping.
  // In OpenSCAD, ALL $-prefixed variables have dynamic scoping — not just the known ones.
  // This handles user-defined special variables like $z, $layer_height used in NopSCADlib.
  if (name.startsWith('$')) {
    return `j$.getSpecialVar('${name}')`
  }

  // Regular identifier - track as potential free variable ref if not locally bound.
  // Used by canOptimizeInclude to detect files that reference ambient include-scope variables.
  if (!ctx.currentLocalBindings.has(safeName)) {
    ctx.potentialFreeVarRefs.add(safeName)
  }

  // If this is a lazy variable (defined as a thunk because it references $special vars),
  // call it as a function to get the current dynamic value.
  if (ctx.lazyVarNames.has(safeName)) {
    return `${safeName}()`
  }

  return safeName
}

/**
 * Transpile binary operation expression (a + b, a == b, etc.)
 */
function transpileBinaryOpExpr(
  expr: { left: Expression, right: Expression, operation: number },
  ctx: TranspileContext
): string {
  const left = transpileExpression(expr.left, ctx)
  const right = transpileExpression(expr.right, ctx)

  // Handle equality operators specially - need deep comparison for arrays
  if (expr.operation === TokenType.EqualEqual) {
    ctx.codeGen.usedHelpers.add('eq')
    return `j$.eq(${left}, ${right})`
  }
  if (expr.operation === TokenType.BangEqual) {
    ctx.codeGen.usedHelpers.add('eq')
    return `!j$.eq(${left}, ${right})`
  }

  // Handle arithmetic operators with vector support
  if (expr.operation === TokenType.Plus) {
    ctx.codeGen.usedHelpers.add('vadd')
    return `j$.vadd(${left}, ${right})`
  }
  if (expr.operation === TokenType.Minus) {
    ctx.codeGen.usedHelpers.add('vsub')
    return `j$.vsub(${left}, ${right})`
  }
  if (expr.operation === TokenType.Star) {
    ctx.codeGen.usedHelpers.add('vmul')
    return `j$.vmul(${left}, ${right})`
  }
  if (expr.operation === TokenType.Slash) {
    ctx.codeGen.usedHelpers.add('vdiv')
    return `j$.vdiv(${left}, ${right})`
  }

  // Handle logical operators with OpenSCAD truthiness
  // In OpenSCAD, && and || return true/false (not the last-evaluated value).
  // Using native JS && / || avoids duplicating the left-operand expression,
  // which would cause O(2^n) growth for chained operators.
  if (expr.operation === TokenType.AND) {
    ctx.codeGen.usedHelpers.add('isTruthy')
    return `(j$.isTruthy(${left}) && j$.isTruthy(${right}))`
  }
  if (expr.operation === TokenType.OR) {
    ctx.codeGen.usedHelpers.add('isTruthy')
    return `(j$.isTruthy(${left}) || j$.isTruthy(${right}))`
  }

  const op = transpileBinaryOp(expr.operation)
  return `(${left} ${op} ${right})`
}

/**
 * Transpile unary operation expression (-x, !x)
 */
function transpileUnaryOpExpr(
  expr: { right: Expression, operation: number },
  ctx: TranspileContext
): string {
  const right = transpileExpression(expr.right, ctx)
  const op = transpileUnaryOp(expr.operation)

  // Unary minus on vectors needs special handling (negate each element)
  // But for literal numbers, we can use regular negation
  if (op === '-' && !isLiteralExpr(expr.right)) {
    ctx.codeGen.usedHelpers.add('vneg')
    return `j$.vneg(${right})`
  }

  // Logical NOT needs OpenSCAD truthiness semantics
  // In OpenSCAD, empty arrays [] are falsy, but in JavaScript they're truthy
  if (op === '!') {
    ctx.codeGen.usedHelpers.add('isTruthy')
    return `!j$.isTruthy(${right})`
  }

  return `${op}${right}`
}

/**
 * Transpile ternary expression (cond ? a : b)
 */
function transpileTernaryExpr(
  expr: { cond: Expression, ifExpr: Expression, elseExpr: Expression },
  ctx: TranspileContext
): string {
  const cond = transpileExpression(expr.cond, ctx)
  const ifExpr = transpileExpression(expr.ifExpr, ctx)
  const elseExpr = transpileExpression(expr.elseExpr, ctx)
  // Use j$.isTruthy() for OpenSCAD semantics (empty arrays are falsy)
  ctx.codeGen.usedHelpers.add('isTruthy')
  return `(j$.isTruthy(${cond}) ? ${ifExpr} : ${elseExpr})`
}

/**
 * Transpile array lookup expression (arr[idx])
 */
function transpileArrayLookupExpr(
  expr: { array: Expression, index: Expression },
  ctx: TranspileContext
): string {
  const array = transpileExpression(expr.array, ctx)
  const index = transpileExpression(expr.index, ctx)
  // Use optional chaining to handle undefined arrays gracefully (OpenSCAD returns undef)
  return `${array}?.[${index}]`
}

/**
 * Transpile function call expression: fn(args)
 */
function transpileFunctionCallExprHandler(
  fnExpr: FunctionCallExpr,
  ctx: TranspileContext
): string {
  // Tail-call optimization: if this call was marked as a tail-position self-call,
  // emit a bounce object instead of the actual function call.
  // The bounce is caught by the while-loop trampoline in the enclosing function.
  if (isTailCallMarked(fnExpr) && ctx._tailCallParamNames) {
    return emitBounce(ctx._tailCallParamNames, fnExpr, (expr: Expression) => transpileExpression(expr, ctx))
  }

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
  // Use transpileCallArg so explicit undef → j$.EXPLICIT_UNDEF (prevents JS default params
  // from silently replacing undef with the default value, e.g. param(6, undef) → 0 instead of undef)
  const argsArray = fnExpr.args.map(a => ({
    name: a.name || null,
    value: transpileCallArg(a.value!, ctx)
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
  // kind='function' because this is a function call (uses return value)
  const { args, format } = reorderNamedArgs(callee, regularArgs, ctx, 'function')

  const callExpr = transpileFunctionCall(callee, args, ctx, format)

  // If special variables were passed, wrap in dynamic scoping context
  // OpenSCAD special vars ($fn, $fa, $fs, etc.) use stack-based dynamic scoping
  if (specialVars.length > 0) {
    // Generate withScope call with special variables object
    const vars = specialVars.map(sv => `'${sv.name}': ${sv.value}`).join(', ')
    return `j$.withScope({ ${vars} }, () => ${callExpr})`
  }

  return callExpr
}

/**
 * Check if an AssignmentNode name represents a tuple-destructured variable.
 * Tuple names are encoded by the parser as "(a, b, ...)" strings.
 */
function isTupleName(name: string): boolean {
  return name.startsWith('(') && name.endsWith(')')
}

/**
 * Parse individual variable names from a tuple-encoded name string.
 * "(a, b)" -> ["a", "b"]
 */
function parseTupleNames(name: string): string[] {
  return name.slice(1, -1).split(',').map(s => s.trim())
}

/**
 * Convert a tuple-encoded name to a JS destructuring pattern.
 * "(a, b)" -> "[a, b]"
 */
function tupleToDestructuring(name: string): string {
  const names = parseTupleNames(name)
  return `[${names.join(', ')}]`
}

/**
 * Transpile list comprehension for-loop: [for (i = range) expr]
 */
function transpileLcForExprHandler(
  forExpr: LcForExpr,
  ctx: TranspileContext
): string {
  const args = forExpr.args

  // Build scope for loop variables - they shadow any outer variables with the same name
  // The loop variables are used directly as arrow function parameters (no renaming needed)
  // For tuple-destructured variables like "(a, b)", add each individual name to scope
  const loopScope = new Map<string, string>()
  for (const arg of args) {
    if (isTupleName(arg.name)) {
      for (const n of parseTupleNames(arg.name)) loopScope.set(n, n)
    } else {
      loopScope.set(arg.name, arg.name)
    }
  }

  // Check if inner expression contains LcIfExpr (needs filtering)
  const needsFilter = containsIfExpr(forExpr.expr)
  // Check if inner expression uses 'each' or contains nested 'for' (needs flatMap for flattening)
  // In OpenSCAD: [for (i=...) for (j=...) expr] produces a flat list, not nested arrays
  const needsFlatMap = isEachExpr(forExpr.expr) || containsNestedForExpr(forExpr.expr)

  // Set inFlatMapContext so LcIfExpr knows to wrap non-array branches to prevent flattening
  const savedFlatMapContext = ctx.inFlatMapContext
  if (needsFlatMap) ctx.inFlatMapContext = true

  // Transpile inner expression with loop variables in scope
  const innerExpr = withScope(ctx, loopScope, () => transpileExpression(forExpr.expr, ctx))

  ctx.inFlatMapContext = savedFlatMapContext

  if (args.length === 1) {
    // For tuple-destructured variables: (a, b) => [a, b] destructuring pattern
    const varName = isTupleName(args[0].name) ? tupleToDestructuring(args[0].name) : args[0].name
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
    const varName = isTupleName(args[i].name) ? tupleToDestructuring(args[i].name) : args[i].name
    const range = transpileExpression(args[i].value!, ctx)
    const isInnermost = i === args.length - 1
    const method = isInnermost ? (needsFlatMap ? 'flatMap' : 'map') : 'flatMap'
    // Wrap range with j$.iter() to handle strings (OpenSCAD: for (c = "str") iterates chars)
    result = `j$.iter(${range}).${method}(${varName} => ${result})`
  }
  return needsFilter ? `${result}.filter(x => x !== undefined)` : result
}

/**
 * Transpile C-style for loop: [for (c = 1, i = 0; i <= n; c = c*(...), i = i+1) c]
 */
function transpileLcForCExprHandler(
  forCExpr: LcForCExpr,
  ctx: TranspileContext
): string {
  const suffix = generateScopeSuffix(ctx)

  // Build scope incrementally - each initializer can see previous variables
  // This is important for patterns like: for (i=0, x=f(i), y=f(x); ...)
  const loopScope = new Map<string, string>()

  // Build scope and transpile with scope active throughout
  const { inits, incrOnlyDecl, cond, body, incrUpdate } = withScope(ctx, loopScope, () => {
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

    // Add increment-only variables to scope BEFORE transpiling condition/body/incr
    // Increment section may have new variables not in init (e.g., v1, c1, etc.)
    // and they reference each other (c1 = v1*v1), so all need to be in scope
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
    // In OpenSCAD, later increment expressions can use earlier variables' new values
    const incrParts: string[] = []
    for (const a of forCExpr.incrArgs) {
      const value = transpileExpression(a.value!, ctx)
      const varName = `${safeIdentifier(a.name)}${suffix}`
      incrParts.push(`${varName} = ${value}`)
    }
    const incrUpdate = incrParts.join('; ')

    return { inits, incrOnlyDecl, cond, body, incrUpdate }
  })

  // If body is a conditional (LcIfExpr without else), it produces undefined for non-matching
  // iterations. Filter those out so [for (a=x, i=1; ...; ...) if (cond) a][0] works correctly.
  const needsFilter = containsIfExpr(forCExpr.expr)
  const resultExpr = needsFilter ? `_result${suffix}.filter(x => x !== undefined)` : `_result${suffix}`
  return `(() => { const _result${suffix} = []; ${inits}; ${incrOnlyDecl} while (${cond}) { _result${suffix}.push(${body}); ${incrUpdate}; } return ${resultExpr}; })()`
}

export function transpileExpression(expr: Expression, ctx: TranspileContext): string {
  if (isLiteralExpr(expr)) return transpileLiteral(expr.value as string | number | boolean | null)
  if (isLookupExpr(expr)) return transpileLookupExpr(expr, ctx)
  if (isVectorExpr(expr)) return transpileVectorExpr(expr.children, ctx)
  if (isBinaryOpExpr(expr)) return transpileBinaryOpExpr(expr, ctx)
  if (isUnaryOpExpr(expr)) return transpileUnaryOpExpr(expr, ctx)
  if (isTernaryExpr(expr)) return transpileTernaryExpr(expr, ctx)
  if (isArrayLookupExpr(expr)) return transpileArrayLookupExpr(expr, ctx)

  if (isFunctionCallExpr(expr)) return transpileFunctionCallExprHandler(expr as FunctionCallExpr, ctx)

  if (isRangeExpr(expr)) {
    const begin = transpileExpression(expr.begin, ctx)
    const end = transpileExpression(expr.end, ctx)
    const step = expr.step ? transpileExpression(expr.step, ctx) : '1'
    return `j$.range(${begin}, ${end}, ${step})`
  }

  if (isGroupingExpr(expr)) return `(${transpileExpression(expr.inner, ctx)})`

  if (isMemberLookupExpr(expr)) {
    const obj = transpileExpression(expr.expr, ctx)
    const member = expr.member
    // Use optional chaining so undef.x returns undef (matching OpenSCAD semantics)
    // rather than throwing TypeError: Cannot read properties of undefined
    if (member === 'x') return `${obj}?.[0]`
    if (member === 'y') return `${obj}?.[1]`
    if (member === 'z') return `${obj}?.[2]`
    return `${obj}?.${member}`
  }

  if (isLcForExpr(expr)) return transpileLcForExprHandler(expr as LcForExpr, ctx)
  if (isLcForCExpr(expr)) return transpileLcForCExprHandler(expr as LcForCExpr, ctx)

  if (isLcIfExpr(expr)) {
    // Conditional in list comprehension: [for (i = range) if (cond) expr]
    // Returns undefined when condition is false, to be filtered out by LcForExpr
    const cond = transpileExpression(expr.cond, ctx)
    ctx.codeGen.usedHelpers.add('isTruthy')
    const boolCond = `j$.isTruthy(${cond})`
    // If there's an else branch, use it; otherwise return undefined
    if (expr.elseExpr) {
      // In flatMap context: if one branch directly produces an array (each/for) and the
      // other doesn't, the non-array branch must be wrapped in [...] so flatMap doesn't
      // spread it as individual elements.
      // Case A: else produces array, if doesn't → wrap if-branch
      //   e.g. if(cond) [x,y] else each [list] → cond ? [[x,y]] : list
      // Case B: if produces array (each/for), else doesn't → wrap else-branch
      //   e.g. if(cond) each [f1,f2] else [x,y,z] → cond ? [f1,f2] : [[x,y,z]]
      if (ctx.inFlatMapContext && directlyProducesArray(expr.elseExpr) && !directlyProducesArray(expr.ifExpr)) {
        // Case A: Temporarily clear flatMapContext so nested if branches aren't double-wrapped
        ctx.inFlatMapContext = false
        const body = transpileExpression(expr.ifExpr, ctx)
        ctx.inFlatMapContext = true
        const elsePart = transpileExpression(expr.elseExpr, ctx)
        return `(${boolCond} ? [${body}] : ${elsePart})`
      }
      if (ctx.inFlatMapContext && directlyProducesArray(expr.ifExpr) && !directlyProducesArray(expr.elseExpr)) {
        // Case B: if-branch uses each/for; wrap else-branch so flatMap doesn't spread it
        const body = transpileExpression(expr.ifExpr, ctx)
        ctx.inFlatMapContext = false
        const elsePart = transpileExpression(expr.elseExpr, ctx)
        ctx.inFlatMapContext = true
        return `(${boolCond} ? ${body} : [${elsePart}])`
      }
      const body = transpileExpression(expr.ifExpr, ctx)
      const elsePart = transpileExpression(expr.elseExpr, ctx)
      return `(${boolCond} ? ${body} : ${elsePart})`
    }
    const body = transpileExpression(expr.ifExpr, ctx)
    return `(${boolCond} ? ${body} : undefined)`
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
    // Add parameters to currentLocalBindings and register as function bindings
    // so that function-valued parameters (e.g. `hash` in dedup) are called directly
    // without the _$f suffix. Save and restore state to avoid leaking.
    const savedLocalBindings = ctx.currentLocalBindings
    ctx.currentLocalBindings = new Set(ctx.currentLocalBindings)
    const paramBindings = (funcDecl.definitionArgs || [])
      .map((a: AssignmentNode) => safeIdentifier(a.name))
      .filter((p: string) => !ctx.symbols.isKind(p, 'function'))
    for (const p of paramBindings) {
      ctx.currentLocalBindings.add(p)
      ctx.scopes.registerFunctionBinding(p, p)
    }
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
    // Restore state
    for (const p of paramBindings) ctx.scopes.unregisterFunctionBinding(p)
    ctx.currentLocalBindings = savedLocalBindings
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
 * Transpile an expression that appears as an explicit call argument.
 * Translates `undef` literals to `j$.EXPLICIT_UNDEF` so that functions with
 * JavaScript default parameters (`param(n, _default = 0)`) can distinguish
 * "caller explicitly passed undef" from "caller omitted the argument entirely".
 *
 * Without this, `f(undef)` → `f(undefined)` triggers JS default, silently
 * replacing `undef` with the default value (e.g. 0 instead of undef).
 */
export function transpileCallArg(expr: Expression, ctx: TranspileContext): string {
  if (isLiteralExpr(expr) && (expr as unknown as { value: unknown }).value === null) {
    return 'j$.EXPLICIT_UNDEF'
  }
  return transpileExpression(expr, ctx)
}

/**
 * Reorder named arguments to match the module/function parameter definition order.
 * This handles OpenSCAD's named parameter syntax: module(n=3, spacing=10)
 * which should map to spread(p1, p2, spacing, l, n) correctly.
 */
/**
 * Reorder named arguments to match parameter list.
 * Wrapper around mapArgsToParams for positional format.
 */
export function reorderNamedArgs(
  name: string,
  argsArray: Array<{name: string | null, value: string}>,
  ctx: TranspileContext,
  kind: 'module' | 'function' = 'function'
): { args: string, format: 'object' | 'positional' } {
  // Only use object format for user-defined functions (not builtins)
  // Builtins like j$.is_vector, Math.abs etc. don't support object parameters
  const isUserDefined = !shouldUseBuiltin(name, kind, ctx)

  // If any argument is named AND it's a user-defined function, use object format
  // This is critical for OpenSCAD's mixed positional/named parameter semantics:
  // func(a, b=2, d=4) should skip parameter c, not pass undefined which bypasses JS defaults
  const hasNamedArgs = argsArray.some(arg => arg.name !== null)
  const format = (hasNamedArgs && isUserDefined) ? 'object' : 'positional'

  const args = mapArgsToParams(name, argsArray, ctx, format, kind)
  return { args, format }
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

export function transpileFunctionCall(
  callee: string,
  args: string,
  ctx: TranspileContext,
  argsFormat: 'object' | 'positional' = 'positional'
): string {
  // Check if we should use builtin (respects user overrides and underscore-prefix)
  const useBuiltin = shouldUseBuiltin(callee, 'function', ctx)

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

  if (useBuiltin && mathFuncs[callee]) {
    return `${mathFuncs[callee]}(${args})`
  }

  // min/max need special handling - in OpenSCAD, max([1,2,3]) returns 3
  // In JavaScript, Math.max([1,2,3]) returns NaN, need to spread array
  if (useBuiltin && (callee === 'min' || callee === 'max')) {
    return `j$.${callee}(${args})`
  }

  // Trig functions - OpenSCAD uses degrees, JavaScript uses radians
  // sin/cos/tan use exact runtime helpers that return exact 0/1/-1 for multiples
  // of 90°, matching OpenSCAD's CGAL behavior (e.g. sin(180) === 0 exactly).
  if (useBuiltin) {
    const toDeg = '180/Math.PI'
    const trigFuncs: Record<string, string> = {
      sin: `j$.sinDeg(${args})`,
      cos: `j$.cosDeg(${args})`,
      tan: `j$.tanDeg(${args})`,
      asin: `Math.asin(${args})*${toDeg}`,
      acos: `Math.acos(${args})*${toDeg}`,
      atan: `Math.atan(${args})*${toDeg}`,
      atan2: `Math.atan2(${args})*${toDeg}`,
    }

    if (trigFuncs[callee]) {
      return trigFuncs[callee]
    }
  }

  // len() -> ?.length (optional chaining so len(undef) returns undefined, not a TypeError)
  // In OpenSCAD, len(undef) == undef; in JS, undefined.length throws.
  if (useBuiltin && callee === 'len') {
    return `(${args})?.length`
  }

  // is_undef() -> typeof value === 'undefined' OR value is j$.EXPLICIT_UNDEF
  // Using typeof prevents ReferenceError when checking undefined variables (like BOSL2 flags)
  // We also check for j$.EXPLICIT_UNDEF because that sentinel represents explicit undef passed as argument
  if (useBuiltin && callee === 'is_undef') {
    return `((typeof (${args}) === 'undefined') || (${args}) === j$.EXPLICIT_UNDEF)`
  }

  // is_def() -> typeof value !== 'undefined' AND value is not j$.EXPLICIT_UNDEF  (BOSL compatibility)
  if (useBuiltin && callee === 'is_def') {
    return `((typeof (${args}) !== 'undefined') && (${args}) !== j$.EXPLICIT_UNDEF)`
  }

  // is_list() -> Array.isArray()
  if (useBuiltin && callee === 'is_list') {
    return `Array.isArray(${args})`
  }

  // is_num() -> typeof === 'number'
  if (useBuiltin && callee === 'is_num') {
    return `(typeof (${args}) === 'number' && !isNaN(${args}))`
  }

  // is_str() / is_string() -> typeof === 'string'
  if (useBuiltin && (callee === 'is_str' || callee === 'is_string')) {
    return `(typeof (${args}) === 'string')`
  }

  // is_vector() -> runtime helper (handles optional length parameter)
  if (useBuiltin && callee === 'is_vector') {
    return `j$.is_vector(${args})`
  }

  // is_bool() -> typeof === 'boolean'
  if (useBuiltin && callee === 'is_bool') {
    return `(typeof (${args}) === 'boolean')`
  }

  // is_function() -> typeof === 'function' (OpenSCAD 2021.01+)
  if (useBuiltin && callee === 'is_function') {
    return `(typeof (${args}) === 'function')`
  }

  // concat() -> [..., ...]
  if (useBuiltin && callee === 'concat') {
    return `[].concat(${args})`
  }

  // Helper functions from j$ runtime
  if (useBuiltin) {
    const helperFuncs = ['norm', 'cross', 'lookup', 'rands', 'search', 'version_num', 'parent_module', 'str', 'chr', 'ord', 'reverse']
    if (helperFuncs.includes(callee)) {
      return `j$.${callee}(${args})`
    }
  }

  // echo() for debugging - map to console.log
  if (useBuiltin && callee === 'echo') {
    return `console.log(${args})`
  }

  // Check if this is a local function binding (from a let/for expression)
  // In OpenSCAD, variables and functions have SEPARATE namespaces
  // e.g., let(scale = [1,2,3]) scale(cube(1)) - scale is a variable, scale() is a function
  // We only intercept if we're SURE the binding is a function value
  // This is tracked via localFunctionBindings (detected via isFunctionLiteralExpr)
  const localBinding = ctx.scopes.lookupFunctionBinding(callee)
  if (localBinding) {
    return `${localBinding}(${args})`
  }

  // If the callee is a locally-bound name (function parameter) but NOT a known global
  // function, call it directly — it's a parameter holding a function value.
  // In OpenSCAD, calling a function-valued variable is valid: find_index(lt, fn) where
  // fn is called as fn(x) inside the body. Since function namespace takes precedence,
  // only skip _$f when there's no global function with this name.
  if (ctx.currentLocalBindings.has(callee) && !ctx.symbols.isKind(callee, 'function')) {
    return `${callee}(${args})`
  }

  // If the callee is a let-bound variable (has a scope binding) and there's no
  // global function with this name, call the let-bound variable directly.
  // Pattern: let(fn = cond ? handler_a : handler_b) fn(x)
  // where handler_a/handler_b are function-valued parameters.
  // In OpenSCAD, if no global function named 'fn' exists, fn(...) MUST be
  // calling the local variable, which holds a function value.
  const scopeBinding = ctx.scopes.lookupBinding(callee)
  if (scopeBinding && !ctx.symbols.isKind(callee, 'function')) {
    return `${scopeBinding}(${args})`
  }

  // User-defined function call - use _$f suffix for namespace separation
  // Use _$f$obj suffix when calling with object parameters (named arguments)
  // Only add suffix for simple identifiers (named function calls)
  // Don't add for complex expressions like array[0](args) or obj.method(args)
  if (isValidIdentifier(callee)) {
    const suffix = argsFormat === 'object' ? '_$f$obj' : '_$f'
    // Track as potential free function ref if not in current local bindings.
    // Note: we intentionally do NOT check ctx.symbols.isDefined() here — 'inherited' symbols
    // (passed from the parent context for named-arg reordering) must still be tracked so that
    // canOptimizeInclude correctly detects files that reference ambient include-scope functions.
    if (!ctx.currentLocalBindings.has(callee)) {
      ctx.potentialFreeVarRefs.add(callee)
    }
    return `${callee}${suffix}(${args})`
  }
  // Complex expression (array access, member access, etc.) - call directly
  return `${callee}(${args})`
}
