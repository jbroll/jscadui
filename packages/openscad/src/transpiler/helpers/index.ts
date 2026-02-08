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

  // Special variable defaults (needed for BOSL library functions)
  const specialVarDefaults: string[] = []
  if (!ctx.variableNames.includes('$fn')) specialVarDefaults.push('$fn = 0')
  if (!ctx.variableNames.includes('$fa')) specialVarDefaults.push('$fa = 12')
  if (!ctx.variableNames.includes('$fs')) specialVarDefaults.push('$fs = 2')
  if (specialVarDefaults.length > 0) {
    imports.push(`const ${specialVarDefaults.join(', ')}`)
  }

  return imports
}
