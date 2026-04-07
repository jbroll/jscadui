/**
 * Manifold-native transform operations.
 *
 * Transforms are applied directly to Manifold objects for efficiency.
 */

import { ManifoldGeom3, isManifoldGeom3, toManifold } from '../geometries/ManifoldGeom3.js'
import { ManifoldGeom2, isManifoldGeom2, toCrossSection } from '../geometries/ManifoldGeom2.js'
import { geom3ToManifold, manifoldToGeom3 } from '../conversions/index.js'
import * as jscadModule from '@jscad/modeling-for-manifold'

// Handle both ESM default export (Node.js) and bundled named exports (vitest/bundler)
const jscad = jscadModule.default || jscadModule

const jscadTransforms = jscad.transforms

// ============================================================================
// Core Transforms
// ============================================================================

/**
 * Translate geometry by offset.
 *
 * @param {Array} offset - Translation vector [x, y, z] or [x, y]
 * @param {...Object} geometries - Geometries to translate
 * @returns {Object|Array} Translated geometry/geometries
 */
export const translate = (offset, ...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    // path2 objects (arc, line) have 'points' property - use JSCAD transform
    if (geom.points !== undefined && geom.sides === undefined) {
      return jscadTransforms.translate(offset, geom)
    }
    if (isManifoldGeom2(geom) || (geom.sides !== undefined)) {
      const section = toCrossSection(geom)
      const translated = section.translate([offset[0] || 0, offset[1] || 0])
      const result = new ManifoldGeom2(translated)
      // Preserve color
      if (isManifoldGeom2(geom) && geom.color) result.color = geom.color
      return result
    } else {
      const manifold = toManifold(geom)
      if (manifold == null) return null
      const translated = manifold.translate([offset[0] || 0, offset[1] || 0, offset[2] || 0])
      const result = new ManifoldGeom3(translated)
      // Preserve color
      if (isManifoldGeom3(geom) && geom.color) {
        result.color = geom.color
      }
      return result
    }
  }).filter(r => r != null)

  return results.length === 1 ? results[0] : results
}

/**
 * Translate along X axis.
 *
 * @param {number} offset - X offset
 * @param {...Object} geometries - Geometries to translate
 * @returns {Object|Array} Translated geometry/geometries
 */
export const translateX = (offset, ...geometries) => translate([offset, 0, 0], ...geometries)

/**
 * Translate along Y axis.
 *
 * @param {number} offset - Y offset
 * @param {...Object} geometries - Geometries to translate
 * @returns {Object|Array} Translated geometry/geometries
 */
export const translateY = (offset, ...geometries) => translate([0, offset, 0], ...geometries)

/**
 * Translate along Z axis.
 *
 * @param {number} offset - Z offset
 * @param {...Object} geometries - Geometries to translate
 * @returns {Object|Array} Translated geometry/geometries
 */
export const translateZ = (offset, ...geometries) => translate([0, 0, offset], ...geometries)

/**
 * Rotate geometry by angles (in radians).
 *
 * @param {Array} angles - Rotation angles [rx, ry, rz] or [rz] for 2D
 * @param {...Object} geometries - Geometries to rotate
 * @returns {Object|Array} Rotated geometry/geometries
 */
