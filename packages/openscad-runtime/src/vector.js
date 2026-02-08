/**
 * Vector operation helpers for OpenSCAD compatibility
 */

// Deep equality comparison for OpenSCAD's == and != operators
export const _eq = (a, b) => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!_eq(a[i], b[i])) return false
    return true
  }
  return false
}

// Vector addition - works with scalars and arrays (recursive for nested arrays)
export const _vadd = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => _vadd(v, b[i] ?? 0))
  if (Array.isArray(a)) return a.map(v => _vadd(v, b))
  if (Array.isArray(b)) return b.map(v => _vadd(a, v))
  return a + b
}

// Vector subtraction - works with scalars and arrays (recursive for nested arrays)
export const _vsub = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => _vsub(v, b[i] ?? 0))
  if (Array.isArray(a)) return a.map(v => _vsub(v, b))
  if (Array.isArray(b)) return b.map(v => _vsub(a, v))
  return a - b
}

// Vector/scalar multiplication - dot product for vectors, element-wise for scalar
// OpenSCAD: vector * vector = dot product (scalar), scalar * vector = element-wise (vector)
export const _vmul = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)
  if (Array.isArray(a)) return a.map(v => v * b)
  if (Array.isArray(b)) return b.map(v => a * v)
  return a * b
}

// Vector/scalar division - element-wise for vectors, scalar div
export const _vdiv = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => v / (b[i] ?? 1))
  if (Array.isArray(a)) return a.map(v => v / b)
  if (Array.isArray(b)) return b.map(v => a / v)
  return a / b
}

// Vector/scalar negation - element-wise for vectors, scalar negation
export const _vneg = (v) => Array.isArray(v) ? v.map(x => -x) : -v
