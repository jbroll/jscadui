/**
 * Curves module - re-exports from @jscad/modeling-for-manifold.
 *
 * Curves are n-dimensional mathematical constructs that define a path
 * from point 0 to point 1.
 */

import * as jscadModule from '@jscad/modeling-for-manifold'

// Handle both ESM default export (Node.js) and bundled named exports (vitest/bundler)
const jscad = jscadModule.default || jscadModule

const jscadCurves = jscad.curves

/**
 * Bezier curve functions.
 */
export const bezier = jscadCurves.bezier

export default {
  bezier
}
