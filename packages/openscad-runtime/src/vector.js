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

// Vector/scalar multiplication - follows OpenSCAD semantics:
// - scalar * scalar -> scalar
// - scalar * vector -> element-wise (vector)
// - vector * scalar -> element-wise (vector)
// - vector * vector -> dot product (scalar)
// - matrix * vector -> matrix-vector multiplication (vector)
// - matrix * matrix -> matrix-matrix multiplication (matrix)
export const _vmul = (a, b) => {
  const aIsArray = Array.isArray(a)
  const bIsArray = Array.isArray(b)

  // Neither is array: scalar multiplication
  if (!aIsArray && !bIsArray) {
    return a * b
  }

  // Only one is array: element-wise scalar multiplication
  if (!aIsArray) {
    return b.map(v => Array.isArray(v) ? _vmul(a, v) : a * v)
  }
  if (!bIsArray) {
    return a.map(v => Array.isArray(v) ? _vmul(v, b) : v * b)
  }

  // Both are arrays
  const aIsMatrix = a.length > 0 && Array.isArray(a[0])
  const bIsMatrix = b.length > 0 && Array.isArray(b[0])

  // vector * vector -> dot product
  if (!aIsMatrix && !bIsMatrix) {
    return a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)
  }

  // matrix * vector -> matrix-vector multiplication
  if (aIsMatrix && !bIsMatrix) {
    return a.map(row => _vmul(row, b))
  }

  // vector * matrix -> vector-matrix multiplication (row vector * matrix)
  if (!aIsMatrix && bIsMatrix) {
    // Treat a as a row vector, multiply with columns of b
    const cols = b[0].length
    const result = []
    for (let j = 0; j < cols; j++) {
      let sum = 0
      for (let i = 0; i < a.length; i++) {
        sum += a[i] * (b[i]?.[j] ?? 0)
      }
      result.push(sum)
    }
    return result
  }

  // matrix * matrix -> proper matrix multiplication
  const rows = a.length
  const cols = b[0].length
  const inner = b.length
  const result = []
  for (let i = 0; i < rows; i++) {
    const row = []
    for (let j = 0; j < cols; j++) {
      let sum = 0
      for (let k = 0; k < inner; k++) {
        sum += (a[i][k] ?? 0) * (b[k]?.[j] ?? 0)
      }
      row.push(sum)
    }
    result.push(row)
  }
  return result
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
