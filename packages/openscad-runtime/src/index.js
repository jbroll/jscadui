/**
 * OpenSCAD Runtime Library
 *
 * All runtime helpers accessible via j$ namespace.
 * Usage: const j$ = require('@jscadui/openscad-runtime')
 *        j$.init(jscad)
 *        j$.cube({size: 10})
 */

import { PI, _range, _min, _max, _num, str, _echoVal, parent_module, search, _norm, _cross, _lookup, _rands, _resetRng, is_vector, chr, ord, is_consistent, _list_pattern, reverse, _sinDeg, _cosDeg, _tanDeg } from './math.js'
import { _eq, _vadd, _vsub, _vmul, _vdiv, _vneg } from './vector.js'
import { _getSegments, setGlobalFn } from './segments.js'
import { NO_CHILD as _NO_CHILD, initPrimitives, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _polyhedronHull, _safeUnion, _safeUnion2D, _hull, _union, _subtract, _intersect, _minkowski, _polygon, _region } from './primitives.js'
import { initTransforms, _translate, _rotate, _scale, _mirror, _multmatrix, _resize } from './transforms.js'
import { initExtrusions, _linearExtrude, _rotateExtrude } from './extrusions.js'
import { initColor, _color } from './color.js'
import { initText, _text } from './text.js'
import { DEFAULT_SPECIAL_VARS } from './specialVars.js'
import { consuming } from './consume.js'

/**
 * Sentinel for explicit undef passed as argument.
 * In OpenSCAD, `undef` can be passed explicitly to override a function's default value.
 * In JavaScript, passing `undefined` triggers the default parameter behavior.
 * To distinguish "caller passed undef" from "caller omitted argument", we use this sentinel.
 */
const EXPLICIT_UNDEF = Symbol('explicit_undef')

/**
 * Sentinel for skipped elements in list comprehensions.
 * [for (x = range) if (cond) value] uses this to mark elements where cond is false,
 * so they can be filtered out. Using a distinct symbol (instead of undefined) lets
 * OpenSCAD undef values (JavaScript undefined) pass through the filter correctly.
 */
const SKIP = Symbol('skip_element')

/**
 * The j$ namespace - contains all OpenSCAD runtime helpers.
 * Use j$.functionName() in transpiled code.
 * Since $ is illegal in OpenSCAD identifiers, this can never conflict with user code.
 */
