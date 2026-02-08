/**
 * Type guards for OpenSCAD AST nodes
 *
 * These type guards provide type-safe dispatch for AST nodes without relying
 * on constructor.name checks, which can be fragile under minification.
 */

import type {
  Statement,
  Expression,
  // Statement types
  UseStmt,
  IncludeStmt,
  ModuleInstantiationStmt,
  ModuleDeclarationStmt,
  FunctionDeclarationStmt,
  BlockStmt,
  NoopStmt,
  IfElseStatement,
  // Expression types
  LiteralExpr,
  LookupExpr,
  VectorExpr,
  BinaryOpExpr,
  UnaryOpExpr,
  TernaryExpr,
  ArrayLookupExpr,
  FunctionCallExpr,
  RangeExpr,
  GroupingExpr,
  MemberLookupExpr,
  LcForExpr,
  LcForCExpr,
  LcIfExpr,
  LcEachExpr,
  LetExpr,
  LcLetExpr,
  EchoExpr,
  AssertExpr,
} from 'openscad-parser'
import type AssignmentNode from 'openscad-parser/dist/ast/AssignmentNode'

// Re-export types for convenience
export type {
  Statement,
  Expression,
  UseStmt,
  IncludeStmt,
  ModuleInstantiationStmt,
  ModuleDeclarationStmt,
  FunctionDeclarationStmt,
  BlockStmt,
  NoopStmt,
  IfElseStatement,
  LiteralExpr,
  LookupExpr,
  VectorExpr,
  BinaryOpExpr,
  UnaryOpExpr,
  TernaryExpr,
  ArrayLookupExpr,
  FunctionCallExpr,
  RangeExpr,
  GroupingExpr,
  MemberLookupExpr,
  LcForExpr,
  LcForCExpr,
  LcIfExpr,
  LcEachExpr,
  LetExpr,
  LcLetExpr,
  EchoExpr,
  AssertExpr,
}
export type { default as AssignmentNode } from 'openscad-parser/dist/ast/AssignmentNode'

// ============================================================================
// Statement Type Guards
// ============================================================================

/**
 * Check if statement is a UseStmt (use <filename>)
 * Unique property: tokens.useKeyword
 */
export function isUseStmt(stmt: Statement): stmt is UseStmt {
  return 'tokens' in stmt &&
         stmt.tokens !== null &&
         typeof stmt.tokens === 'object' &&
         'useKeyword' in (stmt.tokens as object)
}

/**
 * Check if statement is an IncludeStmt (include <filename>)
 * Unique property: tokens.includeKeyword
 */
export function isIncludeStmt(stmt: Statement): stmt is IncludeStmt {
  return 'tokens' in stmt &&
         stmt.tokens !== null &&
         typeof stmt.tokens === 'object' &&
         'includeKeyword' in (stmt.tokens as object)
}

/**
 * Check if statement is a ModuleInstantiationStmt (e.g., cube(10), translate([1,2,3]) child)
 * Unique properties: name, args, child, tagRoot
 */
export function isModuleInstantiation(stmt: Statement): stmt is ModuleInstantiationStmt {
  return 'name' in stmt &&
         'args' in stmt &&
         'child' in stmt &&
         'tagRoot' in stmt
}

/**
 * Check if statement is a ModuleDeclarationStmt (module foo() { ... })
 * Unique properties: definitionArgs, stmt, tokens.moduleKeyword
 */
export function isModuleDeclaration(stmt: Statement): stmt is ModuleDeclarationStmt {
  return 'definitionArgs' in stmt &&
         'stmt' in stmt &&
         'tokens' in stmt &&
         stmt.tokens !== null &&
         typeof stmt.tokens === 'object' &&
         'moduleKeyword' in (stmt.tokens as object)
}

/**
 * Check if statement is a FunctionDeclarationStmt (function foo() = expr;)
 * Unique properties: definitionArgs, expr, tokens.functionKeyword
 */
export function isFunctionDeclaration(stmt: Statement): stmt is FunctionDeclarationStmt {
  return 'definitionArgs' in stmt &&
         'expr' in stmt &&
         'tokens' in stmt &&
         stmt.tokens !== null &&
         typeof stmt.tokens === 'object' &&
         'functionKeyword' in (stmt.tokens as object)
}

/**
 * Check if statement is a BlockStmt ({ ... })
 * Unique properties: children (array), tokens.firstBrace
 */
export function isBlockStmt(stmt: Statement): stmt is BlockStmt {
  return 'children' in stmt &&
         Array.isArray((stmt as BlockStmt).children) &&
         'tokens' in stmt &&
         stmt.tokens !== null &&
         typeof stmt.tokens === 'object' &&
         'firstBrace' in (stmt.tokens as object)
}

