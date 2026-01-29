/**
 * Measurement operations.
 *
 * Uses Manifold's native measurements where available, JSCAD fallback otherwise.
 */

import { isManifoldGeom3, toManifold } from '../geometries/ManifoldGeom3.js'
import { isManifoldGeom2 } from '../geometries/ManifoldGeom2.js'
import { manifoldToGeom3, geom2ToCrossSection } from '../conversions/index.js'
import * as jscad from '@jscad/modeling-core'

const jscadMeasurements = jscad.measurements

/**
 * Calculate the bounding box of geometries.
 *
 * @param {...Object} geometries - Geometries to measure
 * @returns {Array} Bounding box [[minX, minY, minZ], [maxX, maxY, maxZ]]
 */
export const measureBoundingBox = (...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  if (geoms.length === 0) {
    return [[0, 0, 0], [0, 0, 0]]
  }

  // Handle single geometry with Manifold native method
  if (geoms.length === 1) {
    const geom = geoms[0]
    if (isManifoldGeom3(geom)) {
      return geom.boundingBox()
    }
    if (isManifoldGeom2(geom)) {
      const bbox2 = geom.boundingBox()
      return [[bbox2[0][0], bbox2[0][1], 0], [bbox2[1][0], bbox2[1][1], 0]]
    }
  }

  // Use JSCAD for multiple geometries
  const jscadGeoms = geoms.map(g => {
    if (isManifoldGeom3(g)) return manifoldToGeom3(g.manifold)
    return g
  })

  return jscadMeasurements.measureBoundingBox(...jscadGeoms)
}

/**
 * Calculate the volume of 3D geometries.
 *
 * @param {...Object} geometries - 3D geometries to measure
 * @returns {number|Array} Volume(s)
 */
export const measureVolume = (...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    if (isManifoldGeom3(geom)) {
      return geom.volume()
    }
    // Convert and measure
    const manifold = toManifold(geom)
    return manifold.volume()
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Calculate the surface area of 3D geometries.
 *
 * @param {...Object} geometries - 3D geometries to measure
 * @returns {number|Array} Surface area(s)
 */
export const measureArea = (...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    if (isManifoldGeom3(geom)) {
      return geom.surfaceArea()
    }
    if (isManifoldGeom2(geom)) {
      return geom.area()
    }
    // Convert and measure
    if (geom.polygons !== undefined) {
      const manifold = toManifold(geom)
      return manifold.surfaceArea()
    }
    // 2D geometry
    const section = geom2ToCrossSection(geom)
    return section.area()
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Calculate the center of a bounding box.
 *
 * @param {...Object} geometries - Geometries to measure
 * @returns {Array} Center point [x, y, z]
 */
export const measureCenter = (...geometries) => {
  const bbox = measureBoundingBox(...geometries)
  return [
    (bbox[0][0] + bbox[1][0]) / 2,
    (bbox[0][1] + bbox[1][1]) / 2,
    (bbox[0][2] + bbox[1][2]) / 2
  ]
}

/**
 * Calculate dimensions of bounding box.
 *
 * @param {...Object} geometries - Geometries to measure
 * @returns {Array} Dimensions [width, depth, height]
 */
export const measureDimensions = (...geometries) => {
  const bbox = measureBoundingBox(...geometries)
  return [
    bbox[1][0] - bbox[0][0],
    bbox[1][1] - bbox[0][1],
    bbox[1][2] - bbox[0][2]
  ]
}

/**
 * Check if a geometry is empty.
 *
 * @param {Object} geometry - Geometry to check
 * @returns {boolean} True if empty
 */
export const measureIsEmpty = (geometry) => {
  if (isManifoldGeom3(geometry)) {
    return geometry.isEmpty()
  }
  if (isManifoldGeom2(geometry)) {
    return geometry.isEmpty()
  }
  // Check polygon count
  if (geometry.polygons !== undefined) {
    return geometry.polygons.length === 0
  }
  if (geometry.sides !== undefined) {
    return geometry.sides.length === 0
  }
  return true
}

/**
 * Calculate aggregate bounding box of multiple geometries.
 *
 * @param {...Object} geometries - Geometries to measure
 * @returns {Array} Combined bounding box
 */
export const measureAggregateBoundingBox = (...geometries) => {
  // Same as measureBoundingBox for combined result
  return measureBoundingBox(...geometries)
}

// Re-export additional JSCAD measurements
export const measureBoundingSphere = (...args) => {
  return jscadMeasurements.measureBoundingSphere(...args)
}

export const measureEpsilon = (...args) => {
  return jscadMeasurements.measureEpsilon(...args)
}

export default {
  measureBoundingBox,
  measureVolume,
  measureArea,
  measureCenter,
  measureDimensions,
  measureIsEmpty,
  measureAggregateBoundingBox,
  measureBoundingSphere,
  measureEpsilon
}
