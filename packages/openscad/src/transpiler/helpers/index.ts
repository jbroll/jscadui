/**
 * Helper generation orchestrator
 *
 * Coordinates generation of all runtime helpers for OpenSCAD compatibility.
 */

import type { TranspileContext } from '../context.js'
import { buildJscadRequires } from './imports.js'
import { buildCoreHelpers, buildMathHelpers, buildSegmentHelpers } from './math.js'
import { buildVectorHelpers } from './vector.js'
import { buildPrimitiveHelpers } from './primitives.js'
import { buildTransformHelpers } from './transforms.js'
import { buildExtrusionHelpers } from './extrusions.js'
import { buildColorHelpers } from './color.js'

/**
 * Build all JSCAD imports and helpers based on context
 */
export function buildJscadImports(ctx: TranspileContext): string[] {
  const imports: string[] = []

  // JSCAD require statements
  imports.push(...buildJscadRequires(ctx))

  // Core helpers (always needed)
  imports.push(...buildCoreHelpers(ctx))

  // Segment calculation and validation
  imports.push(...buildSegmentHelpers(ctx))

  // Optional math helpers
  imports.push(...buildMathHelpers(ctx))

  // Vector operations
  imports.push(...buildVectorHelpers(ctx))

  // Primitive wrappers
  imports.push(...buildPrimitiveHelpers(ctx))

  // Transform helpers
  imports.push(...buildTransformHelpers(ctx))

  // Extrusion helpers
  imports.push(...buildExtrusionHelpers(ctx))

  // Color helpers
  imports.push(...buildColorHelpers(ctx))

  return imports
}

// Re-export individual builders for testing/customization
export {
  buildJscadRequires,
  buildCoreHelpers,
  buildMathHelpers,
  buildSegmentHelpers,
  buildVectorHelpers,
  buildPrimitiveHelpers,
  buildTransformHelpers,
  buildExtrusionHelpers,
  buildColorHelpers,
}
