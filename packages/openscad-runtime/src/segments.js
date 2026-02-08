/**
 * Segment calculation for OpenSCAD compatibility
 */

// Global $fn override - can be set at runtime
export let _globalFn = 0

export const setGlobalFn = (fn) => { _globalFn = fn }

// Calculate segments like OpenSCAD: ceil(max(min(360/$fa, 2*PI*r/$fs), 5))
export const _getSegments = (radius, $fn, $fa = 12, $fs = 2) => {
  // Explicit $fn in code takes precedence over global default
  if ($fn > 0) return $fn
  // Global $fn is used as default when not explicitly set
  if (_globalFn > 0) return _globalFn
  if (radius < 0.001) return 5
  const fromAngle = 360 / $fa
  const fromSize = (2 * Math.PI * radius) / $fs
  return Math.ceil(Math.max(Math.min(fromAngle, fromSize), 5))
}