export const rotate = (angles, ...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  // Convert angles to degrees for Manifold
  const toDeg = (rad) => rad * (180 / Math.PI)

  const results = geoms.map(geom => {
    // path2 objects (arc, line) have 'points' property - use JSCAD transform
    if (geom.points !== undefined && geom.sides === undefined) {
      return jscadTransforms.rotate(angles, geom)
    }
    if (isManifoldGeom2(geom) || (geom.sides !== undefined)) {
      const section = toCrossSection(geom)
      let rotated
      if (Array.isArray(angles)) {
        const rx = angles[0] || 0
        const ry = angles[1] || 0
        const rz = angles[2] || 0
        if (rx === 0 && ry === 0) {
          // Pure Z rotation
          rotated = section.rotate(toDeg(rz))
        } else {
          // 3D rotation projected to 2D plane (M = Rx * Ry * Rz applied to z=0 points)
          // x' = cos(ry)*cos(rz)*x + (sin(rx)*sin(ry)*cos(rz) - cos(rx)*sin(rz))*y
          // y' = cos(ry)*sin(rz)*x + (sin(rx)*sin(ry)*sin(rz) + cos(rx)*cos(rz))*y
          const cos_rx = Math.cos(rx), sin_rx = Math.sin(rx)
          const cos_ry = Math.cos(ry), sin_ry = Math.sin(ry)
          const cos_rz = Math.cos(rz), sin_rz = Math.sin(rz)
          const m00 = cos_ry * cos_rz
          const m01 = sin_rx * sin_ry * cos_rz - cos_rx * sin_rz
          const m10 = cos_ry * sin_rz
          const m11 = sin_rx * sin_ry * sin_rz + cos_rx * cos_rz
          // CrossSection.transform() takes column-major 3x3: [m00, m10, 0, m01, m11, 0, tx, ty, 1]
          rotated = section.transform([m00, m10, 0, m01, m11, 0, 0, 0, 1])
        }
      } else {
        // Scalar angle - Z rotation (in radians)
        rotated = section.rotate(toDeg(angles))
      }
      const result = new ManifoldGeom2(rotated)
      // Preserve color
      if (isManifoldGeom2(geom) && geom.color) result.color = geom.color
      return result
    } else {
      const manifold = toManifold(geom)
      if (manifold == null) return null
      // Apply rotations in X, Y, Z order (Euler angles)
      const rx = toDeg(angles[0] || 0)
      const ry = toDeg(angles[1] || 0)
      const rz = toDeg(angles[2] || 0)
      const rotated = manifold.rotate([rx, ry, rz])
      const result = new ManifoldGeom3(rotated)
      // Preserve color
      if (isManifoldGeom3(geom) && geom.color) {
        result.color = geom.color
      }
      return result
    }
  }).filter(r => r != null)

  return results.length === 1 ? results[0] : results
}

/**
 * Rotate around X axis.
 *
 * @param {number} angle - Rotation angle in radians
 * @param {...Object} geometries - Geometries to rotate
 * @returns {Object|Array} Rotated geometry/geometries
 */
export const rotateX = (angle, ...geometries) => rotate([angle, 0, 0], ...geometries)

/**
 * Rotate around Y axis.
 *
 * @param {number} angle - Rotation angle in radians
 * @param {...Object} geometries - Geometries to rotate
 * @returns {Object|Array} Rotated geometry/geometries
 */
export const rotateY = (angle, ...geometries) => rotate([0, angle, 0], ...geometries)

/**
 * Rotate around Z axis.
 *
 * @param {number} angle - Rotation angle in radians
 * @param {...Object} geometries - Geometries to rotate
 * @returns {Object|Array} Rotated geometry/geometries
 */
export const rotateZ = (angle, ...geometries) => rotate([0, 0, angle], ...geometries)

/**
 * Scale geometry by factors.
 *
 * @param {Array|number} factors - Scale factors [sx, sy, sz] or uniform factor
 * @param {...Object} geometries - Geometries to scale
 * @returns {Object|Array} Scaled geometry/geometries
 */
export const scale = (factors, ...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)
  const f = Array.isArray(factors) ? factors : [factors, factors, factors]

  const results = geoms.map(geom => {
    // path2 objects (arc, line) have 'points' property - use JSCAD transform
    if (geom.points !== undefined && geom.sides === undefined) {
      return jscadTransforms.scale(factors, geom)
    }
    if (isManifoldGeom2(geom) || (geom.sides !== undefined)) {
      const section = toCrossSection(geom)
      const scaled = section.scale([f[0] || 1, f[1] || 1])
      const result = new ManifoldGeom2(scaled)
      // Preserve color
      if (isManifoldGeom2(geom) && geom.color) result.color = geom.color
      return result
    } else {
      const manifold = toManifold(geom)
      if (manifold == null) return null
      const scaled = manifold.scale([f[0] || 1, f[1] || 1, f[2] || 1])
      const result = new ManifoldGeom3(scaled)
      // Preserve color
      if (isManifoldGeom3(geom) && geom.color) result.color = geom.color
      return result
    }
  }).filter(r => r != null)

  return results.length === 1 ? results[0] : results
}

/**
 * Scale along X axis.
 *
 * @param {number} factor - Scale factor
 * @param {...Object} geometries - Geometries to scale
 * @returns {Object|Array} Scaled geometry/geometries
 */
export const scaleX = (factor, ...geometries) => scale([factor, 1, 1], ...geometries)

