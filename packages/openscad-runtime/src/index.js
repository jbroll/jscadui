/**
 * OpenSCAD Runtime Library
 *
 * All runtime helpers accessible via j$ namespace.
 * Usage: const j$ = require('@jscadui/openscad-runtime')
 *        j$.init(jscad)
 *        j$.cube({size: 10})
 */

import { PI, _range, _min, _max, _num, str, version_num, search, _norm, _cross, _lookup, _rands, is_vector } from './math.js'
import { _eq, _vadd, _vsub, _vmul, _vdiv, _vneg } from './vector.js'
import { _getSegments, setGlobalFn } from './segments.js'
import { initPrimitives, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _safeUnion, _hull, _union, _subtract, _intersect, _minkowski, _polygon } from './primitives.js'
import { initTransforms, _translate, _rotate, _scale, _mirror, _multmatrix } from './transforms.js'
import { initExtrusions, _linearExtrude, _rotateExtrude } from './extrusions.js'
import { initColor, _color } from './color.js'

/**
 * The j$ namespace - contains all OpenSCAD runtime helpers.
 * Use j$.functionName() in transpiled code.
 * Since $ is illegal in OpenSCAD identifiers, this can never conflict with user code.
 */
const j$ = {
  // Math helpers (no JSCAD dependency)
  PI,
  range: _range,
  min: _min,
  max: _max,
  num: _num,
  str,
  version_num,
  search,
  norm: _norm,
  cross: _cross,
  lookup: _lookup,
  rands: _rands,
  is_vector,

  // Vector operations (no JSCAD dependency)
  eq: _eq,
  vadd: _vadd,
  vsub: _vsub,
  vmul: _vmul,
  vdiv: _vdiv,
  vneg: _vneg,

  // Primitives (populated after init)
  cube: _cube,
  cylinder: _cylinder,
  sphere: _sphere,
  circle: _circle,
  square: _square,
  regular_polygon: _regular_polygon,
  polyhedron: _polyhedron,
  safeUnion: _safeUnion,
  hull: _hull,

  // Booleans (wrappers that filter undefined values)
  union: _union,
  subtract: _subtract,
  intersect: _intersect,
  minkowski: _minkowski,

  // Additional primitives
  polygon: _polygon,

  // Transforms (populated after init)
  translate: _translate,
  rotate: _rotate,
  scale: _scale,
  mirror: _mirror,
  multmatrix: _multmatrix,

  // Extrusions (populated after init)
  linearExtrude: _linearExtrude,
  rotateExtrude: _rotateExtrude,

  // Color (populated after init)
  color: _color,

  // Direct JSCAD access (populated after init)
  jscad: null,

  /**
   * Initialize the runtime with JSCAD.
   * Must be called before using geometry functions.
   */
  init(jscad, options = {}) {
    this.jscad = jscad
    initPrimitives(jscad)
    initTransforms(jscad)
    initExtrusions(jscad)
    initColor(jscad)
    if (options.globalFn !== undefined) {
      setGlobalFn(options.globalFn)
    }
  }
}

export default j$

// Also export as named for CommonJS compatibility
export { j$ }

// Keep legacy exports for backwards compatibility during transition
export { PI, _range, _min, _max, _num, str, version_num, search, _norm, _cross, _lookup, _rands, is_vector } from './math.js'
export { _eq, _vadd, _vsub, _vmul, _vdiv, _vneg } from './vector.js'
export { _getSegments, setGlobalFn } from './segments.js'
export { initPrimitives, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _safeUnion, _hull, _union, _subtract, _intersect, _minkowski, _polygon } from './primitives.js'
export { initTransforms, _translate, _rotate, _scale, _mirror, _multmatrix } from './transforms.js'
export { initExtrusions, _linearExtrude, _rotateExtrude } from './extrusions.js'
export { initColor, _color } from './color.js'

// Legacy initRuntime
export const initRuntime = (jscad, options = {}) => j$.init(jscad, options)
