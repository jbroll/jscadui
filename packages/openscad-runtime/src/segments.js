/**
 * Segment calculation for OpenSCAD compatibility
 */

import { $fn as get$fn, $fa as get$fa, $fs as get$fs } from './specialVars.js'

// Global $fn override - can be set at runtime (lowest priority)
export let _globalFn = 0

export const setGlobalFn = (fn) => { _globalFn = fn }

/**
 * Calculate segments like OpenSCAD: ceil(max(min(360/$fa, 2*PI*r/$fs), 5))
 *
 * Priority (highest to lowest):
 * 1. Explicit $fn passed as argument (from the call site)
 * 2. $fn from the special vars stack (dynamic scope)
 * 3. Global $fn override (set via init options)
 * 4. Calculate from $fa/$fs formula
 *
 * @param {number} radius - The radius for segment calculation
 * @param {number} [$fnArg] - Explicit $fn from call site (optional, deprecated - use stack)
 * @param {number} [$faArg=12] - Explicit $fa from call site (optional)
 * @param {number} [$fsArg=2] - Explicit $fs from call site (optional)
 */
export const _getSegments = (radius, $fnArg, $faArg, $fsArg) => {
  // Priority 1: Explicit $fn argument from call site
  if ($fnArg > 0) return $fnArg

  // Priority 2: $fn from special vars stack
  const stackFn = get$fn()
  if (stackFn > 0) return stackFn

  // Priority 3: Global $fn override
  if (_globalFn > 0) return _globalFn

  // Priority 4: Calculate from $fa/$fs
  if (radius < 0.001) return 5

  // Use stack values for $fa/$fs, falling back to args, then defaults
  const $fa = $faArg ?? get$fa() ?? 12
  const $fs = $fsArg ?? get$fs() ?? 2

  const fromAngle = 360 / $fa
  const fromSize = (2 * Math.PI * radius) / $fs
  return Math.ceil(Math.max(Math.min(fromAngle, fromSize), 5))
}