/**
 * Scale along Y axis.
 *
 * @param {number} factor - Scale factor
 * @param {...Object} geometries - Geometries to scale
 * @returns {Object|Array} Scaled geometry/geometries
 */
export const scaleY = (factor, ...geometries) => scale([1, factor, 1], ...geometries)

/**
 * Scale along Z axis.
 *
 * @param {number} factor - Scale factor
 * @param {...Object} geometries - Geometries to scale
 * @returns {Object|Array} Scaled geometry/geometries
 */
export const scaleZ = (factor, ...geometries) => scale([1, 1, factor], ...geometries)

/**
 * Mirror geometry across a plane.
 *
 * @param {Object} options - Mirror options
 * @param {Array} [options.origin=[0,0,0]] - Point on mirror plane
 * @param {Array} [options.normal=[0,0,1]] - Normal to mirror plane
 * @param {...Object} geometries - Geometries to mirror
 * @returns {Object|Array} Mirrored geometry/geometries
 */
export const mirror = (options, ...geometries) => {
  const { origin = [0, 0, 0], normal = [0, 0, 1] } = options
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    // path2 objects (arc, line) have 'points' property - use JSCAD transform
    if (geom.points !== undefined && geom.sides === undefined) {
      return jscadTransforms.mirror(options, geom)
    }
    if (isManifoldGeom2(geom) || (geom.sides !== undefined)) {
      const section = toCrossSection(geom)
      // For 2D, mirror across line defined by normal (use x, y components)
      const nx = normal[0] || 0
      const ny = normal[1] || 0
      const mirrored = section.mirror([nx, ny])
      const result = new ManifoldGeom2(mirrored)
      // Preserve color
      if (isManifoldGeom2(geom) && geom.color) result.color = geom.color
      return result
    } else {
      const manifold = toManifold(geom)
      if (manifold == null) return null
      // Manifold mirror takes a normal vector
      let mirrored
      // If origin is not [0,0,0], we need to translate first, mirror, then translate back
      if (origin[0] !== 0 || origin[1] !== 0 || origin[2] !== 0) {
        const translated = manifold.translate([-origin[0], -origin[1], -origin[2]])
        const mirroredT = translated.mirror(normal)
        mirrored = mirroredT.translate(origin)
      } else {
        mirrored = manifold.mirror(normal)
      }
      const result = new ManifoldGeom3(mirrored)
      // Preserve color
      if (isManifoldGeom3(geom) && geom.color) result.color = geom.color
      return result
    }
  }).filter(r => r != null)

  return results.length === 1 ? results[0] : results
}

/**
 * Mirror across X axis (YZ plane).
 *
 * @param {...Object} geometries - Geometries to mirror
 * @returns {Object|Array} Mirrored geometry/geometries
 */
export const mirrorX = (...geometries) => mirror({ normal: [1, 0, 0] }, ...geometries)

/**
 * Mirror across Y axis (XZ plane).
 *
 * @param {...Object} geometries - Geometries to mirror
 * @returns {Object|Array} Mirrored geometry/geometries
 */
export const mirrorY = (...geometries) => mirror({ normal: [0, 1, 0] }, ...geometries)

/**
 * Mirror across Z axis (XY plane).
 *
 * @param {...Object} geometries - Geometries to mirror
 * @returns {Object|Array} Mirrored geometry/geometries
 */
export const mirrorZ = (...geometries) => mirror({ normal: [0, 0, 1] }, ...geometries)

/**
 * Apply a 4x4 transformation matrix.
 *
 * @param {Array} matrix - 4x4 transformation matrix (column-major)
 * @param {...Object} geometries - Geometries to transform
 * @returns {Object|Array} Transformed geometry/geometries
 */
