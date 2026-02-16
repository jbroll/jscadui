/**
 * JSCAD import statement generation
 */

import type { TranspileContext } from '../context.js'

/**
 * Build JSCAD require statements based on what's used
 */
export function buildJscadRequires(ctx: TranspileContext): string[] {
  const imports: string[] = []

  // Filter out JSCAD names that conflict with user-defined modules/functions
  // e.g., BOSL defines its own 'cuboid' module, so we don't import JSCAD's cuboid
  const filterConflicts = (names: Set<string>) =>
    Array.from(names).filter(n => !ctx.availableSymbols.has(n))

  const prims = filterConflicts(ctx.codeGen.usedPrimitives)
  if (prims.length > 0) {
    imports.push(`const { ${prims.join(', ')} } = require('@jscad/modeling').primitives`)
  }

  // Import primitives needed by internal helpers with aliased names to avoid collision
  // e.g., _cube uses cuboid internally even if user defines their own cuboid module
  const internalPrims: string[] = []
  if (ctx.codeGen.usedPrimitives.has('cube') || ctx.codeGen.usedPrimitives.has('cuboid')) {
    if (ctx.availableSymbols.has('cuboid') && !prims.includes('cuboid')) {
      internalPrims.push('cuboid: __cuboid')
    }
  }
  if (internalPrims.length > 0) {
    imports.push(`const { ${internalPrims.join(', ')} } = require('@jscad/modeling').primitives`)
  }

  const xforms = filterConflicts(ctx.codeGen.usedTransforms)
  if (xforms.length > 0) {
    imports.push(`const { ${xforms.join(', ')} } = require('@jscad/modeling').transforms`)
  }

  const bools = filterConflicts(ctx.codeGen.usedBooleans)
  if (bools.length > 0) {
    imports.push(`const { ${bools.join(', ')} } = require('@jscad/modeling').booleans`)
  }

  const extrs = filterConflicts(ctx.codeGen.usedExtrusions)
  if (extrs.length > 0) {
    // When extrudeLinear is used, also import extrudeFromSlices for scale/twist support
    const extrsWithSlices = ctx.codeGen.usedExtrusions.has('extrudeLinear')
      ? [...new Set([...extrs, 'extrudeFromSlices'])]
      : extrs
    imports.push(`const { ${extrsWithSlices.join(', ')} } = require('@jscad/modeling').extrusions`)
  }

  // Import slice separately with renamed alias to avoid conflict with OpenSCAD's slice() function
  if (ctx.codeGen.usedExtrusions.has('extrudeLinear')) {
    imports.push(`const _jscadSlice = require('@jscad/modeling').extrusions.slice`)
  }

  if (ctx.codeGen.usedColors) {
    imports.push(`const { colorize, cssColors } = require('@jscad/modeling').colors`)
  }

  if (ctx.codeGen.usedHulls && !ctx.availableSymbols.has('hull')) {
    imports.push(`const { hull } = require('@jscad/modeling').hulls`)
  }

  // mat4 and geom2 are needed by _linearExtrude helper for scale/twist
  if (ctx.codeGen.usedMaths || ctx.codeGen.usedExtrusions.has('extrudeLinear')) {
    imports.push(`const { mat4 } = require('@jscad/modeling').maths`)
  }

  if (ctx.codeGen.usedExtrusions.has('extrudeLinear')) {
    imports.push(`const { geom2 } = require('@jscad/modeling').geometries`)
  }

  return imports
}
