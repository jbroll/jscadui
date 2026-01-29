/**
 * Bounds utilities for computing geometry bounding boxes
 * Ported from @jscad/regl-renderer with ES module syntax
 */

import * as vec3 from 'gl-vec3'

/**
 * Compute bounding box of positions array
 * Handles both flat arrays [x,y,z,x,y,z,...] and nested [[x,y,z],[x,y,z],...]
 *
 * @param {Array|Float32Array} positions - Vertex positions
 * @returns {Array} [[minX, minY, minZ], [maxX, maxY, maxZ]]
 */
export function boundingBox(positions) {
  if (!positions || positions.length === 0) {
    return [[0, 0, 0], [0, 0, 0]]
  }

  const nested = Array.isArray(positions) && Array.isArray(positions[0])
  const dimensions = nested ? positions[0].length : 3

  const min = new Array(dimensions)
  const max = new Array(dimensions)

  for (let i = 0; i < dimensions; i++) {
    min[i] = Infinity
    max[i] = -Infinity
  }

  if (nested) {
    for (const position of positions) {
      for (let i = 0; i < dimensions; i++) {
        const val = position[i]
        if (val > max[i]) max[i] = val
        if (val < min[i]) min[i] = val
      }
    }
  } else {
    for (let j = 0; j < positions.length; j += dimensions) {
      for (let i = 0; i < dimensions; i++) {
        const val = positions[j + i]
        if (val > max[i]) max[i] = val
        if (val < min[i]) min[i] = val
      }
    }
  }

  return [min, max]
}

/**
 * Compute combined bounds of multiple geometries
 * Returns bounding box, center point, diameter, and size
 *
 * @param {Array} geometries - Array of geometry objects with positions and optional transforms
 * @returns {Object} { min, max, center, size, dia }
 */
export function computeBounds(geometries) {
  if (!geometries || geometries.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      size: [0, 0, 0],
      dia: 0
    }
  }

  // Flatten if nested array
  const geoms = Array.isArray(geometries[0]) ? geometries.flat() : geometries

  let bbox = null

  for (const geometry of geoms) {
    if (!geometry || !geometry.positions) continue

    let gbbox = boundingBox(geometry.positions)

    // Apply transforms if present
    if (geometry.transforms) {
      gbbox = gbbox.map(bounds => {
        const out = vec3.create()
        vec3.transformMat4(out, bounds, geometry.transforms)
        return [...out]
      })
    }

    if (bbox) {
      vec3.min(bbox[0], bbox[0], gbbox[0])
      vec3.max(bbox[1], bbox[1], gbbox[1])
    } else {
      bbox = gbbox
    }
  }

  if (!bbox) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      size: [0, 0, 0],
      dia: 0
    }
  }

  const min = vec3.min(vec3.create(), bbox[1], bbox[0])
  const max = vec3.max(vec3.create(), bbox[1], bbox[0])
  const size = vec3.subtract(vec3.create(), max, min)

  let center = vec3.scale(vec3.create(), size, 0.5)
  center = vec3.add(center, min, center)

  // Approximate diameter (distance from center to corner)
  const dia = vec3.distance(center, max)

  return {
    min: [...min],
    max: [...max],
    center: [...center],
    size: [...size],
    dia
  }
}

/**
 * Compute bounds from entities (as returned by format converters)
 *
 * @param {Array} entities - Array of entity objects with geometry.positions
 * @returns {Object} { min, max, center, size, dia }
 */
export function computeEntityBounds(entities) {
  if (!entities || entities.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      size: [0, 0, 0],
      dia: 0
    }
  }

  const geometries = entities
    .filter(e => e && e.geometry)
    .map(e => ({
      positions: e.geometry.positions,
      transforms: e.geometry.transforms
    }))

  return computeBounds(geometries)
}

export default {
  boundingBox,
  computeBounds,
  computeEntityBounds
}
