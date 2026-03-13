/**
 * Math helper functions for OpenSCAD compatibility
 */

export const PI = Math.PI

// Exact degree-based trig functions - return exact values for multiples of 90°
// This matches OpenSCAD's CGAL behavior where sin(180°) === 0 exactly.
// Without this, sin(720°) returns ~-2.4e-16 in JavaScript, breaking formulas
// like squircle_radius_fg that rely on s2a === 0 for the exact-zero branch.
export const _sinDeg = (a) => {
  const n = ((a % 360) + 360) % 360
  if (n === 0 || n === 180) return 0
  if (n === 90) return 1
  if (n === 270) return -1
  // cos(60°) = sin(30°) = 0.5 exactly — JS Math.sin returns 0.4999... or 0.5000...0001
  if (n === 30 || n === 150) return 0.5
  if (n === 210 || n === 330) return -0.5
  return Math.sin(a * Math.PI / 180)
}

export const _cosDeg = (a) => {
  const n = ((a % 360) + 360) % 360
  if (n === 90 || n === 270) return 0
  if (n === 0) return 1
  if (n === 180) return -1
  // cos(60°) = 0.5 exactly — JS Math.cos returns 0.5000...0001 due to float representation of PI/3
  if (n === 60 || n === 300) return 0.5
  if (n === 120 || n === 240) return -0.5
  return Math.cos(a * Math.PI / 180)
}

export const _tanDeg = (a) => {
  const n = ((a % 360) + 360) % 360
  if (n === 0 || n === 180) return 0
  return Math.tan(a * Math.PI / 180)
}

export const _range = (start, end, step = 1) => {
  const r = []
  if (step > 0) {
    for (let i = start; i <= end; i += step) r.push(i)
  } else if (step < 0) {
    for (let i = start; i >= end; i += step) r.push(i)
  }
  // step === 0 returns empty array (avoid infinite loop)
  return r
}

export const str = (...args) => args.map(a =>
  a === undefined ? "undef" : a === null ? "undef" : String(a)
).join("")

export const version_num = () => 20210100

/**
 * OpenSCAD parent_module function
 * Returns the name of the calling module (for introspection/debugging)
 * In OpenSCAD: parent_module(n) returns name of module n levels up the call stack
 * Since we don't have real module context, return placeholder
 */
export const parent_module = (n = 0) => `<module-${n}>`

/**
 * OpenSCAD search function
 * search(match_values, source, num_returns=1, index_col_num)
 * Returns list of lists - for each match_value, a list of indices where it was found
 *
 * @param {*} _match - value or array of values to search for
 * @param {*} _source - string or array to search in
 * @param {number} _num_returns - 0 for all matches, N for up to N matches (default 1)
 * @param {number} _idx - when source is a table (list of lists), compare against this column
 */
export const search = (_match, _source, _num_returns = 1, _idx) => {
  // Track if input was scalar (affects return format)
  const wasScalar = !Array.isArray(_match)
  // Normalize match to array for processing
  const matches = wasScalar ? [_match] : _match
  const source = _source

  // Helper to search for a single value
  const searchOne = (m) => {
    const results = []

    // Handle string source (search for characters)
    if (typeof source === 'string') {
      const char = String(m)
      for (let i = 0; i < source.length; i++) {
        if (source[i] === char) {
          results.push(i)
          if (_num_returns !== 0 && results.length >= _num_returns) break
        }
      }
      return results
    }

    // Handle array source
    if (Array.isArray(source)) {
      for (let i = 0; i < source.length; i++) {
        // Get the value to compare
        // OpenSCAD defaults to column 0 when searching tables (list of lists)
        // BUT only when searching for scalar values, not when searching for arrays
        // When m is an array, compare full source elements (vectors/lists)
        const useColumnIdx = !Array.isArray(m) && _idx === undefined && Array.isArray(source[i])
        const effectiveIdx = _idx !== undefined ? _idx : (useColumnIdx ? 0 : undefined)
        const val = effectiveIdx !== undefined && Array.isArray(source[i]) ? source[i][effectiveIdx] : source[i]
        // Deep equality check for arrays, strict equality for primitives
        const isMatch = Array.isArray(m) && Array.isArray(val)
          ? JSON.stringify(m) === JSON.stringify(val)
          : m === val
        if (isMatch) {
          results.push(i)
          if (_num_returns !== 0 && results.length >= _num_returns) break
        }
      }
      return results
    }

    // Default: empty results
    return results
  }

  // If input was scalar, return flat list; otherwise return list of lists
  if (wasScalar) {
    return searchOne(matches[0])
  }
  return matches.map(m => searchOne(m))
}