export const transform = (matrix, ...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    // path2 objects (arc, line) have 'points' property - use JSCAD transform
    if (geom.points !== undefined && geom.sides === undefined) {
      return jscadTransforms.transform(matrix, geom)
    }
    if (isManifoldGeom2(geom) || (geom.sides !== undefined)) {
      const section = toCrossSection(geom)
      // For 2D, extract 3x3 affine transform from 4x4 matrix
      // Input 4x4 column-major: [m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, tx, ty, tz, 1]
      // Output Mat3 column-major for CrossSection.transform():
      // [m00, m10, 0, m01, m11, 0, tx, ty, 1]
      const mat3 = [
        matrix[0] ?? 1, matrix[1] ?? 0, 0,    // column 0: x basis
        matrix[4] ?? 0, matrix[5] ?? 1, 0,    // column 1: y basis
        matrix[12] ?? 0, matrix[13] ?? 0, 1   // column 2: translation
      ]
      const transformed = section.transform(mat3)
      const result = new ManifoldGeom2(transformed)
      // Preserve color
      if (isManifoldGeom2(geom) && geom.color) result.color = geom.color
      return result
    } else {
      const manifold = toManifold(geom)
      if (manifold == null) return null
      // Manifold expects a full 16-element column-major matrix
      // Our input is already in this format: [m00, m10, m20, m30, m01, m11, m21, m31, ...]
      // Just ensure we have all 16 elements (fill with identity if shorter)
      const mat16 = matrix.length >= 16 ? matrix : [
        matrix[0] ?? 1, matrix[1] ?? 0, matrix[2] ?? 0, matrix[3] ?? 0,
        matrix[4] ?? 0, matrix[5] ?? 1, matrix[6] ?? 0, matrix[7] ?? 0,
        matrix[8] ?? 0, matrix[9] ?? 0, matrix[10] ?? 1, matrix[11] ?? 0,
        matrix[12] ?? 0, matrix[13] ?? 0, matrix[14] ?? 0, matrix[15] ?? 1
      ]
      const transformed = manifold.transform(mat16)
      const result = new ManifoldGeom3(transformed)
      // Preserve color
      if (isManifoldGeom3(geom) && geom.color) result.color = geom.color
      return result
    }
  }).filter(r => r != null)

  return results.length === 1 ? results[0] : results
}

// ============================================================================
// Higher-level Transforms (use JSCAD fallback)
// ============================================================================

/**
 * Center geometry at origin using native Manifold bounding box when possible.
 *
 * @param {Object} options - Options
 * @param {Array} [options.axes=[true,true,true]] - Which axes to center
 * @param {Array} [options.relativeTo=[0,0,0]] - Point to center relative to
 * @param {...Object} geometries - Geometries to center
 * @returns {Object|Array} Centered geometry/geometries
 */
