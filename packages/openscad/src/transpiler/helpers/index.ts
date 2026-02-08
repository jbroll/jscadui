/**
 * Helper generation orchestrator
 *
 * Generates imports from @jscadui/openscad-runtime for OpenSCAD compatibility.
 */

import type { TranspileContext } from '../context.js'

/**
 * Build JSCAD imports and runtime helper imports based on context
 */
export function buildJscadImports(ctx: TranspileContext): string[] {
  const imports: string[] = []

  // Collect all runtime helpers needed
  const runtimeHelpers: string[] = []
  const jscadDirectImports: { [category: string]: string[] } = {
    primitives: [],
    transforms: [],
    booleans: [],
    extrusions: [],
    hulls: [],
    colors: [],
  }

  // Core helpers (always needed)
  runtimeHelpers.push('PI', '_range', 'str', 'version_num', 'search')
  runtimeHelpers.push('_min', '_max', '_num', '_getSegments')

  // Math helpers based on usage
  if (ctx.usedHelpers.has('norm')) runtimeHelpers.push('_norm')
  if (ctx.usedHelpers.has('cross')) runtimeHelpers.push('_cross')
  if (ctx.usedHelpers.has('lookup')) runtimeHelpers.push('_lookup')
  if (ctx.usedHelpers.has('rands')) runtimeHelpers.push('_rands')

  // Vector operations
  if (ctx.usedHelpers.has('eq')) runtimeHelpers.push('_eq')
  if (ctx.usedHelpers.has('vadd')) runtimeHelpers.push('_vadd')
  if (ctx.usedHelpers.has('vsub')) runtimeHelpers.push('_vsub')
  if (ctx.usedHelpers.has('vmul')) runtimeHelpers.push('_vmul')
  if (ctx.usedHelpers.has('vdiv')) runtimeHelpers.push('_vdiv')
  if (ctx.usedHelpers.has('vneg')) runtimeHelpers.push('_vneg')

  // Primitive wrappers
  if (ctx.usedPrimitives.has('cube') || ctx.usedPrimitives.has('cuboid')) runtimeHelpers.push('_cube')
  if (ctx.usedPrimitives.has('cylinder')) runtimeHelpers.push('_cylinder')
  if (ctx.usedPrimitives.has('sphere')) runtimeHelpers.push('_sphere')
  if (ctx.usedPrimitives.has('circle')) runtimeHelpers.push('_circle')
  if (ctx.usedPrimitives.has('rectangle')) runtimeHelpers.push('_square')
  if (ctx.usedPrimitives.has('regular_polygon')) runtimeHelpers.push('_regular_polygon')
  if (ctx.usedPrimitives.has('polyhedron')) runtimeHelpers.push('_polyhedron')
  if (ctx.usedHelpers.has('safeUnion')) runtimeHelpers.push('_safeUnion')

  // Transform helpers - check usedTransforms since builtins.ts marks rotation components there
  if (ctx.usedTransforms.has('rotateX') || ctx.usedTransforms.has('rotateY') || ctx.usedTransforms.has('rotateZ')) {
    runtimeHelpers.push('_rotate')
  }
  if (ctx.usedHelpers.has('multmatrix')) runtimeHelpers.push('_multmatrix')

  // Extrusion helpers
  if (ctx.usedExtrusions.has('extrudeLinear')) runtimeHelpers.push('_linearExtrude')
  if (ctx.usedExtrusions.has('extrudeRotate')) runtimeHelpers.push('_rotateExtrude')

  // Color helper
  if (ctx.usedColors) runtimeHelpers.push('_color')

  // Collect direct JSCAD imports (not filtered by available symbols - runtime handles that)
  const filterConflicts = (names: Set<string>) =>
    Array.from(names).filter(n => !ctx.availableSymbols.has(n))

  // Primitives needed directly (polygon for 2D, etc.)
  const directPrims = filterConflicts(ctx.usedPrimitives)
    .filter(p => !['cube', 'cuboid', 'sphere', 'cylinder', 'circle', 'rectangle', 'regular_polygon', 'polyhedron'].includes(p))
  if (directPrims.length > 0) jscadDirectImports.primitives.push(...directPrims)

  // Transforms used directly
  const directXforms = filterConflicts(ctx.usedTransforms)
  if (directXforms.length > 0) jscadDirectImports.transforms.push(...directXforms)

  // Booleans used directly
  const directBools = filterConflicts(ctx.usedBooleans)
  if (directBools.length > 0) jscadDirectImports.booleans.push(...directBools)

  // Hulls
  if (ctx.usedHulls) jscadDirectImports.hulls.push('hull')

  // Generate the JSCAD module import
  imports.push(`const jscad = require('@jscad/modeling')`)

  // Generate the runtime import with all needed helpers
  imports.push(`const { initRuntime, ${runtimeHelpers.join(', ')} } = require('@jscadui/openscad-runtime')`)

  // Initialize the runtime with JSCAD
  const globalFn = ctx.options.fn || 0
  imports.push(`initRuntime(jscad, { globalFn: ${globalFn} })`)

  // Special variable defaults (needed for BOSL library functions)
  const specialVarDefaults: string[] = []
  if (!ctx.variableNames.includes('$fn')) specialVarDefaults.push('$fn = 0')
  if (!ctx.variableNames.includes('$fa')) specialVarDefaults.push('$fa = 12')
  if (!ctx.variableNames.includes('$fs')) specialVarDefaults.push('$fs = 2')
  if (specialVarDefaults.length > 0) {
    imports.push(`const ${specialVarDefaults.join(', ')}`)
  }

  // Generate direct JSCAD imports from the jscad object
  for (const [category, names] of Object.entries(jscadDirectImports)) {
    if (names.length > 0) {
      imports.push(`const { ${names.join(', ')} } = jscad.${category}`)
    }
  }

  return imports
}