/**
 * Check if statement is a NoopStmt (;)
 * Unique properties: only tokens.semicolon, no other significant fields
 */
export function isNoopStmt(stmt: Statement): stmt is NoopStmt {
  return 'tokens' in stmt &&
         stmt.tokens !== null &&
         typeof stmt.tokens === 'object' &&
         'semicolon' in (stmt.tokens as object) &&
         !('children' in stmt) &&
         !('name' in stmt) &&
         !('cond' in stmt)
}

/**
 * Check if statement is an IfElseStatement (if (cond) { ... } else { ... })
 * Unique properties: cond, thenBranch, elseBranch
 */
export function isIfElseStatement(stmt: Statement): stmt is IfElseStatement {
  return 'cond' in stmt &&
         'thenBranch' in stmt &&
         'elseBranch' in stmt
}

/**
 * Check if node is an AssignmentNode (name = value)
 * Unique properties: name, value, role
 */
export function isAssignmentNode(node: unknown): node is AssignmentNode {
  return node !== null &&
         typeof node === 'object' &&
         'name' in node &&
         'value' in node &&
         'role' in node
}

// ============================================================================
// Expression Type Guards
// ============================================================================

/**
 * Check if expression is a LiteralExpr (number, string, boolean)
 * Unique property: tokens.literalToken
 */
export function isLiteralExpr(expr: Expression): expr is LiteralExpr<unknown> {
  if (!expr || typeof expr !== 'object') return false
  return 'tokens' in expr &&
         expr.tokens !== null &&
         typeof expr.tokens === 'object' &&
         'literalToken' in (expr.tokens as object)
}

/**
 * Check if expression is a LookupExpr (variable reference)
 * Unique property: name (string), but no 'args' or 'value'
 */
export function isLookupExpr(expr: Expression): expr is LookupExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'name' in expr &&
         typeof (expr as LookupExpr).name === 'string' &&
         !('args' in expr) &&
         !('value' in expr) &&
         !('expr' in expr) &&
         !('member' in expr)
}

/**
 * Check if expression is a VectorExpr ([1, 2, 3])
 * Unique property: children (array), tokens.firstBracket (no begin/end like RangeExpr)
 */
export function isVectorExpr(expr: Expression): expr is VectorExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'children' in expr &&
         Array.isArray((expr as VectorExpr).children) &&
         !('begin' in expr)
}

/**
 * Check if expression is a BinaryOpExpr (a + b)
 * Unique properties: left, operation, right
 */
export function isBinaryOpExpr(expr: Expression): expr is BinaryOpExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'left' in expr &&
         'operation' in expr &&
         'right' in expr &&
         !('ifExpr' in expr)  // Distinguish from TernaryExpr
}

/**
 * Check if expression is a UnaryOpExpr (!x, -x)
 * Unique properties: operation, right (but no 'left')
 */
export function isUnaryOpExpr(expr: Expression): expr is UnaryOpExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'operation' in expr &&
         'right' in expr &&
         !('left' in expr)
}

/**
 * Check if expression is a TernaryExpr (cond ? a : b)
 * Unique properties: cond, ifExpr, elseExpr, tokens.questionMark
 */
export function isTernaryExpr(expr: Expression): expr is TernaryExpr {
  if (!expr || typeof expr !== 'object') return false
  if (!('cond' in expr) || !('ifExpr' in expr) || !('elseExpr' in expr)) return false
  if ('thenBranch' in expr) return false  // Distinguish from IfElseStatement
  // Check for tokens.questionMark to distinguish from LcIfExpr
  if (!('tokens' in expr)) return false
  const tokens = expr.tokens
  if (!tokens || typeof tokens !== 'object') return false
  return 'questionMark' in tokens
}

/**
 * Check if expression is an ArrayLookupExpr (arr[i])
 * Unique properties: array, index
 */
export function isArrayLookupExpr(expr: Expression): expr is ArrayLookupExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'array' in expr &&
         'index' in expr
}

/**
 * Check if expression is a FunctionCallExpr (foo(a, b))
 * Unique properties: callee, args
 */
export function isFunctionCallExpr(expr: Expression): expr is FunctionCallExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'callee' in expr &&
         'args' in expr
}

/**
 * Check if expression is a RangeExpr ([0:10] or [0:1:10])
 * Unique properties: begin, end, step
 */
export function isRangeExpr(expr: Expression): expr is RangeExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'begin' in expr &&
         'end' in expr
}

/**
 * Check if expression is a GroupingExpr ((expr))
 * Unique property: inner
 */
export function isGroupingExpr(expr: Expression): expr is GroupingExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'inner' in expr
}

/**
 * Check if expression is a MemberLookupExpr (v.x)
 * Unique properties: expr, member
 */
