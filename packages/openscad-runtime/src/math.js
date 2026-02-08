/**
 * Math helper functions for OpenSCAD compatibility
 */

export const PI = Math.PI

export const _range = (start, end, step = 1) => {
  const r = []
  for (let i = start; i <= end; i += step) r.push(i)
  return r
}

export const str = (...args) => args.map(a =>
  a === undefined ? "undef" : a === null ? "undef" : String(a)
).join("")

export const version_num = () => 20210100

export const search = (_match, _string, _num_returns = 1, _idx) => [[]]

// min/max that handle array arguments (OpenSCAD: max([1,2,3]) returns 3)
export const _min = (...args) =>
  args.length === 1 && Array.isArray(args[0]) ? Math.min(...args[0]) : Math.min(...args)

export const _max = (...args) =>
  args.length === 1 && Array.isArray(args[0]) ? Math.max(...args[0]) : Math.max(...args)

// Validate numeric arguments - OpenSCAD silently ignores invalid values
export const _num = v => typeof v === 'number' && !isNaN(v) ? v : undefined

export const _norm = (v) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))

export const _cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]

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

// Type checking functions (OpenSCAD built-ins)
export const is_vector = (v, len) => {
  if (!Array.isArray(v)) return false
  if (!v.every(x => typeof x === 'number')) return false
  if (len !== undefined && v.length !== len) return false
  return true
}
