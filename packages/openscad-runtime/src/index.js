/**
 * OpenSCAD Runtime Library
 *
 * All runtime helpers accessible via j$ namespace.
 * Usage: const j$ = require('@jscadui/openscad-runtime')
 *        j$.init(jscad)
 *        j$.cube({size: 10})
 */

import { PI, _range, _min, _max, _num, str, version_num, parent_module, search, _norm, _cross, _lookup, _rands, _resetRng, is_vector, chr, ord, is_consistent, _list_pattern, reverse, _sinDeg, _cosDeg, _tanDeg } from './math.js'
import { _eq, _vadd, _vsub, _vmul, _vdiv, _vneg } from './vector.js'
import { _getSegments, setGlobalFn } from './segments.js'
import { NO_CHILD as _NO_CHILD, initPrimitives, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _safeUnion, _hull, _union, _subtract, _intersect, _minkowski, _polygon, _region } from './primitives.js'
import { initTransforms, _translate, _rotate, _scale, _mirror, _multmatrix, _resize } from './transforms.js'
import { initExtrusions, _linearExtrude, _rotateExtrude } from './extrusions.js'
import { initColor, _color } from './color.js'
import { initText, _text } from './text.js'
import { DEFAULT_SPECIAL_VARS } from './specialVars.js'

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
  // Convert EXPLICIT_UNDEF to real undefined in function preambles.
  // Replaces per-param `if (x === EXPLICIT_UNDEF) x = undefined` with a single call.
  resolveUndef: (...args) => args.map(a => a === EXPLICIT_UNDEF ? undefined : a),
  // Map _arg0/_arg1/... positional args to named params in module preambles.
  // Replaces per-param `if (x === undefined) x = _opts._argN` with a single call.
  applyPositionalArgs: (_opts, vals) => {
    if (!('_arg0' in _opts)) return vals
    return vals.map((v, i) => v === undefined ? _opts[`_arg${i}`] : v)
  },
  // Resolve EXPLICIT_UNDEF and apply default values for module parameters.
  // Replaces per-param `x = x !== undefined && x !== EXPLICIT_UNDEF ? x : default` with a single call.
  // For each param: if defined and not EXPLICIT_UNDEF, keep it; otherwise use the default.
  resolveParams: (vals, defaults) => vals.map((v, i) =>
    (v !== undefined && v !== EXPLICIT_UNDEF) ? v : defaults[i]
  ),
  // Sentinel for absent child (conditional not taken, vs undefined=empty geometry)
  NO_CHILD: _NO_CHILD,
  // Math helpers (no JSCAD dependency)
  PI,
  range: _range,
  min: _min,
  max: _max,
  num: _num,
  str,
  version_num,
  parent_module,
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
    if (typeof x === 'number' || typeof x === 'boolean') return [x]  // scalar/bool → single-iteration
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

  // Primitives — resolve $fn/$fa/$fs from scope before calling through
  cube(args) { return _cube(args) },
  cylinder(args) {
    const $fn = this.getSpecialVar('$fn'), $fa = this.getSpecialVar('$fa'), $fs = this.getSpecialVar('$fs')
    return _cylinder({ $fn, $fa, $fs, ...args })
  },
  sphere(args) {
    const $fn = this.getSpecialVar('$fn'), $fa = this.getSpecialVar('$fa'), $fs = this.getSpecialVar('$fs')
    return _sphere({ $fn, $fa, $fs, ...args })
  },
  circle(args) {
    const $fn = this.getSpecialVar('$fn'), $fa = this.getSpecialVar('$fa'), $fs = this.getSpecialVar('$fs')
    return _circle({ $fn, $fa, $fs, ...args })
  },
  square(args) { return _square(args) },
  regular_polygon(args) {
    const $fn = this.getSpecialVar('$fn'), $fa = this.getSpecialVar('$fa'), $fs = this.getSpecialVar('$fs')
    return _regular_polygon({ $fn, $fa, $fs, ...args })
  },
  polyhedron(args) { return _polyhedron(args) },
  safeUnion: _safeUnion,
  hull: _hull,

  // Booleans (wrappers that filter undefined values)
  union: _union,
  subtract: _subtract,
  intersect: _intersect,
  minkowski: _minkowski,

  // Additional primitives
  polygon: _polygon,
  region: _region,

  // Transforms (populated after init)
  translate: _translate,
  rotate: _rotate,
  scale: _scale,
  mirror: _mirror,
  multmatrix: _multmatrix,
  resize: _resize,

  // Extrusions — resolve $fn/$fa/$fs from scope before calling through
  linearExtrude(args, geo) {
    const $fn = this.getSpecialVar('$fn'), $fa = this.getSpecialVar('$fa'), $fs = this.getSpecialVar('$fs')
    return _linearExtrude({ $fn, $fa, $fs, ...args }, geo)
  },
  rotateExtrude(args, geo) {
    const $fn = this.getSpecialVar('$fn'), $fa = this.getSpecialVar('$fa'), $fs = this.getSpecialVar('$fs')
    return _rotateExtrude({ $fn, $fa, $fs, ...args }, geo)
  },

  // Color (populated after init)
  color: _color,

  // Text primitive (async - returns Promise<geom2>)
  text: _text,

  /**
   * OpenSCAD offset() - offsets a 2D shape outward (positive) or inward (negative)
   * r=val -> round corners (uses expansions.offset with corners='round')
   * delta=val -> sharp corners (corners='sharp')
   * delta=val, chamfer=true -> chamfered corners (corners='chamfer')
   */
  offset({ r, delta, chamfer = false } = {}, child) {
    if (child === _NO_CHILD) return _NO_CHILD
    const amount = r !== undefined ? r : (delta !== undefined ? delta : 0)
    const corners = r !== undefined ? 'round' : (chamfer ? 'chamfer' : 'sharp')
    if (!child) return undefined
    const jscad = j$.jscad
    // For round corners, use $fn/$fa/$fs segment count (same as circle/cylinder)
    const _fn = this.getSpecialVar('$fn'), _fa = this.getSpecialVar('$fa'), _fs = this.getSpecialVar('$fs')
    const segments = corners === 'round'
      ? _getSegments(Math.abs(amount), _fn, _fa, _fs)
      : undefined
    return jscad.expansions.offset({ delta: amount, corners, ...(segments !== undefined ? { segments } : {}) }, child)
  },

  // ── Special variable scope stack (instance state) ─────────────────────────
  // Each j$ instance has its own _scopeStack so concurrent executions are isolated.
  // createJ$Instance() creates a fresh instance via Object.create(j$) with a new stack.
  _scopeStack: [{ ...DEFAULT_SPECIAL_VARS }],

  getSpecialVar(name) {
    const stack = this._scopeStack
    for (let i = stack.length - 1; i >= 0; i--) {
      if (name in stack[i]) return stack[i][name]
    }
    return undefined
  },
  setSpecialVar(name, value) {
    const stack = this._scopeStack
    if (stack.length > 0) stack[stack.length - 1][name] = value
  },
  pushScope(initialVars = {}) { this._scopeStack.push({ ...initialVars }) },
  popScope() { if (this._scopeStack.length > 1) this._scopeStack.pop() },
  resetScope() { this._scopeStack.length = 1; this._scopeStack[0] = { ...DEFAULT_SPECIAL_VARS } },

  withScope(vars, fn) {
    // Always push/pop a scope frame, even when vars is empty.
    // An empty scope frame provides isolation: special var modifications
    // inside the callback don't leak to sibling scopes.
    this.pushScope()
    for (const [name, value] of Object.entries(vars)) this.setSpecialVar(name, value)
    try { return fn() } finally { this.popScope() }
  },

  // Inline scope management — eliminates closure overhead for module bodies.
  // Returns true if scope was pushed (caller must call exitScope in finally block).
  enterScope(vars) {
    const entries = Object.entries(vars)
    if (entries.length === 0) return false
    this.pushScope()
    for (const [name, value] of entries) this.setSpecialVar(name, value)
    return true
  },
  exitScope(pushed) {
    if (pushed) this.popScope()
  },


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
    initText(jscad)
    if (options.globalFn !== undefined) {
      setGlobalFn(options.globalFn)
    }
  }
}

