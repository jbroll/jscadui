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
  const codeFile = new CodeFile(filename, source)

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
