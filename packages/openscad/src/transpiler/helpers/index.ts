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
  // Use 'let' so modules can reassign them without temporal dead zone issues
  const specialVarDefaults: string[] = []
  if (!ctx.variableNames.includes('$fn')) specialVarDefaults.push('$fn = 0')
  if (!ctx.variableNames.includes('$fa')) specialVarDefaults.push('$fa = 12')
  if (!ctx.variableNames.includes('$fs')) specialVarDefaults.push('$fs = 2')
  if (specialVarDefaults.length > 0) {
    imports.push(`let ${specialVarDefaults.join(', ')}`)
  }

  // BOSL2 attachment system variables (undefined by default, set by attach system)
  // These must be declared with 'let' at top level so modules can reassign them
  const bosl2Vars = [
    '$transform', '$parent_anchor', '$parent_spin', '$parent_orient',
    '$parent_geom', '$parent_size', '$parent_parts', '$attach_to',
    '$attach_anchor', '$attach_alignment', '$attach_inside',
    '$tags', '$tag', '$save_tag', '$tag_prefix', '$overlap',
    '$color', '$save_color', '$anchor_override',
    '$edge_angle', '$edge_length', '$tags_shown', '$tags_hidden',
    '$ghost_this', '$ghost', '$ghosting', '$highlight_this', '$highlight'
  ]
  // Only declare variables that aren't already assigned in the code
  const bosl2Defaults = bosl2Vars.filter(v => !ctx.variableNames.includes(v))
  if (bosl2Defaults.length > 0) {
    imports.push(`let ${bosl2Defaults.join(', ')}`)
  }

  return imports
}
