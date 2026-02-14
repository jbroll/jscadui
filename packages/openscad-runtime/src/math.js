/**
 * Math helper functions for OpenSCAD compatibility
 */

export const PI = Math.PI

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
  if (val <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    if (val <= table[i][0]) {
      const t = (val - table[i-1][0]) / (table[i][0] - table[i-1][0])
      return table[i-1][1] + t * (table[i][1] - table[i-1][1])
    }
  }
  return table[table.length - 1][1]
}

export const _rands = (min, max, count, seed) => {
  const r = []
  let s = seed !== undefined ? seed : Math.random() * 2147483647 | 0
  const rand = () => {
    s |= 0
    s = s + 0x6D2B79F5 | 0
    let t = Math.imul(s ^ s >>> 15, 1 | s)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  for (let i = 0; i < count; i++) r.push(min + rand() * (max - min))
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
