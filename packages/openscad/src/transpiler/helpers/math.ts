/**
 * Math helper function generation
 */

import type { TranspileContext } from '../context.js'

/**
 * Build core math helpers (always needed)
 */
export function buildCoreHelpers(ctx: TranspileContext): string[] {
  const imports: string[] = []

  imports.push('')
  imports.push('// OpenSCAD compatibility helpers')

  // Define special variables with OpenSCAD defaults (needed for BOSL library functions like segs())
  // Only define defaults for variables not already declared by the user
  const specialVarDefaults: string[] = []
  if (!ctx.variableNames.includes('$fn')) specialVarDefaults.push('$fn = 0')
  if (!ctx.variableNames.includes('$fa')) specialVarDefaults.push('$fa = 12')
  if (!ctx.variableNames.includes('$fs')) specialVarDefaults.push('$fs = 2')
  if (specialVarDefaults.length > 0) {
    imports.push(`const ${specialVarDefaults.join(', ')}`)
  }

  imports.push('const PI = Math.PI')
  imports.push('const _range = (start, end, step = 1) => { const r = []; for (let i = start; i <= end; i += step) r.push(i); return r }')

  // String functions - always needed since they're commonly used
  imports.push('const str = (...args) => args.map(a => a === undefined ? "undef" : a === null ? "undef" : String(a)).join("")')
  imports.push('const version_num = () => 20210100')  // Pretend to be OpenSCAD 2021.01
  imports.push('const search = (match, string, num_returns = 1, idx) => { /* stub */ return [[]] }')  // Stub for search function

  return imports
}

/**
 * Build optional math helpers based on usage
 */
export function buildMathHelpers(ctx: TranspileContext): string[] {
  const imports: string[] = []

  if (ctx.usedHelpers.has('norm')) {
    imports.push('const _norm = (v) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))')
  }

  if (ctx.usedHelpers.has('cross')) {
    imports.push('const _cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]')
  }

  if (ctx.usedHelpers.has('lookup')) {
    imports.push(`const _lookup = (val, table) => {
  if (table.length === 0) return 0
  if (val <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    if (val <= table[i][0]) {
      const t = (val - table[i-1][0]) / (table[i][0] - table[i-1][0])
      return table[i-1][1] + t * (table[i][1] - table[i-1][1])
    }
  }
  return table[table.length - 1][1]
}`)
  }

  if (ctx.usedHelpers.has('rands')) {
    imports.push(`const _rands = (min, max, count, seed) => {
  const r = []
  let s = seed !== undefined ? seed : Math.random() * 2147483647 | 0
  const rand = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
  for (let i = 0; i < count; i++) r.push(min + rand() * (max - min))
  return r
}`)
  }

  return imports
}

/**
 * Build segment calculation and validation helpers
 */
export function buildSegmentHelpers(ctx: TranspileContext): string[] {
  const globalFn = ctx.options.fn || 0

  return [`
// min/max that handle array arguments (OpenSCAD: max([1,2,3]) returns 3)
const _min = (...args) => args.length === 1 && Array.isArray(args[0]) ? Math.min(...args[0]) : Math.min(...args)
const _max = (...args) => args.length === 1 && Array.isArray(args[0]) ? Math.max(...args[0]) : Math.max(...args)

// Calculate segments like OpenSCAD: ceil(max(min(360/$fa, 2*PI*r/$fs), 5))
const _globalFn = ${globalFn}
const _getSegments = (radius, $fn, $fa = 12, $fs = 2) => {
  // Explicit $fn in code takes precedence over global default
  if ($fn > 0) return $fn
  // Global $fn is used as default when not explicitly set
  if (_globalFn > 0) return _globalFn
  if (radius < 0.001) return 5
  const fromAngle = 360 / $fa
  const fromSize = (2 * Math.PI * radius) / $fs
  return Math.ceil(Math.max(Math.min(fromAngle, fromSize), 5))
}

// Validate numeric arguments - OpenSCAD silently ignores invalid values
// Returns undefined for invalid input so fallback chain works; use _num(x) ?? default
const _num = v => typeof v === 'number' && !isNaN(v) ? v : undefined`]
}