export function isMemberLookupExpr(expr: Expression): expr is MemberLookupExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'expr' in expr &&
         'member' in expr
}

/**
 * Check if expression is a LcForExpr (list comprehension for)
 * Unique properties: args, expr (but different from LetExpr - has no tokens.letKeyword)
 */
export function isLcForExpr(expr: Expression): expr is LcForExpr {
  if (!expr || typeof expr !== 'object') return false
  // Must have args, expr, and forKeyword token
  // Must NOT have incrArgs (which distinguishes it from LcForCExpr)
  return 'args' in expr &&
         'expr' in expr &&
         !('incrArgs' in expr) &&
         'tokens' in expr &&
         expr.tokens !== null &&
         typeof expr.tokens === 'object' &&
         'forKeyword' in (expr.tokens as object)
}

/**
 * Check if expression is an LcForCExpr (C-style for loop: for(init; cond; incr))
 * Unique properties: args, incrArgs, cond, expr
 */
export function isLcForCExpr(expr: Expression): expr is LcForCExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'args' in expr &&
         'incrArgs' in expr &&
         'cond' in expr &&
         'expr' in expr &&
         'tokens' in expr &&
         expr.tokens !== null &&
         typeof expr.tokens === 'object' &&
         'forKeyword' in (expr.tokens as object)
}

/**
 * Check if expression is a LcIfExpr (list comprehension if)
 * Unique properties: cond, ifExpr (but distinct tokens from TernaryExpr)
 */
export function isLcIfExpr(expr: Expression): expr is LcIfExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'cond' in expr &&
         'ifExpr' in expr &&
         'tokens' in expr &&
         expr.tokens !== null &&
         typeof expr.tokens === 'object' &&
         'ifKeyword' in (expr.tokens as object)
}

/**
 * Check if expression is an LcEachExpr (each x in list comprehension)
 * Unique property: tokens.eachKeyword
 */
export function isLcEachExpr(expr: Expression): expr is LcEachExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'expr' in expr &&
         'tokens' in expr &&
         expr.tokens !== null &&
         typeof expr.tokens === 'object' &&
         'eachKeyword' in (expr.tokens as object)
}

/**
 * Check if expression is a LetExpr (let(x = 1) expr)
 * LetExpr has tokens.name with lexeme "let", while LcLetExpr has tokens.letKeyword
 * Also, LetExpr has args and expr but no cond like LcIfExpr
 */
export function isLetExpr(expr: Expression): expr is LetExpr {
  if (!expr || typeof expr !== 'object') return false
  if (!('args' in expr) || !('expr' in expr) || !('tokens' in expr)) return false
  const tokens = expr.tokens
  if (!tokens || typeof tokens !== 'object') return false
  if (!('name' in tokens) || !('firstParen' in tokens)) return false
  if ('cond' in expr) return false  // Distinguish from LcIfExpr
  if ('forKeyword' in tokens) return false  // Distinguish from LcForExpr
  // Check that the name token has lexeme "let"
  const nameToken = (tokens as unknown as { name: { lexeme?: string } }).name
  return nameToken && nameToken.lexeme === 'let'
}

/**
 * Check if expression is a LcLetExpr (list comprehension let)
 * LcLetExpr has tokens.letKeyword (different from LetExpr which has tokens.name)
 */
export function isLcLetExpr(expr: Expression): expr is LcLetExpr {
  if (!expr || typeof expr !== 'object') return false
  return 'args' in expr &&
         'expr' in expr &&
         'tokens' in expr &&
         expr.tokens !== null &&
         typeof expr.tokens === 'object' &&
         'letKeyword' in (expr.tokens as object)
}

/**
 * Check if expression is an EchoExpr (echo(x) expr)
 * Uses tokens.name with lexeme "echo"
 */
export function isEchoExpr(expr: Expression): expr is EchoExpr {
  if (!expr || typeof expr !== 'object') return false
  if (!('args' in expr) || !('expr' in expr) || !('tokens' in expr)) return false
  const tokens = expr.tokens
  if (!tokens || typeof tokens !== 'object') return false
  // Check if tokens.name exists and has lexeme "echo"
  if ('name' in tokens) {
    const nameToken = (tokens as unknown as { name: { lexeme?: string } }).name
    if (nameToken && nameToken.lexeme === 'echo') return true
  }
  // Fallback: some parsers might use echoKeyword
  return 'echoKeyword' in tokens
}

/**
 * Check if expression is an AssertExpr (assert(cond) expr)
 * Uses tokens.name with lexeme "assert"
 */
