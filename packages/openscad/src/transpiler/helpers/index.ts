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
export function buildJscadImports(ctx: TranspileContext): string[] {
  const imports: string[] = []

  // Import jscad and the j$ runtime
  imports.push(`const jscad = require('@jscad/modeling')`)
  imports.push(`const { j$ } = require('@jscadui/openscad-runtime')`)

  // Initialize the runtime with JSCAD
  const globalFn = ctx.options.fn || 0
  imports.push(`j$.init(jscad, { globalFn: ${globalFn} })`)

  // Special variables ($fn, $fa, $fs, BOSL2 attachment vars, etc.) are now handled
  // by the stack-based dynamic scoping system in the runtime.
  // No local variable declarations needed - reads go through j$.getSpecialVar().

  return imports
}