const j$ = {
  // Sentinel for explicit undef
  EXPLICIT_UNDEF,
  // Sentinel for skipped elements in list comprehensions (cond was false)
  SKIP,
  // A self tail-call loop may run this many times, OpenSCAD's own limit (src/core/Expression.cc).
  TAIL_CALL_LIMIT: 1000000,
  recursionDetected: (name) => {
    throw new Error(`Recursion detected calling function '${name}'`)
  },
  // Safe array index — returns integer index or NaN (→ undefined element).
  // OpenSCAD: arr[[n]] returns arr[n] (1-element list unwrap, like search([x],y)[0]).
  //           arr[[]] returns undef; Math.trunc([]) === 0 in JS (wrong coercion).
  //           arr[undef] returns undef.
  trunc: (i) => {
    if (typeof i === 'number') return Math.trunc(i)
    // 1-element array [n] coerces to n (OpenSCAD implicit unwrap for array indexing)
    if (Array.isArray(i) && i.length === 1 && typeof i[0] === 'number') return Math.trunc(i[0])
    return NaN
  },
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
  // version() / version_num(): the runtime follows OpenSCAD 2021.01. A caller
  // comparing with a given OpenSCAD build (test-harness.js) sets that build's
  // version so that models printing it match.
  openscadVersion: [2021, 1, 0],
  version() { return [...this.openscadVersion] },
  version_num() {
    const [y, m = 0, d = 0] = this.openscadVersion
    return y * 10000 + m * 100 + d
  },
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
   * OpenSCAD echo(): one `ECHO: ` line in OpenSCAD's format, e.g.
   * `ECHO: "s", a = [1, 2], undef`. `names` holds each value's argument name
   * (null or absent when positional), or is null when none are named.
   * The line goes to this.onEcho when set (run-jscad --echo collects it),
   * else to console.log.
   */
  echo(names, ...values) {
    const line = 'ECHO: ' + values.map((v, i) => (names?.[i] ? names[i] + ' = ' : '') + _echoVal(v)).join(', ')
    if (this.onEcho) this.onEcho(line)
    else console.log(line)
  },
  onEcho: null,

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
  polyhedronHull(args) { return _polyhedronHull(args) },
  safeUnion: _safeUnion,
  safeUnion2D: _safeUnion2D,
  // children(index): OpenSCAD floors a number (children(1.7) is child 1), skips an
  // out-of-bounds index with a warning, unions a list or range, and ignores
  // anything else. `kids` are the child thunks.
  childrenAt: (kids, index) => {
    const pick = i => {
      if (typeof i !== 'number') return undefined
      const k = Math.floor(i)
      return k >= 0 && k < kids.length ? kids[k]() : undefined
    }
    return Array.isArray(index) ? _safeUnion(index.map(pick)) : pick(index)
  },
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

  // Text primitive — resolves $fn/$fa/$fs from scope like other segment-aware primitives
  text(args) {
    const $fn = this.getSpecialVar('$fn'), $fa = this.getSpecialVar('$fa'), $fs = this.getSpecialVar('$fs')
    return _text({ $fn, $fa, $fs, ...args })
  },

  /**
   * OpenSCAD offset() - offsets a 2D shape outward (positive) or inward (negative)
   * r=val -> round corners (uses expansions.offset with corners='round')
   * delta=val -> sharp corners (JSCAD calls this mode 'edge')
   * delta=val, chamfer=true -> chamfered corners (corners='chamfer')
   */
  offset({ r, delta, chamfer = false } = {}, child) {
    if (child === _NO_CHILD) return _NO_CHILD
    const amount = r !== undefined ? r : (delta !== undefined ? delta : 0)
    const corners = r !== undefined ? 'round' : (chamfer ? 'chamfer' : 'edge')
    if (!child) return undefined
    // For round corners, use $fn/$fa/$fs segment count (same as circle/cylinder)
    const _fn = this.getSpecialVar('$fn'), _fa = this.getSpecialVar('$fa'), _fs = this.getSpecialVar('$fs')
    const segments = corners === 'round'
      ? _getSegments(Math.abs(amount), _fn, _fa, _fs)
      : undefined
    return consuming(j$.jscad.expansions.offset)({ delta: amount, corners, ...(segments !== undefined ? { segments } : {}) }, child)
  },

  // ── Special variable scope stack (instance state) ─────────────────────────
  // Each j$ instance has its own _scopeStack so concurrent executions are isolated.
  // createJ$Instance() creates a fresh instance via Object.create(j$) with a new stack.
  _scopeStack: [{ ...DEFAULT_SPECIAL_VARS }],

  // Latched once any model reads $preview. Never cleared: a false negative
  // would export the wrong geometry, while a stale true only costs a re-run.
  previewUsed: false,

  getSpecialVar(name) {
    if (name === '$preview') this.previewUsed = true
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
export { initPrimitives, withoutDegeneratePolygons, _cube, _cylinder, _sphere, _circle, _square, _regular_polygon, _polyhedron, _polyhedronHull, _safeUnion, _safeUnion2D, _hull, _union, _subtract, _intersect, _minkowski, _polygon, _region } from './primitives.js'
export { initTransforms, _translate, _rotate, _scale, _mirror, _multmatrix, _resize } from './transforms.js'
export { initExtrusions, _linearExtrude, _rotateExtrude , subdivideSides } from './extrusions.js'
export { initColor, _color } from './color.js'
export { initText, _text } from './text.js'
export { DEFAULT_SPECIAL_VARS } from './specialVars.js'

// Legacy initRuntime
export const initRuntime = (jscad, options = {}) => j$.init(jscad, options)
