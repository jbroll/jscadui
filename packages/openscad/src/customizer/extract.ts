/**
 * OpenSCAD Customizer parameter extraction
 *
 * OpenSCAD has no `parameter` keyword. The Customizer builds its UI from
 * top-level assignments with literal values, annotated by comments:
 *
 *   /* [Dimensions] *\/          group heading ([Hidden] hides what follows)
 *   // Width of the box          description (line directly above)
 *   width = 50; // [10:5:100]    widget annotation (same line, after `;`)
 *
 * This module tokenizes the source with the openscad-parser Lexer, which keeps
 * comments as trivia on the following token, and classifies every top-level
 * assignment so callers can separate the public parameter interface from
 * derived, hidden and special variables.
 *
 * Like OpenSCAD, parameter collection stops at the first `{` in the file
 * (a module body, typically). That is what the common
 * `module __Customizer_Limit__ () {}` idiom relies on.
 */

import {
  CodeFile,
  ErrorCollector,
  Lexer,
  MultiLineComment,
  SingleLineComment,
  TokenType,
  type Token,
} from 'openscad-parser'

export type CustomizerValue = number | string | boolean | number[]

export interface CustomizerOption {
  value: number | string
  label?: string
}

export type CustomizerWidget =
  | { kind: 'checkbox' }
  | { kind: 'spinbox'; step?: number }
  | { kind: 'slider'; min: number; max: number; step?: number }
  | { kind: 'dropdown'; options: CustomizerOption[] }
  | { kind: 'text'; maxLength?: number }

export interface CustomizerLocation {
  /** 1-based line */
  line: number
  /** 1-based column */
  column: number
}

export interface CustomizerParameter {
  name: string
  type: 'number' | 'string' | 'boolean' | 'vector'
  default: CustomizerValue
  group: string
  description?: string
  /** Widget for a scalar, or for each component of a vector */
  widget: CustomizerWidget
  location: CustomizerLocation
}

/**
 * Classification of a top-level assignment:
 * - parameter:   exposed in the Customizer
 * - hidden:      literal, but declared in a [Hidden] section
 * - derived:     value is an expression, not a literal
 * - special:     `$`-prefixed variable ($fn, $fa, ...)
 * - unsupported: literal the Customizer cannot edit (e.g. vector of strings, >4 elements)
 * - after-limit: declared after the first `{` in the file
 */
export type CustomizerVariableKind =
  | 'parameter'
  | 'hidden'
  | 'derived'
  | 'special'
  | 'unsupported'
  | 'after-limit'

export interface CustomizerVariable {
  name: string
  kind: CustomizerVariableKind
  location: CustomizerLocation
}

export interface CustomizerSchema {
  parameters: CustomizerParameter[]
  /** Visible group names in declaration order */
  groups: string[]
  /** Every top-level assignment, in source order */
  variables: CustomizerVariable[]
}

/** OpenSCAD's name for parameters declared before any group comment */
export const DEFAULT_GROUP = 'Parameters'
const HIDDEN_GROUP = 'hidden'
/** OpenSCAD's Customizer only offers vectors of up to 4 numbers */
const MAX_VECTOR_LENGTH = 4

const GROUP_RE = /^\s*\[\s*([^\]]*?)\s*\]\s*$/
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

type Literal = { ok: true; value: CustomizerValue } | { ok: false; unsupported: boolean }

/**
 * Extract the Customizer parameter schema from OpenSCAD source.
 */