export default j$

// Also export as named for CommonJS compatibility
export { j$ }

/**
 * Create a fresh j$ instance with its own scope stack.
 * The new instance inherits all methods and initialized state from the j$ prototype
 * via Object.create, so init() does not need to be called again.
 * Use this to get an isolated runtime for each concurrent execution.
 */
export function createJ$Instance() {
  const inst = Object.create(j$)
  inst._scopeStack = [{ ...DEFAULT_SPECIAL_VARS }]
  return inst
}

// Keep legacy exports for backwards compatibility during transition
export { PI, _range, _min, _max, _num, str, version_num, parent_module, search, _norm, _cross, _lookup, _rands, is_vector, chr, ord, is_consistent, _list_pattern, reverse } from './math.js'
export { _eq, _vadd, _vsub, _vmul, _vdiv, _vneg } from './vector.js'
export { _getSegments, setGlobalFn } from './segments.js'
export { initPrimitives, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _safeUnion, _hull, _union, _subtract, _intersect, _minkowski, _polygon, _region } from './primitives.js'
export { initTransforms, _translate, _rotate, _scale, _mirror, _multmatrix, _resize } from './transforms.js'
export { initExtrusions, _linearExtrude, _rotateExtrude } from './extrusions.js'
export { initColor, _color } from './color.js'
export { initText, _text } from './text.js'
export { DEFAULT_SPECIAL_VARS } from './specialVars.js'

// Legacy initRuntime
export const initRuntime = (jscad, options = {}) => j$.init(jscad, options)
