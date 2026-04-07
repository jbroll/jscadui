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

// Format a number like OpenSCAD's str(): 6 significant digits, C printf %g style
const _strNum = (x) => {
  if (!Number.isFinite(x)) return String(x)
  if (x === 0) return '0'
  const s = x.toPrecision(6)
  if (s.includes('e')) {
    // Exponential notation: strip trailing zeros in mantissa, normalize exponent
    return s.replace(/\.?0+(e)/, '$1').replace(/e([+-])0*(\d+)/, (_, sign, digits) => 'e' + sign + digits)
  }
  // Fixed notation: strip trailing decimal zeros
  if (s.includes('.')) return s.replace(/\.?0+$/, '')
  return s
}

const _strVal = (a) => {
  if (a === undefined || a === null) return 'undef'
  if (typeof a === 'number') return _strNum(a)
  if (typeof a === 'boolean') return a ? 'true' : 'false'
  if (Array.isArray(a)) return '[' + a.map(_strVal).join(', ') + ']'
  return String(a)
}

export const str = (...args) => args.map(_strVal).join("")

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
        // OpenSCAD column-0 semantics:
        //   - scalar needle + array source[i]: always use col 0 (traditional table lookup)
        //   - array needle + array source[i]:  use col 0 ONLY when col 0 is itself an array
        //     (e.g. bucket=[[key,val],...] where key is an array → compare needle vs col0=key)
        //     otherwise compare needle against full source[i]
        //     (e.g. badTriangles=[tri,...] where tri=[a,b,c,h] → compare needle vs full tri)
        const useColumnIdx = Array.isArray(source[i]) && (
          _idx !== undefined ||
          !Array.isArray(m) ||
          Array.isArray(source[i][0])
        )
        const effectiveIdx = useColumnIdx ? (_idx !== undefined ? _idx : 0) : undefined
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

  // If input was scalar, return flat list; otherwise return list of lists.
  // For list needle (including single-element), returns [[k]] when found, [[]] when not found.
  // This matches OpenSCAD semantics. hashmap_del's `loop_var != search_result[0]` works
  // because _eq handles number == [number] coercion (matching OpenSCAD's implicit behavior).
  if (wasScalar) {
    return searchOne(matches[0])
  }
  return matches.map(m => searchOne(m))
}

// min/max that handle array arguments (OpenSCAD: max([1,2,3]) returns 3)
// Also handles arrays of vectors: min([[1,2],[3,0]]) = [1,0] (component-wise)
export const _min = (...args) => {
  if (args.length === 1 && Array.isArray(args[0])) {
    const arr = args[0]
    if (arr.length === 0) return undefined
    if (Array.isArray(arr[0])) {
      // Component-wise min of vectors
      const len = arr[0].length
      const result = new Array(len)
      for (let j = 0; j < len; j++) result[j] = arr[0][j]
      for (let i = 1; i < arr.length; i++) {
        for (let j = 0; j < len; j++) {
          if (arr[i][j] < result[j]) result[j] = arr[i][j]
        }
      }
      return result
    }
    return Math.min(...arr)
  }
  return Math.min(...args)
}

export const _max = (...args) => {
  if (args.length === 1 && Array.isArray(args[0])) {
    const arr = args[0]
    if (arr.length === 0) return undefined
    if (Array.isArray(arr[0])) {
      // Component-wise max of vectors
      const len = arr[0].length
      const result = new Array(len)
      for (let j = 0; j < len; j++) result[j] = arr[0][j]
      for (let i = 1; i < arr.length; i++) {
        for (let j = 0; j < len; j++) {
          if (arr[i][j] > result[j]) result[j] = arr[i][j]
        }
      }
      return result
    }
    return Math.max(...arr)
  }
  return Math.max(...args)
}

// Validate numeric arguments - OpenSCAD silently ignores invalid values
export const _num = v => typeof v === 'number' && !isNaN(v) ? v : undefined

export const _norm = (v) => {
  if (!Array.isArray(v)) return undefined
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
}

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

/**
 * Hash a floating-point seed value to a uint32 — matches OpenSCAD's hash_floating_point().
 * OpenSCAD uses Python's _Py_HashDouble algorithm (src/geometry/linalg.cc) to convert
 * float seeds to uint32 before seeding std::mt19937. This ensures integers map to themselves
 * (hash(1.0)=1, hash(2.0)=2) while non-integer floats produce stable, distinct seeds.
 * @param {number} v
 * @returns {number} int32 hash value (cast to uint32 via >>> 0 before use as seed)
 */
function _hashFloatingPoint(v) {
  const PyHASH_BITS = 31
  const PyHASH_MODULUS = 0x7FFFFFFF  // 2^31 - 1
  if (!isFinite(v)) {
    if (v === Infinity) return 314159
    if (v === -Infinity) return -314159
    return 0
  }
  // frexp: decompose v into mantissa m in [0.5, 1.0) and exponent e (v = m * 2^e)
  let e = 0
  let m = Math.abs(v)
  if (m !== 0) {
    const log2 = Math.floor(Math.log2(m))
    e = log2 + 1
    m = m / Math.pow(2, e)
  }
  const sign = v < 0 ? -1 : 1
  // Process mantissa 28 bits at a time, accumulating into x mod PyHASH_MODULUS
  let x = 0
  while (m !== 0) {
    x = ((x << 28) & PyHASH_MODULUS) | (x >>> (PyHASH_BITS - 28))
    m *= 268435456.0  // 2^28
    e -= 28
    const y = Math.floor(m)
    m -= y
    x += y
    if (x >= PyHASH_MODULUS) x -= PyHASH_MODULUS
  }
  // Adjust for the exponent (reduce e modulo PyHASH_BITS)
  e = e >= 0 ? e % PyHASH_BITS : PyHASH_BITS - 1 - ((-1 - e) % PyHASH_BITS)
  x = ((x << e) & PyHASH_MODULUS) | (x >>> (PyHASH_BITS - e))
  return (x * sign) | 0  // return as int32
}

// Mersenne Twister MT19937 implementation
// Matches OpenSCAD's std::mt19937 PRNG
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
    // C++11 generate_canonical<double,53>: consumes 2 x 32-bit values for full 53-bit precision
    // Matches OpenSCAD's std::uniform_real_distribution<double> with std::mt19937
    const v0 = this.next()
    const v1 = this.next()
    return v0 * (1.0 / 4294967296.0) * (1.0 / 4294967296.0) + v1 * (1.0 / 4294967296.0)
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
    // OpenSCAD converts float seeds via Python's _Py_HashDouble before seeding mt19937.
    // This ensures hash(1.0)=1, hash(2.0)=2, but hash(1.5)≠hash(1.0).
    _globalRng = new MT19937(_hashFloatingPoint(seed) >>> 0)
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
