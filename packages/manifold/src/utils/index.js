/**
 * Utility functions.
 *
 * Re-exports from @jscad/modeling-for-manifold/src/utils with Manifold additions.
 */

// Re-export JSCAD utilities from main entry point
import * as jscad from '@jscad/modeling-for-manifold'
export const { flatten, fnNumberSort, radiusToSegments } = jscad.utils

// Re-export degToRad and radToDeg from maths (JSCAD exports these from utils)
export { degToRad, radToDeg } from '../maths/index.js'

/**
 * Flatten nested arrays of geometries.
 *
 * @param {Array} arr - Nested array
 * @returns {Array} Flat array
 */
export const flattenGeometries = (arr) => arr.flat(Infinity).filter(g => g != null)

/**
 * Check if object is a ManifoldGeom3.
 */
export { isManifoldGeom3 } from '../geometries/ManifoldGeom3.js'

/**
 * Check if object is a ManifoldGeom2.
 */
export { isManifoldGeom2 } from '../geometries/ManifoldGeom2.js'

/**
 * Get the Manifold module (for advanced usage).
 */
export { getModule, getManifold, getCrossSection, isInitialized } from '../init.js'

/**
 * Conversion utilities.
 */
export {
  geom3ToManifold,
  manifoldToGeom3,
  geom2ToCrossSection,
  crossSectionToGeom2
} from '../conversions/index.js'

/**
 * Check if a geometry is a path2 (points array without sides).
 *
 * @param {Object} geom - Geometry to check
 * @returns {boolean} True if geometry is a path2
 */
export const isPath2 = (geom) => geom && geom.points !== undefined && geom.sides === undefined

/**
 * Check if a 3D vector has any non-zero components.
 *
 * @param {Array} vec - Vector as [x, y, z]
 * @returns {boolean} True if any component is non-zero
 */
export const isNonZeroVector3 = (vec) => vec[0] !== 0 || vec[1] !== 0 || vec[2] !== 0

/**
 * Translate a manifold only if the offset is non-zero.
 * Returns the original manifold if offset is [0,0,0].
 *
 * @param {Object} manifold - Manifold to translate
 * @param {Array} offset - Translation offset as [x, y, z]
 * @returns {Object} Translated manifold (or original if offset is zero)
 */
export const translateIfNonZero = (manifold, offset) => {
  if (isNonZeroVector3(offset)) {
    return manifold.translate(offset)
  }
  return manifold
}