export function extractCustomizerParameters(source: string, filename = 'input.scad'): CustomizerSchema {
  const tokens = new Lexer(new CodeFile(filename, source), new ErrorCollector()).scan()

  const parameters: CustomizerParameter[] = []
  const variables: CustomizerVariable[] = []
  const groups: string[] = []

  let group = DEFAULT_GROUP
  let limitReached = false
  // Line of the token that ended the previous statement. A single-line comment
  // on that line, attached to the next token, is a trailing comment of the
  // previous statement: an annotation if that statement was a parameter.
  let prevEndLine = -1
  let pending: CustomizerParameter | null = null

  let i = 0
  while (i < tokens.length) {
    const start = tokens[i]

    // Comments preceding this token: trailing annotation of the previous
    // statement, group headings, and the description line.
    let description: string | undefined
    for (const extra of start.extraTokens) {
      if (extra instanceof SingleLineComment) {
        if (extra.pos.line === prevEndLine) {
          if (pending) applyAnnotation(pending, extra.contents)
        } else if (extra.pos.line === start.span.start.line - 1) {
          description = extra.contents.trim() || undefined
        }
      } else if (extra instanceof MultiLineComment && !limitReached) {
        const m = GROUP_RE.exec(extra.contents)
        if (m) group = m[1].toLowerCase() === HIDDEN_GROUP ? HIDDEN_GROUP : m[1]
      }
    }
    pending = null
    if (start.type === TokenType.Eot) break

    const end = findStatementEnd(tokens, i)
    if (end.sawBrace) {
      // Parameters after the first `{` are ignored (see module doc)
      if (isAssignmentStart(tokens, i)) {
        variables.push({ name: start.lexeme, kind: 'after-limit', location: loc(start) })
      }
      limitReached = true
      prevEndLine = endLine(tokens, end.semicolon)
      i = end.next
      continue
    }

    if (isAssignmentStart(tokens, i)) {
      const name = start.lexeme
      const location = loc(start)
      const valueTokens = tokens.slice(i + 2, end.semicolon)
      const literal = parseLiteral(valueTokens)

      let kind: CustomizerVariableKind
      if (limitReached) kind = 'after-limit'
      else if (name.startsWith('$')) kind = 'special'
      else if (!literal.ok) kind = literal.unsupported ? 'unsupported' : 'derived'
      else if (group === HIDDEN_GROUP) kind = 'hidden'
      else kind = 'parameter'

      if (kind === 'parameter' && literal.ok) {
        const param = makeParameter(name, literal.value, group, description, location)
        // A later assignment to the same name wins, as in OpenSCAD
        const existing = parameters.findIndex(p => p.name === name)
        if (existing >= 0) parameters.splice(existing, 1)
        parameters.push(param)
        pending = param
      }
      variables.push({ name, kind, location })
    }

    prevEndLine = endLine(tokens, end.semicolon)
    i = end.next
  }

  for (const p of parameters) {
    if (!groups.includes(p.group)) groups.push(p.group)
  }

  return { parameters, groups, variables }
}

function loc(token: Token): CustomizerLocation {
  // openscad-parser locations are 0-based
  return { line: token.span.start.line + 1, column: token.span.start.col + 1 }
}

function endLine(tokens: Token[], index: number): number {
  return tokens[Math.min(index, tokens.length - 1)].span.start.line
}

function isAssignmentStart(tokens: Token[], i: number): boolean {
  return tokens[i].type === TokenType.Identifier && tokens[i + 1]?.type === TokenType.Equal
}

/**
 * Find the end of the top-level statement starting at `i`: the `;` at nesting
 * depth 0, or the `}` that closes a braced block.
 */
function findStatementEnd(tokens: Token[], i: number): { semicolon: number; next: number; sawBrace: boolean } {
  // `include <file>` / `use <file>` have no terminating semicolon
  if ((tokens[i].type === TokenType.Include || tokens[i].type === TokenType.Use)
      && tokens[i + 1]?.type === TokenType.FilenameInChevrons) {
    const next = tokens[i + 2]?.type === TokenType.Semicolon ? i + 2 : i + 1
    return { semicolon: next, next: next + 1, sawBrace: false }
  }
  let depth = 0
  let braceDepth = 0
  let sawBrace = false
  for (let j = i; j < tokens.length; j++) {
    const t = tokens[j].type
    if (t === TokenType.Eot) return { semicolon: j, next: j, sawBrace }
    if (t === TokenType.LeftParen || t === TokenType.LeftBracket) depth++
    else if (t === TokenType.RightParen || t === TokenType.RightBracket) depth--
    else if (t === TokenType.LeftBrace) {
      braceDepth++
      sawBrace = true
    } else if (t === TokenType.RightBrace) {
      braceDepth--
      if (braceDepth <= 0 && depth <= 0) return { semicolon: j, next: j + 1, sawBrace }
    } else if (t === TokenType.Semicolon && depth <= 0 && braceDepth <= 0) {
      return { semicolon: j, next: j + 1, sawBrace }
    }
  }
  return { semicolon: tokens.length, next: tokens.length, sawBrace }
}

/**
 * Parse a Customizer-editable literal: number (optionally signed), string,
 * boolean, or a vector of 1-4 numbers.
 */
