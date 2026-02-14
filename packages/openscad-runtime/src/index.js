/**
 * OpenSCAD Runtime Library
 *
 * All runtime helpers accessible via j$ namespace.
 * Usage: const j$ = require('@jscadui/openscad-runtime')
 *        j$.init(jscad)
 *        j$.cube({size: 10})
 */

import { PI, _range, _min, _max, _num, str, version_num, search, _norm, _cross, _lookup, _rands, is_vector, chr, ord, is_consistent, _list_pattern } from './math.js'
import { _eq, _vadd, _vsub, _vmul, _vdiv, _vneg } from './vector.js'
import { _getSegments, setGlobalFn } from './segments.js'
import { initPrimitives, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _safeUnion, _hull, _union, _subtract, _intersect, _minkowski, _polygon } from './primitives.js'
import { initTransforms, _translate, _rotate, _scale, _mirror, _multmatrix } from './transforms.js'
import { initExtrusions, _linearExtrude, _rotateExtrude } from './extrusions.js'
import { initColor, _color } from './color.js'

/**
 * Sentinel for explicit undef passed as argument.
 * In OpenSCAD, `undef` can be passed explicitly to override a function's default value.
 * In JavaScript, passing `undefined` triggers the default parameter behavior.
 * To distinguish "caller passed undef" from "caller omitted argument", we use this sentinel.
 */
const EXPLICIT_UNDEF = Symbol('explicit_undef')

/**
 * The j$ namespace - contains all OpenSCAD runtime helpers.
 * Use j$.functionName() in transpiled code.
 * Since $ is illegal in OpenSCAD identifiers, this can never conflict with user code.
 */
const j$ = {
  // Sentinel for explicit undef
  EXPLICIT_UNDEF,
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
  chr,
  ord,
  is_consistent,
  _list_pattern,

  // Vector operations (no JSCAD dependency)
  // Wrap _eq to handle EXPLICIT_UNDEF - convert it to undefined for comparison
  eq: (a, b) => {
    if (a === EXPLICIT_UNDEF) a = undefined
    if (b === EXPLICIT_UNDEF) b = undefined
    return _eq(a, b)
  },
  vadd: _vadd,
  vsub: _vsub,
  vmul: _vmul,
  vdiv: _vdiv,
  vneg: _vneg,

  /**
   * Ensure value is iterable with .map() - converts strings to char arrays
   * OpenSCAD: for (c = "hello") iterates over characters
   * JavaScript: strings don't have .map(), so we convert to array
   * Also handles undefined/null by returning empty array (defensive)
   */
  iter: (x) => {
    if (x == null) return []  // undefined or null
    if (typeof x === 'string') return [...x]
    return x
  },

  /**
   * OpenSCAD assert - throws if condition is false, returns undefined if true
   * Unlike console.assert, this actually halts execution on failure
   */
  assert: (condition, message, ...debugArgs) => {
    if (!condition) {
      const msg = message != null ? String(message) : 'Assertion failed'
      const err = new Error()
      const callSite = err.stack.split('\n')[2]  // Get the caller
      console.error('ASSERT FAILED at', callSite)
      console.error('  Message:', msg)
      console.error('  Condition was:', condition)
      if (debugArgs.length > 0) {
        console.error('  Debug args:', debugArgs)
      }
      throw new Error(`Assertion failed: ${msg}`)
    }
  },

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
export { PI, _range, _min, _max, _num, str, version_num, search, _norm, _cross, _lookup, _rands, is_vector, chr, ord, is_consistent, _list_pattern } from './math.js'
export { _eq, _vadd, _vsub, _vmul, _vdiv, _vneg } from './vector.js'
export { _getSegments, setGlobalFn } from './segments.js'
export { initPrimitives, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _safeUnion, _hull, _union, _subtract, _intersect, _minkowski, _polygon } from './primitives.js'
export { initTransforms, _translate, _rotate, _scale, _mirror, _multmatrix } from './transforms.js'
export { initExtrusions, _linearExtrude, _rotateExtrude } from './extrusions.js'
export { initColor, _color } from './color.js'

// Legacy initRuntime
export const initRuntime = (jscad, options = {}) => j$.init(jscad, options)
