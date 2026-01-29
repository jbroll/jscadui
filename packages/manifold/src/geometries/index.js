/**
 * Geometry types and utilities for @jscadui/manifold.
 *
 * Re-exports JSCAD geometry functions and adds Manifold-specific wrappers.
 */

// Re-export JSCAD geometry modules from main entry point
import * as jscad from '@jscad/modeling-core'
export const { geom2, geom3, path2, poly2, poly3 } = jscad.geometries

// Export Manifold wrappers
export {
  ManifoldGeom3,
  fromManifold,
  isManifoldGeom3,
  toManifold
} from './ManifoldGeom3.js'

export {
  ManifoldGeom2,
  fromCrossSection,
  isManifoldGeom2,
  toCrossSection
} from './ManifoldGeom2.js'
