/**
 * Modifier operations - expand, offset, shell, etc.
 *
 * Manifold has native offset for CrossSection, falls back to JSCAD for 3D.
 */

import { ManifoldGeom3, isManifoldGeom3, toManifold } from '../geometries/ManifoldGeom3.js'
import { ManifoldGeom2, isManifoldGeom2, toCrossSection, toJscadGeom2, fromJscadGeom2 } from '../geometries/ManifoldGeom2.js'
import { geom3ToManifold, manifoldToGeom3 } from '../conversions/index.js'
import * as jscad from '@jscad/modeling-core'

const jscadModifiers = jscad.modifiers
const jscadExpansions = jscad.expansions

/**
 * Check if a geometry has JSCAD as source (for ManifoldGeom2).
 */
const hasJscadSource = (geom) => isManifoldGeom2(geom) && geom.hasJscadSource

/**
 * Offset a 2D geometry (expand/shrink outline).
 *
 * @param {Object} options - Options
 * @param {number} [options.delta=1] - Offset distance (positive=expand, negative=shrink)
 * @param {string} [options.corners='round'] - Corner style: 'round', 'edge', 'chamfer'
 * @param {number} [options.segments=16] - Segments for round corners
 * @param {...Object} geometries - 2D geometries to offset
 * @returns {Object|Array} Offset geometry/geometries
 */
export const offset = (options, ...geometries) => {
  const defaults = { delta: 1, corners: 'round', segments: 16 }
  const { delta, corners, segments } = { ...defaults, ...options }

  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    // If JSCAD source, use JSCAD expand (which handles offset) to avoid conversion issues
    if (hasJscadSource(geom)) {
      const jscadGeom = toJscadGeom2(geom)
      const expanded = jscadExpansions.offset({ delta, corners, segments }, jscadGeom)
      return fromJscadGeom2(expanded)
    }

    // Use Manifold's native offset
    const section = isManifoldGeom2(geom) ? geom.crossSection : toCrossSection(geom)

    // Manifold offset takes delta, joinType (0=square, 1=round, 2=miter), miterLimit, circularSegments
    let joinType = 1 // round
    if (corners === 'edge' || corners === 'square') joinType = 0
    else if (corners === 'chamfer' || corners === 'miter') joinType = 2

    const offsetted = section.offset(delta, joinType, 2.0, segments)
    return new ManifoldGeom2(offsetted)
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Expand a geometry (offset surfaces/edges outward).
 * Supports path2 (lines), geom2 (2D shapes), and geom3 (3D shapes).
 *
 * @param {Object} options - Options
 * @param {number} [options.delta=1] - Expansion distance
 * @param {string} [options.corners='edge'] - Corner style: 'edge', 'chamfer', 'round'
 * @param {number} [options.segments=16] - Segments for rounding
 * @param {...Object} geometries - Geometries to expand
 * @returns {Object|Array} Expanded geometry/geometries
 */
export const expand = (options, ...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    // Check if it's a ManifoldGeom3 - convert and expand as 3D
    if (isManifoldGeom3(geom)) {
      const jscadGeom = manifoldToGeom3(geom.manifold)
      const expanded = jscadExpansions.expand(options, jscadGeom)
      return new ManifoldGeom3(geom3ToManifold(expanded))
    }

    // Check if it's a ManifoldGeom2
    if (isManifoldGeom2(geom)) {
      // If JSCAD source, use JSCAD expand to avoid conversion issues
      if (hasJscadSource(geom)) {
        const jscadGeom = toJscadGeom2(geom)
        const expanded = jscadExpansions.expand(options, jscadGeom)
        return fromJscadGeom2(expanded)
      }

      // Otherwise use native offset
      const defaults = { delta: 1, corners: 'edge', segments: 16 }
      const { delta, corners, segments } = { ...defaults, ...options }

      let joinType = 0 // edge/square
      if (corners === 'round') joinType = 1
      else if (corners === 'chamfer' || corners === 'miter') joinType = 2

      const offsetted = geom.crossSection.offset(delta, joinType, 2.0, segments)
      return new ManifoldGeom2(offsetted)
    }

    // For path2 (lines) and regular JSCAD geom2/geom3, use JSCAD's expand
    const expanded = jscadExpansions.expand(options, geom)

    // Wrap result appropriately
    if (expanded && expanded.polygons) {
      // It's a geom3
      return new ManifoldGeom3(geom3ToManifold(expanded))
    } else if (expanded && (expanded.sides || expanded.outlines)) {
      // It's a geom2 - wrap with JSCAD as source
      return fromJscadGeom2(expanded)
    }

    // Return as-is for unknown types
    return expanded
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Create a shell (hollow out) geometry.
 * Uses JSCAD fallback as Manifold has no native 3D offset.
 *
 * @param {Object} options - Options
 * @param {number} [options.thickness=1] - Shell thickness
 * @param {...Object} geometries - Geometries to shell
 * @returns {Object|Array} Shelled geometry/geometries
 */
export const shell = (options, ...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    // Manifold has no native 3D offset - must use JSCAD fallback
    const jscadGeom = isManifoldGeom3(geom) ? manifoldToGeom3(geom.manifold) : geom
    const shelled = jscadModifiers.shell(options, jscadGeom)

    // Try to convert back to Manifold, fall back to JSCAD geometry if it fails
    try {
      return new ManifoldGeom3(geom3ToManifold(shelled))
    } catch (_e) {
      // Shell can produce non-manifold geometry in some cases
      return shelled
    }
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Generalize/simplify a geometry.
 *
 * @param {Object} options - Options
 * @param {number} [options.snap=0.01] - Snap tolerance
 * @param {...Object} geometries - Geometries to generalize
 * @returns {Object|Array} Generalized geometry/geometries
 */
export const generalize = (options, ...geometries) => {
  // Use JSCAD fallback
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    const jscadGeom = isManifoldGeom3(geom) ? manifoldToGeom3(geom.manifold) : geom
    const generalized = jscadModifiers.generalize(options, jscadGeom)
    return new ManifoldGeom3(geom3ToManifold(generalized))
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Snap geometry vertices to a grid.
 *
 * @param {Object} options - Options
 * @param {number} [options.grid=0.01] - Grid spacing
 * @param {...Object} geometries - Geometries to snap
 * @returns {Object|Array} Snapped geometry/geometries
 */
export const snap = (options, ...geometries) => {
  // Use JSCAD fallback
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    const jscadGeom = isManifoldGeom3(geom) ? manifoldToGeom3(geom.manifold) : geom
    const snapped = jscadModifiers.snap(options, jscadGeom)
    return new ManifoldGeom3(geom3ToManifold(snapped))
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Retessellate a geometry.
 *
 * @param {...Object} geometries - Geometries to retessellate
 * @returns {Object|Array} Retessellated geometry/geometries
 */
export const retessellate = (...geometries) => {
  // Manifold automatically produces clean tessellation
  // Just pass through by converting to Manifold and back
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    const manifold = toManifold(geom)
    // The conversion process retessellates
    return new ManifoldGeom3(manifold)
  })

  return results.length === 1 ? results[0] : results
}

export default {
  offset,
  expand,
  shell,
  generalize,
  snap,
  retessellate
}
