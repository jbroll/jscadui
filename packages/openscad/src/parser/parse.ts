/**
 * Parser wrapper for openscad-parser
 */

import { CodeFile, ParsingHelper, ScadFile, ErrorCollector } from 'openscad-parser'
import { parseError, type SourceLocation } from '../utils/errors.js'

export interface ParseResult {
  ast: ScadFile
  errors: ParseErrorInfo[]
}

export interface ParseErrorInfo {
  message: string
  location?: SourceLocation
}

/**
 * Parse OpenSCAD source code into an AST
 */
export function parse(source: string, filename = 'input.scad'): ParseResult {
  const codeFile = new CodeFile(filename, normalizeSourceWhitespace(source))

  // parseFile is a static method that returns [ScadFile, ErrorCollector]
  const [ast, errorCollector] = ParsingHelper.parseFile(codeFile) as [ScadFile, ErrorCollector]

  // Collect any parse errors
  const errors: ParseErrorInfo[] = []

  if (errorCollector.hasErrors()) {
    for (const error of errorCollector.errors) {
      // openscad-parser doesn't export error types, so we need to cast
      const err = error as { codeLocation?: { line: number; col: number }; message?: string }
      const loc = err.codeLocation
      errors.push({
        message: err.message || 'Parse error',
        location: loc
          ? {
              start: { line: loc.line, column: loc.col },
              end: { line: loc.line, column: loc.col },
            }
          : undefined,
      })
    }
  }

  return { ast, errors }
}

/**
 * Replace unicode whitespace the parser doesn't accept (U+00A0 no-break
 * space, U+FEFF zero-width no-break space / BOM) with ASCII spaces.
 * OpenSCAD treats them as whitespace; string contents are left intact so
 * echo output is unaffected. The swap is 1:1, preserving error positions.
 */
export function normalizeSourceWhitespace(source: string): string {
  if (!source.includes('\u00A0') && !source.includes('\uFEFF')) return source
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of source) {
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '\u00A0' || ch === '\uFEFF') {
      out += ' '
    } else {
      out += ch
    }
  }
  return out
}

/**
 * Decode .scad file bytes: strict UTF-8 first, latin-1 fallback.
 * OpenSCAD test files predate consistent UTF-8 (e.g. nbsp-latin1-test.scad
 * uses 0xA0 as no-break space); decoding those bytes as UTF-8 yields U+FFFD,
 * which the parser rejects. Valid UTF-8 decodes identically either way.
 */
export function decodeScadSource(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/**
 * Parse and throw if there are errors
 */
export function parseOrThrow(source: string, filename = 'input.scad'): ScadFile {
  const result = parse(source, filename)

  if (result.errors.length > 0) {
    const firstError = result.errors[0]
    throw parseError(firstError.message, firstError.location)
  }

  return result.ast
}

/**
 * Extract source location from an AST node
 */
export function getLocation(node: { span?: { start: { line: number; col: number }; end: { line: number; col: number } } }): SourceLocation | undefined {
  if (!node.span) return undefined
  return {
    start: { line: node.span.start.line, column: node.span.start.col },
    end: { line: node.span.end.line, column: node.span.end.col },
  }
}
