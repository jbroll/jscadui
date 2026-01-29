/**
 * Curves module - re-exports from @jscad/modeling-core.
 *
 * Curves are n-dimensional mathematical constructs that define a path
 * from point 0 to point 1.
 */

import * as jscad from '@jscad/modeling-core'

const jscadCurves = jscad.curves

/**
 * Bezier curve functions.
 */
export const bezier = jscadCurves.bezier

export default {
  bezier
}
