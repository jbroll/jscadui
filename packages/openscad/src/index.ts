/**
 * @jscadui/openscad - OpenSCAD to JSCAD translator
 *
 * Converts OpenSCAD source code to JSCAD JavaScript code.
 */

// Main translation functions
export { scadToJscad, scadToIR, irToJscad, type TranslateOptions } from './translate.js'

// Parser
export { parse, parseOrThrow, type ParseResult, type ParseErrorInfo } from './parser/parse.js'

// Evaluator
export { evaluate, type EvaluateOptions, type FileResolver } from './evaluator/evaluate.js'

// Emitter
export { emit, type EmitOptions } from './emitter/emit.js'

// Transpiler (AST-to-JS with module exports)
export { transpile, type TranspileOptions, type TranspileResult, type UseImport } from './transpiler/transpile.js'

// IR types
export type {
  IRNode,
  IRPrimitive,
  IRTransform,
  IRBoolean,
  IRHull,
  IRMinkowski,
  IRGroup,
  IRColor,
  IREmpty,
  IRValue,
  IRRange,
  IRParamDef,
  IRModuleDef,
  IRFunctionDef,
  SourceLocation,
} from './ir/types.js'

// Error types
export {
  TranslationError,
  ErrorCode,
} from './utils/errors.js'