export function isAssertExpr(expr: Expression): expr is AssertExpr {
  if (!expr || typeof expr !== 'object') return false
  if (!('args' in expr) || !('tokens' in expr)) return false
  // AssertExpr may or may not have expr property (when at end of chain)
  const tokens = expr.tokens
  if (!tokens || typeof tokens !== 'object') return false
  // Check if tokens.name exists and has lexeme "assert"
  if ('name' in tokens) {
    const nameToken = (tokens as unknown as { name: { lexeme?: string } }).name
    if (nameToken && nameToken.lexeme === 'assert') return true
  }
  // Fallback: some parsers might use assertKeyword
  return 'assertKeyword' in tokens
}

// ============================================================================
// Utility function to get node type name (for error messages)
// ============================================================================

/**
 * Get a human-readable type name for an AST node (for warnings/errors)
 * Falls back to constructor.name if no type guard matches
 */
export function getNodeTypeName(node: unknown): string {
  if (node === null || node === undefined) return 'null'
  if (typeof node !== 'object') return typeof node

  // Check statements first
  if ('tokens' in node) {
    const tokens = (node as { tokens: unknown }).tokens
    if (tokens && typeof tokens === 'object') {
      if ('useKeyword' in tokens) return 'UseStmt'
      if ('includeKeyword' in tokens) return 'IncludeStmt'
      if ('moduleKeyword' in tokens) return 'ModuleDeclarationStmt'
      if ('functionKeyword' in tokens) return 'FunctionDeclarationStmt'
      if ('ifKeyword' in tokens && 'thenBranch' in node) return 'IfElseStatement'
      if ('forKeyword' in tokens) return 'LcForExpr'
      if ('letKeyword' in tokens) return 'LcLetExpr'
      if ('echoKeyword' in tokens) return 'EchoExpr'
      if ('assertKeyword' in tokens) return 'AssertExpr'
      if ('literalToken' in tokens) return 'LiteralExpr'
      if ('firstBrace' in tokens && 'children' in node) return 'BlockStmt'
      if ('semicolon' in tokens && !('name' in node)) return 'NoopStmt'
    }
  }

  // Check by unique property combinations
  if ('name' in node && 'args' in node && 'child' in node) return 'ModuleInstantiationStmt'
  if ('name' in node && 'value' in node && 'role' in node) return 'AssignmentNode'
  if ('cond' in node && 'thenBranch' in node) return 'IfElseStatement'
  if ('cond' in node && 'ifExpr' in node && 'elseExpr' in node) return 'TernaryExpr'
  if ('left' in node && 'operation' in node && 'right' in node) return 'BinaryOpExpr'
  if ('operation' in node && 'right' in node && !('left' in node)) return 'UnaryOpExpr'
  if ('array' in node && 'index' in node) return 'ArrayLookupExpr'
  if ('callee' in node && 'args' in node) return 'FunctionCallExpr'
  if ('begin' in node && 'end' in node) return 'RangeExpr'
  if ('inner' in node) return 'GroupingExpr'
  if ('expr' in node && 'member' in node) return 'MemberLookupExpr'
  if ('children' in node && Array.isArray((node as { children: unknown }).children)) return 'VectorExpr'
  if ('name' in node && !('args' in node)) return 'LookupExpr'

  // Fallback to constructor.name
  return (node as object).constructor?.name || 'Unknown'
}

/**
 * Check if an expression contains any function calls (recursively)
 * Used to detect if a top-level constant needs lazy evaluation
 */
export function containsFunctionCall(expr: Expression | null | undefined): boolean {
  if (!expr || typeof expr !== 'object') return false

  // Direct function call
  if (isFunctionCallExpr(expr)) return true

  // Check nested expressions
  if (isBinaryOpExpr(expr)) {
    return containsFunctionCall(expr.left) || containsFunctionCall(expr.right)
  }
  if (isUnaryOpExpr(expr)) {
    return containsFunctionCall(expr.right)
  }
  if (isTernaryExpr(expr)) {
    return containsFunctionCall(expr.cond) ||
           containsFunctionCall(expr.ifExpr) ||
           containsFunctionCall(expr.elseExpr)
  }
  if (isGroupingExpr(expr)) {
    return containsFunctionCall(expr.inner)
  }
  if (isArrayLookupExpr(expr)) {
    return containsFunctionCall(expr.array) || containsFunctionCall(expr.index)
  }
  if (isMemberLookupExpr(expr)) {
    return containsFunctionCall(expr.expr)
  }
  if (isVectorExpr(expr)) {
    return (expr.children as Expression[]).some(containsFunctionCall)
  }
  if (isLetExpr(expr)) {
    const hasCallInArgs = expr.args.some(a => containsFunctionCall((a as AssignmentNode).value))
    return hasCallInArgs || containsFunctionCall(expr.expr)
  }

  return false
}