function parseLiteral(tokens: Token[]): Literal {
  const scalar = (ts: Token[]): number | string | boolean | undefined => {
    if (ts.length === 1) {
      const t = ts[0] as Token & { value?: unknown }
      if (t.type === TokenType.NumberLiteral) return t.value as number
      if (t.type === TokenType.StringLiteral) return t.value as string
      if (t.type === TokenType.True) return true
      if (t.type === TokenType.False) return false
    }
    if (ts.length === 2 && ts[1].type === TokenType.NumberLiteral) {
      const v = (ts[1] as Token & { value: number }).value
      if (ts[0].type === TokenType.Minus) return -v
      if (ts[0].type === TokenType.Plus) return v
    }
    return undefined
  }

  const s = scalar(tokens)
  if (s !== undefined) return { ok: true, value: s }

  const first = tokens[0]?.type
  const last = tokens[tokens.length - 1]?.type
  if (first !== TokenType.LeftBracket || last !== TokenType.RightBracket) {
    return { ok: false, unsupported: false }
  }

  // Vector: split the bracket contents on commas; every element must be a scalar
  const elements: (number | string | boolean)[] = []
  let current: Token[] = []
  const inner = tokens.slice(1, -1)
  for (const t of [...inner, null]) {
    if (t === null || t.type === TokenType.Comma) {
      if (current.length === 0) {
        if (t === null && elements.length === 0) break // empty vector
        return { ok: false, unsupported: false }
      }
      const v = scalar(current)
      if (v === undefined) return { ok: false, unsupported: nestedLiteralOnly(current) }
      elements.push(v)
      current = []
    } else {
      current.push(t)
    }
  }

  if (elements.length === 0) return { ok: false, unsupported: true }
  if (elements.every(e => typeof e === 'number') && elements.length <= MAX_VECTOR_LENGTH) {
    return { ok: true, value: elements as number[] }
  }
  return { ok: false, unsupported: true }
}

/** True when tokens are only literals and brackets, i.e. a nested literal vector */
function nestedLiteralOnly(tokens: Token[]): boolean {
  const allowed = new Set<number>([
    TokenType.LeftBracket, TokenType.RightBracket, TokenType.Comma,
    TokenType.NumberLiteral, TokenType.StringLiteral, TokenType.True,
    TokenType.False, TokenType.Minus,
  ])
  return tokens.every(t => allowed.has(t.type))
}

function makeParameter(
  name: string,
  value: CustomizerValue,
  group: string,
  description: string | undefined,
  location: CustomizerLocation,
): CustomizerParameter {
  const type = Array.isArray(value) ? 'vector'
    : typeof value === 'number' ? 'number'
    : typeof value === 'string' ? 'string'
    : 'boolean'
  const widget: CustomizerWidget = type === 'boolean' ? { kind: 'checkbox' }
    : type === 'string' ? { kind: 'text' }
    : { kind: 'spinbox' }
  const param: CustomizerParameter = { name, type, default: value, group, widget, location }
  if (description) param.description = description
  return param
}

/**
 * Apply a same-line annotation comment to a parameter.
 *
 *   // [max]              slider 0..max
 *   // [min:max]          slider
 *   // [min:step:max]     slider with step
 *   // [a, b, c]          dropdown
 *   // [10:S, 20:M]       dropdown with labels
 *   // 0.5                spinbox step (numbers) / max length (strings)
 */
export function applyAnnotation(param: CustomizerParameter, comment: string): void {
  if (param.type === 'boolean') return
  const text = comment.trim()

  const bracket = /^\[(.*)\]$/.exec(text)
  if (!bracket) {
    if (NUMBER_RE.test(text)) {
      const n = Number(text)
      if (param.type === 'string') param.widget = { kind: 'text', maxLength: n }
      else param.widget = { kind: 'spinbox', step: n }
    }
    return
  }

  const inner = bracket[1].trim()
  if (inner === '') return
  const numeric = param.type === 'number' || param.type === 'vector'

  if (numeric && !inner.includes(',')) {
    const parts = inner.split(':').map(s => s.trim())
    if (parts.every(p => NUMBER_RE.test(p))) {
      const n = parts.map(Number)
      if (n.length === 1) param.widget = { kind: 'slider', min: 0, max: n[0] }
      else if (n.length === 2) param.widget = { kind: 'slider', min: n[0], max: n[1] }
      else if (n.length === 3) param.widget = { kind: 'slider', min: n[0], step: n[1], max: n[2] }
      return
    }
  }

  // Vectors only take ranges
  if (param.type === 'vector') return

  const options: CustomizerOption[] = []
  for (const item of splitTopLevel(inner)) {
    const colon = item.indexOf(':')
    const rawValue = (colon >= 0 ? item.slice(0, colon) : item).trim()
    const label = colon >= 0 ? item.slice(colon + 1).trim() : undefined
    let value: number | string = unquote(rawValue)
    if (param.type === 'number') {
      if (!NUMBER_RE.test(rawValue)) return // not a valid numeric dropdown
      value = Number(rawValue)
    }
    options.push(label ? { value, label } : { value })
  }
  if (options.length > 0) param.widget = { kind: 'dropdown', options }
}

function unquote(s: string): string {
  const m = /^"(.*)"$/.exec(s)
  return m ? m[1] : s
}

/** Split on commas that are not inside double quotes */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of s) {
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}