export const center = (options, ...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)
  if (geoms.length === 0) return []

  const axes = options?.axes ?? [true, true, true]
  const relativeTo = options?.relativeTo ?? [0, 0, 0]

  // Fast path: all ManifoldGeom3 objects - use native bbox
  const allManifold = geoms.every(g => isManifoldGeom3(g))
  if (allManifold) {
    const results = geoms.map(g => {
      const [[minX, minY, minZ], [maxX, maxY, maxZ]] = g.boundingBox()
      const offset = [
        axes[0] ? relativeTo[0] - (minX + maxX) / 2 : 0,
        axes[1] ? relativeTo[1] - (minY + maxY) / 2 : 0,
        axes[2] ? relativeTo[2] - (minZ + maxZ) / 2 : 0
      ]
      const result = new ManifoldGeom3(g.manifold.translate(offset))
      if (g.color) result.color = g.color
      return result
    })
    return results.length === 1 ? results[0] : results
  }

  // Slow path: mixed geometries - use JSCAD's implementation
  const path2Indices = []
  const jscadGeoms = geoms.map((g, i) => {
    if (g.points !== undefined && g.sides === undefined) {
      path2Indices.push(i)
      return g  // path2 - pass through as-is
    }
    return isManifoldGeom3(g) ? manifoldToGeom3(g.manifold) : g
  })

  const centered = jscadTransforms.center(options, ...jscadGeoms)
  const centeredArray = Array.isArray(centered) ? centered : [centered]
  const results = centeredArray.map((g, i) => {
    if (path2Indices.includes(i)) return g
    const result = new ManifoldGeom3(geom3ToManifold(g))
    if (isManifoldGeom3(geoms[i]) && geoms[i].color) result.color = geoms[i].color
    return result
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Center along X axis.
 *
 * @param {...Object} geometries - Geometries to center
 * @returns {Object|Array} Centered geometry/geometries
 */
export const centerX = (...geometries) => center({ axes: [true, false, false] }, ...geometries)

/**
 * Center along Y axis.
 *
 * @param {...Object} geometries - Geometries to center
 * @returns {Object|Array} Centered geometry/geometries
 */
export const centerY = (...geometries) => center({ axes: [false, true, false] }, ...geometries)

/**
 * Center along Z axis.
 *
 * @param {...Object} geometries - Geometries to center
 * @returns {Object|Array} Centered geometry/geometries
 */
export const centerZ = (...geometries) => center({ axes: [false, false, true] }, ...geometries)

/**
 * Align geometries relative to each other using native Manifold bounding box when possible.
 *
 * @param {Object} options - Alignment options
 * @param {Array} [options.modes=['center','center','min']] - Alignment mode per axis: 'center', 'min', 'max', 'none'
 * @param {Array} [options.relativeTo=null] - Reference point [x,y,z] or null for group bounds
 * @param {boolean} [options.grouped=false] - If true, align group as unit; if false, align each individually
 * @param {...Object} geometries - Geometries to align
 * @returns {Object|Array} Aligned geometry/geometries
 */
export const align = (options, ...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)
  if (geoms.length === 0) return []

  const modes = options?.modes ?? ['center', 'center', 'min']
  const relativeTo = options?.relativeTo ?? null

  // Fast path: all ManifoldGeom3 objects with individual alignment - use native bbox
  // Note: grouped=true falls through to JSCAD for correct group-as-unit alignment
  const allManifold = geoms.every(g => isManifoldGeom3(g)) && !options?.grouped
  if (allManifold) {
    // Calculate reference bounds (either from relativeTo or from group bounds)
    let refBounds
    if (relativeTo) {
      refBounds = [[relativeTo[0], relativeTo[1], relativeTo[2]], [relativeTo[0], relativeTo[1], relativeTo[2]]]
    } else {
      // Calculate combined bounds of all geometries
      const allBounds = geoms.map(g => g.boundingBox())
      refBounds = [
        [Math.min(...allBounds.map(b => b[0][0])), Math.min(...allBounds.map(b => b[0][1])), Math.min(...allBounds.map(b => b[0][2]))],
        [Math.max(...allBounds.map(b => b[1][0])), Math.max(...allBounds.map(b => b[1][1])), Math.max(...allBounds.map(b => b[1][2]))]
      ]
    }

    const getTarget = (mode, axis) => {
      if (mode === 'none') return null
      if (mode === 'min') return refBounds[0][axis]
      if (mode === 'max') return refBounds[1][axis]
      return (refBounds[0][axis] + refBounds[1][axis]) / 2 // center
    }

    const results = geoms.map(g => {
      const [[minX, minY, minZ], [maxX, maxY, maxZ]] = g.boundingBox()
      const bounds = [[minX, minY, minZ], [maxX, maxY, maxZ]]
      const offset = [0, 0, 0]

      for (let axis = 0; axis < 3; axis++) {
        const mode = modes[axis] ?? 'none'
        const target = getTarget(mode, axis)
        if (target === null) continue

        if (mode === 'min') offset[axis] = target - bounds[0][axis]
        else if (mode === 'max') offset[axis] = target - bounds[1][axis]
        else offset[axis] = target - (bounds[0][axis] + bounds[1][axis]) / 2 // center
      }

      const result = new ManifoldGeom3(g.manifold.translate(offset))
      if (g.color) result.color = g.color
      return result
    })
    return results.length === 1 ? results[0] : results
  }

  // Slow path: mixed geometries - use JSCAD's implementation
  const path2Indices = []
  const jscadGeoms = geoms.map((g, i) => {
    if (g.points !== undefined && g.sides === undefined) {
      path2Indices.push(i)
      return g  // path2 - pass through as-is
    }
    return isManifoldGeom3(g) ? manifoldToGeom3(g.manifold) : g
  })

  const aligned = jscadTransforms.align(options, ...jscadGeoms)
  const alignedArray = Array.isArray(aligned) ? aligned : [aligned]
  const results = alignedArray.map((g, i) => {
    if (path2Indices.includes(i)) return g
    const result = new ManifoldGeom3(geom3ToManifold(g))
    if (isManifoldGeom3(geoms[i]) && geoms[i].color) result.color = geoms[i].color
    return result
  })

  return results.length === 1 ? results[0] : results
}

export default {
  translate,
  translateX,
  translateY,
  translateZ,
  rotate,
  rotateX,
  rotateY,
  rotateZ,
  scale,
  scaleX,
  scaleY,
  scaleZ,
  mirror,
  mirrorX,
  mirrorY,
  mirrorZ,
  transform,
  center,
  centerX,
  centerY,
  centerZ,
  align
}
