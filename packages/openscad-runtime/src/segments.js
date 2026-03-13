/**
 * Segment calculation for OpenSCAD compatibility.
 * Pure function — callers are responsible for resolving $fn/$fa/$fs from scope.
 */

// Global $fn override (set via init options / --fn CLI flag, lowest priority)
export let _globalFn = 0
export const setGlobalFn = (fn) => { _globalFn = fn }

/**
 * Calculate segments like OpenSCAD: ceil(max(min(360/$fa, 2*PI*r/$fs), 5))
 *
 * Priority (highest to lowest):
 * 1. Explicit $fn from call site (already resolved from scope by j$ method)
 * 2. Global $fn override (--fn CLI flag)
 * 3. Calculate from $fa/$fs
 */
export const _getSegments = (radius, $fn = 0, $fa = 12, $fs = 2) => {
  if ($fn > 0) return $fn
  if (_globalFn > 0) return _globalFn
  if (radius < 0.001) return 5
  const fromAngle = 360 / $fa
  const fromSize = (2 * Math.PI * radius) / $fs
  return Math.ceil(Math.max(Math.min(fromAngle, fromSize), 5))
}
