/**
 * @jscadui/openscad - OpenSCAD to JSCAD transpiler
 *
 * Converts OpenSCAD source code to executable JavaScript code.
 */

// Parser
export { parse, parseOrThrow, type ParseResult, type ParseErrorInfo } from './parser/parse.js'

// Transpiler (AST-to-JS with module exports)
export { transpile, type TranspileOptions, type TranspileResult, type TranspiledFile, type UseImport, type FileResolver } from './transpiler/transpile.js'

// Error types
export { TranslationError, ErrorCode, type SourceLocation } from './utils/errors.js'
