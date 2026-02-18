/**
 * OpenSCAD Runtime Library
 *
 * All runtime helpers accessible via j$ namespace.
 * Usage: const j$ = require('@jscadui/openscad-runtime')
 *        j$.init(jscad)
 *        j$.cube({size: 10})
 */

import { PI, _range, _min, _max, _num, str, version_num, search, _norm, _cross, _lookup, _rands, _resetRng, is_vector, chr, ord, is_consistent, _list_pattern, reverse, _sinDeg, _cosDeg, _tanDeg } from './math.js'
import { _eq, _vadd, _vsub, _vmul, _vdiv, _vneg } from './vector.js'
import { _getSegments, setGlobalFn } from './segments.js'
import { initPrimitives, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _safeUnion, _hull, _union, _subtract, _intersect, _minkowski, _polygon } from './primitives.js'
import { initTransforms, _translate, _rotate, _scale, _mirror, _multmatrix } from './transforms.js'
import { initExtrusions, _linearExtrude, _rotateExtrude } from './extrusions.js'
import { initColor, _color } from './color.js'
import {
  pushScope, popScope, resetScope,
  getSpecialVar, setSpecialVar,
  $fn, $fa, $fs, set$fn, set$fa, set$fs,
  $t, $preview, set$t, set$preview,
  $vpr, $vpt, $vpd, $vpf, set$vpr, set$vpt, set$vpd, set$vpf,
  $parent_anchor, $parent_spin, $parent_orient, $parent_geom, $parent_size,
  $transform, $attach_to, $attach_anchor, $anchor, $anchor_inside,
  set$parent_anchor, set$parent_spin, set$parent_orient, set$parent_geom, set$parent_size,
  set$transform, set$attach_to, set$attach_anchor, set$anchor, set$anchor_inside
} from './specialVars.js'

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
  resetRng: _resetRng,
  is_vector,
  chr,
  ord,
  is_consistent,
  _list_pattern,
  reverse,
  sinDeg: _sinDeg,
  cosDeg: _cosDeg,
  tanDeg: _tanDeg,

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
   * OpenSCAD truthiness - different from JavaScript for arrays
   * In OpenSCAD: empty arrays [], empty strings "", 0, false, and undef are falsy
   * In JavaScript: empty arrays [] are truthy
   * This function returns true if the value is "truthy" in OpenSCAD semantics
   */
  isTruthy: (x) => {
    if (x === undefined || x === null || x === false) return false
    if (x === 0 || x === '') return false
    if (Array.isArray(x) && x.length === 0) return false
    return true
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

  /**
   * OpenSCAD offset() - offsets a 2D shape outward (positive) or inward (negative)
   * r=val -> round corners (uses expansions.offset with corners='round')
   * delta=val -> sharp corners (corners='sharp')
   * delta=val, chamfer=true -> chamfered corners (corners='chamfer')
   */
  offset({ r, delta, chamfer = false } = {}, child) {
    const amount = r !== undefined ? r : (delta !== undefined ? delta : 0)
    const corners = r !== undefined ? 'round' : (chamfer ? 'chamfer' : 'sharp')
    if (!child) return undefined
    const jscad = j$.jscad
    return jscad.expansions.offset({ delta: amount, corners }, child)
  },

  // Special variables - stack-based dynamic scoping
  pushScope,
  popScope,
  resetScope,
  getSpecialVar,
  setSpecialVar,
  /**
   * Execute a function with a temporary scope of special variables.
   * Automatically handles pushScope/setSpecialVar/popScope with proper cleanup.
   *
   * @param {Object} vars - Object mapping variable names to values (e.g., { '$fn': 32 })
   * @param {Function} fn - Function to execute within the scope
   * @returns {*} The return value of the function
   *
   * @example
   * j$.withScope({ '$fn': 32, '$fa': 2 }, () => j$.sphere({ r: 10 }))
   */
  withScope(vars, fn) {
    pushScope()
    for (const [name, value] of Object.entries(vars)) {
      setSpecialVar(name, value)
    }
    try {
      return fn()
    } finally {
      popScope()
    }
  },
  // Resolution vars
  $fn, $fa, $fs,
  set$fn, set$fa, set$fs,
  // Animation/preview vars
  $t, $preview,
  set$t, set$preview,
  // Viewport vars
  $vpr, $vpt, $vpd, $vpf,
  set$vpr, set$vpt, set$vpd, set$vpf,
  // BOSL2 attachment vars
  $parent_anchor, $parent_spin, $parent_orient, $parent_geom, $parent_size,
  $transform, $attach_to, $attach_anchor, $anchor, $anchor_inside,
  set$parent_anchor, set$parent_spin, set$parent_orient, set$parent_geom, set$parent_size,
  set$transform, set$attach_to, set$attach_anchor, set$anchor, set$anchor_inside,

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
export { PI, _range, _min, _max, _num, str, version_num, search, _norm, _cross, _lookup, _rands, is_vector, chr, ord, is_consistent, _list_pattern, reverse } from './math.js'
export { _eq, _vadd, _vsub, _vmul, _vdiv, _vneg } from './vector.js'
export { _getSegments, setGlobalFn } from './segments.js'
export { initPrimitives, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _safeUnion, _hull, _union, _subtract, _intersect, _minkowski, _polygon } from './primitives.js'
export { initTransforms, _translate, _rotate, _scale, _mirror, _multmatrix } from './transforms.js'
export { initExtrusions, _linearExtrude, _rotateExtrude } from './extrusions.js'
export { initColor, _color } from './color.js'

// Legacy initRuntime
export const initRuntime = (jscad, options = {}) => j$.init(jscad, options)
