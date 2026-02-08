/**
 * OpenSCAD Runtime Library
 *
 * Runtime helpers for OpenSCAD to JSCAD transpilation.
 * Call initRuntime(jscad) before using primitives, transforms, or extrusions.
 */

// Math helpers - no JSCAD dependencies
export { PI, _range, _min, _max, _num, str, version_num, search, _norm, _cross, _lookup, _rands } from './math.js'

// Vector operations - no JSCAD dependencies
export { _eq, _vadd, _vsub, _vmul, _vdiv, _vneg } from './vector.js'

// Segment calculation
export { _globalFn, setGlobalFn, _getSegments } from './segments.js'

// Primitives (require init)
export { initPrimitives, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _safeUnion, getPolygon } from './primitives.js'

// Transforms (require init)
export { initTransforms, _rotate, _multmatrix } from './transforms.js'

// Extrusions (require init)
export { initExtrusions, _linearExtrude, _rotateExtrude } from './extrusions.js'

// Color (requires init)
export { initColor, _color } from './color.js'

// Import init functions for initRuntime
import { initPrimitives as _initPrimitives } from './primitives.js'
import { initTransforms as _initTransforms } from './transforms.js'
import { initExtrusions as _initExtrusions } from './extrusions.js'
import { initColor as _initColor } from './color.js'
import { setGlobalFn as _setGlobalFn } from './segments.js'

/**
 * Initialize all JSCAD-dependent helpers.
 * Call this with the jscad object before using any primitives, transforms, or extrusions.
 *
 * @param {object} jscad - The @jscad/modeling module or compatible runtime
 * @param {object} options - Options like { globalFn: 32 }
 */
export const initRuntime = (jscad, options = {}) => {
  _initPrimitives(jscad)
  _initTransforms(jscad)
  _initExtrusions(jscad)
  _initColor(jscad)

  // Set global $fn if provided
  if (options.globalFn !== undefined) {
    _setGlobalFn(options.globalFn)
  }
}
