/**
 * Hull operations - convex hull and hull chain.
 *
 * Uses Manifold's native hull for 3D, JSCAD fallback for complex cases.
 */

import { getManifold, getCrossSection } from '../init.js'
import { ManifoldGeom3, toManifold } from '../geometries/ManifoldGeom3.js'
import { ManifoldGeom2, isManifoldGeom2, toCrossSection } from '../geometries/ManifoldGeom2.js'

/**
 * Compute the convex hull of geometries.
 *
 * @param {...Object} geometries - Geometries to hull
 * @returns {Object} The convex hull geometry
 */
export const hull = (...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  if (geoms.length === 0) {
    throw new Error('hull requires at least one geometry')
  }

  // Check if 2D
  const is2D = isManifoldGeom2(geoms[0]) || (geoms[0].sides !== undefined)

  if (is2D) {
    return hull2D(geoms)
  }

  // For 3D, Manifold has a native hull operation
  const Manifold = getManifold()

  // Convert all to Manifold and combine into one for hulling
  const manifolds = geoms.map(g => toManifold(g))

  // Manifold.hull takes an array of manifolds
  const result = Manifold.hull(manifolds)

  return new ManifoldGeom3(result)
}

/**
 * Compute 2D convex hull using Manifold's native CrossSection.hull().
 *
 * @param {Array} geometries - 2D geometries to hull
 * @returns {ManifoldGeom2} The convex hull wrapped in ManifoldGeom2
 */
const hull2D = (geometries) => {
  const CrossSection = getCrossSection()

  // Convert all to CrossSection format
  const sections = geometries.map(g => {
    if (isManifoldGeom2(g)) return g.crossSection
    return toCrossSection(g)
  })

  // Use Manifold's native hull for CrossSections
  // CrossSection.hull() takes an array of CrossSections
  const result = CrossSection.hull(sections)

  return new ManifoldGeom2(result)
}

/**
 * Compute hull chain - hull of consecutive pairs.
 * For geometries [A, B, C, D], returns union(hull(A,B), hull(B,C), hull(C,D))
 *
 * @param {...Object} geometries - Geometries to chain hull
 * @returns {Object} The hull chain geometry
 */
export const hullChain = (...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  if (geoms.length < 2) {
    throw new Error('hullChain requires at least two geometries')
  }

  // Check if 2D
  const is2D = isManifoldGeom2(geoms[0]) || (geoms[0].sides !== undefined) || (geoms[0].outlines !== undefined)

  if (is2D) {
    // Use native CrossSection operations for 2D hullChain
    const CrossSection = getCrossSection()

    // Convert all to CrossSection format
    const sections = geoms.map(g => {
      if (isManifoldGeom2(g)) return g.crossSection
      return toCrossSection(g)
    })

    // Compute hull of each consecutive pair and union them
    const pairHulls = []
    for (let i = 0; i < sections.length - 1; i++) {
      pairHulls.push(CrossSection.hull([sections[i], sections[i + 1]]))
    }

    // Union all the pair hulls using CrossSection.union
    const result = CrossSection.union(pairHulls)
    return new ManifoldGeom2(result)
  }

  // For 3D, use native Manifold operations:
  // hullChain([A,B,C,D]) = union(hull(A,B), hull(B,C), hull(C,D))
  const Manifold = getManifold()

  // Convert all to Manifold
  const manifolds = geoms.map(g => toManifold(g))

  // Compute hull of each consecutive pair
  const pairHulls = []
  for (let i = 0; i < manifolds.length - 1; i++) {
    pairHulls.push(Manifold.hull([manifolds[i], manifolds[i + 1]]))
  }

  // Union all the pair hulls
  const result = Manifold.union(pairHulls)

  return new ManifoldGeom3(result)
}

export default {
  hull,
  hullChain
}
