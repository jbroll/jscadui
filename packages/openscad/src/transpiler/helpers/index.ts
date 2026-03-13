/**
 * Helper generation orchestrator
 *
 * Generates the j$ runtime import for OpenSCAD compatibility.
 * The j$ namespace contains all helpers and JSCAD wrappers.
 * Since $ is illegal in OpenSCAD identifiers, there can never be naming conflicts.
 */

import type { TranspileContext } from '../context.js'

/**
 * Build the j$ runtime import and initialization
 */
export function buildJscadImports(_ctx: TranspileContext): string[] {
  const imports: string[] = []

  // j$ is passed as a parameter by the executor (run-jscad.js / bundle worker).
  // jscad is required for helpers that call jscad API directly (imports.ts).
  imports.push(`const jscad = require('@jscad/modeling')`)

  // Special variables ($fn, $fa, $fs, BOSL2 attachment vars, etc.) are now handled
  // by the stack-based dynamic scoping system in the runtime.
  // No local variable declarations needed - reads go through j$.getSpecialVar().

  return imports
}