// min/max that handle array arguments (OpenSCAD: max([1,2,3]) returns 3)
export const _min = (...args) =>
  args.length === 1 && Array.isArray(args[0]) ? Math.min(...args[0]) : Math.min(...args)

export const _max = (...args) =>
  args.length === 1 && Array.isArray(args[0]) ? Math.max(...args[0]) : Math.max(...args)

// Validate numeric arguments - OpenSCAD silently ignores invalid values
export const _num = v => typeof v === 'number' && !isNaN(v) ? v : undefined

export const _norm = (v) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))

// OpenSCAD reverse() - reverses a list
export const reverse = (arr) => Array.isArray(arr) ? [...arr].reverse() : arr

export const _cross = (a, b) => {
  // OpenSCAD cross() behavior:
  // - For 2D vectors: returns scalar (z-component of 3D cross product)
  // - For 3D vectors: returns 3D vector
  if (a.length === 2 && b.length === 2) {
    return a[0] * b[1] - a[1] * b[0]
  }
  // 3D cross product
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
}

export const _lookup = (val, table) => {
  if (table.length === 0) return 0
  // OpenSCAD always sorts the table by x-value before interpolation.
  // We must do the same: a table can appear ordered (first[0] < last[0]) but
  // still be non-monotonic internally (e.g. BOSL2 worm rack_profile, where
  // xcopies produces per-tooth segments each in decreasing x order, then jumps
  // up for the next tooth — causing wrong lookup results if we skip the sort).
  const sorted = [...table].sort((a, b) => a[0] - b[0])
  if (val <= sorted[0][0]) return sorted[0][1]
  for (let i = 1; i < sorted.length; i++) {
    if (val <= sorted[i][0]) {
      const t = (val - sorted[i-1][0]) / (sorted[i][0] - sorted[i-1][0])
      return sorted[i-1][1] + t * (sorted[i][1] - sorted[i-1][1])
    }
  }
  return sorted[sorted.length - 1][1]
}

// Mersenne Twister MT19937 implementation
// Matches OpenSCAD's boost::mt19937 PRNG
class MT19937 {
  constructor(seed = 0) {
    this.mt = new Uint32Array(624)
    this.index = 624
    this.mt[0] = seed >>> 0
    for (let i = 1; i < 624; i++) {
      const s = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)
      this.mt[i] = (((((s & 0xffff0000) >>> 16) * 1812433253) << 16) + (s & 0x0000ffff) * 1812433253 + i) >>> 0
    }
  }

  next() {
    if (this.index >= 624) {
      for (let i = 0; i < 624; i++) {
        const y = (this.mt[i] & 0x80000000) + (this.mt[(i + 1) % 624] & 0x7fffffff)
        this.mt[i] = this.mt[(i + 397) % 624] ^ (y >>> 1)
        if (y % 2 !== 0) this.mt[i] ^= 0x9908b0df
      }
      this.index = 0
    }
    let y = this.mt[this.index++]
    y ^= y >>> 11
    y ^= (y << 7) & 0x9d2c5680
    y ^= (y << 15) & 0xefc60000
    y ^= y >>> 18
    return y >>> 0
  }

  random() {
    return this.next() / 0x100000000
  }
}

