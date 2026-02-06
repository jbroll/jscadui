/**
 * Main translation function
 *
 * Combines parsing, evaluation, and emission into a single pipeline.
 */

import { parseOrThrow } from './parser/parse.js'
import { evaluate, type EvaluateOptions } from './evaluator/evaluate.js'
import { emit, type EmitOptions } from './emitter/emit.js'
import type { IRNode } from './ir/types.js'

export interface TranslateOptions extends EvaluateOptions, EmitOptions {}

/**
 * Translate OpenSCAD source code to JSCAD
 */
export function scadToJscad(source: string, options: TranslateOptions = {}): string {
  // Parse
  const ast = parseOrThrow(source)

  // Evaluate to IR
  const ir = evaluate(ast, options)

  // Emit JSCAD code
  return emit(ir, options)
}

/**
 * Parse OpenSCAD source to IR (intermediate step)
 */
export function scadToIR(source: string, options: EvaluateOptions = {}): IRNode {
  const ast = parseOrThrow(source)
  return evaluate(ast, options)
}

/**
 * Emit IR to JSCAD code
 */
export function irToJscad(ir: IRNode, options: EmitOptions = {}): string {
  return emit(ir, options)
}