// Global RNG instance - OpenSCAD 2021.01+ maintains state between rands() calls
// "Allow initial seeds to stick between rands calls"
let _globalRng = new MT19937(0)

export const _resetRng = (seed = 0) => {
  _globalRng = new MT19937(seed)
}

export const _rands = (min, max, count, seed) => {
  // If seed is provided, reinitialize the global RNG
  // Otherwise, continue from previous state (OpenSCAD behavior since 2021.01)
  if (seed !== undefined) {
    _globalRng = new MT19937(seed)
  }

  const r = []
  for (let i = 0; i < count; i++) {
    r.push(min + _globalRng.random() * (max - min))
  }
  return r
}

/**
 * Convert character code(s) to string
 * chr(65) -> "A"
 * chr([72, 101, 108, 108, 111]) -> "Hello"
 */
export const chr = (code) => {
  if (Array.isArray(code)) {
    return code.map(c => String.fromCodePoint(c)).join('')
  }
  return String.fromCodePoint(code)
}

/**
 * Convert character to its code point
 * ord("A") -> 65
 * Only returns the code of the first character
 */
export const ord = (char) => {
  if (typeof char !== 'string' || char.length === 0) return undefined
  return char.codePointAt(0)
}

// Type checking functions (OpenSCAD built-ins)
// Extended signature to match BOSL2: is_vector(v, length, zero, all_nonzero=false, eps=EPSILON)
// - length: optional required vector length
// - zero: if defined, checks if vector norm is (approximately) zero
// - all_nonzero: if true, requires all elements to be non-zero
// - eps: epsilon for zero comparison (default 1e-9)
export const is_vector = (v, length, zero, all_nonzero = false, eps = 1e-9) => {
  if (!Array.isArray(v) || v.length === 0) return false
  if (!v.every(x => typeof x === 'number' && isFinite(x))) return false
  if (length !== undefined && v.length !== length) return false
  if (zero !== undefined) {
    const n = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
    // zero=true means we expect norm < eps, zero=false means norm >= eps
    if ((n >= eps) !== !zero) return false
  }
  if (all_nonzero && !v.every(x => x !== 0)) return false
  return true
}

/**
 * Creates a pattern from a list where all values become 0 but structure is preserved.
 * OpenSCAD: _list_pattern([1, [2,3]]) => [0, [0,0]]
 */
export const _list_pattern = (list) => {
  if (!Array.isArray(list)) return 0
  return list.map(entry => Array.isArray(entry) ? _list_pattern(entry) : 0)
}

/**
 * Zero out a value while preserving structure.
 * OpenSCAD's 0*x behavior: 0*5=0, 0*[1,2]=[0,0], 0*[[1,2],[3,4]]=[[0,0],[0,0]]
 */
const zeroOut = (x) => {
  if (typeof x === 'number') return 0
  if (!Array.isArray(x)) return 0
  return x.map(zeroOut)
}

/**
 * Check if two patterns (zeroed structures) are equal
 */
const patternsEqual = (a, b) => {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b
  if (a.length !== b.length) return false
  return a.every((val, i) => patternsEqual(val, b[i]))
}

/**
 * Checks if all list elements have a consistent structure (same pattern).
 * OpenSCAD: is_consistent([[1,2], [3,4], [5,6]]) => true (all 2-element arrays)
 * OpenSCAD: is_consistent([[1,2], [3,4,5]]) => false (different lengths)
 *
 * @param {Array} list - The list to check
 * @param {*} pattern - Optional pattern to check against
 */
export const is_consistent = (list, pattern) => {
  if (!Array.isArray(list)) return false
  if (list.length === 0) return true

  // Get the reference pattern
  const refPattern = pattern !== undefined ? _list_pattern(pattern) : _list_pattern(list[0])

  // Check all elements match the pattern
  return list.every(entry => patternsEqual(zeroOut(entry), refPattern))
}
