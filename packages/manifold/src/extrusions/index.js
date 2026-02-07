/**
 * Extrusion operations - convert 2D shapes to 3D.
 *
 * Uses Manifold's native extrusion where possible.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used for future reference
import { getModule } from '../init.js'
import { ManifoldGeom3, toManifold } from '../geometries/ManifoldGeom3.js'
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- toCrossSection may be used later
import { ManifoldGeom2, isManifoldGeom2, toCrossSection, toJscadGeom2 } from '../geometries/ManifoldGeom2.js'
import { geom2ToCrossSection, geom3ToManifold } from '../conversions/index.js'
import * as jscadModule from '@jscad/modeling-for-manifold'

// Handle both ESM default export (Node.js) and bundled named exports (vitest/bundler)
const jscad = jscadModule.default || jscadModule

const jscadExtrusions = jscad.extrusions

/**
 * Check if a geometry has JSCAD as source (for ManifoldGeom2).
 */
const hasJscadSource = (geom) => isManifoldGeom2(geom) && geom.hasJscadSource

/**
 * Linear extrusion - extrude a 2D shape along the Z axis.
 *
 * @param {Object} options - Options
 * @param {number} [options.height=1] - Extrusion height
 * @param {number} [options.twistAngle=0] - Twist angle in radians (total rotation over height)
 * @param {number} [options.twistSteps=1] - Number of steps for twist
 * @param {Array} [options.scale=[1,1]] - Scale factor at top (or scale per step)
 * @param {...Object} geometries - 2D geometries to extrude
 * @returns {Object|Array} Extruded 3D geometry/geometries
 */
export const extrudeLinear = (options, ...geometries) => {
  const defaults = { height: 1, twistAngle: 0, twistSteps: 1, scale: [1, 1] }
  const { height, twistAngle, twistSteps, scale } = { ...defaults, ...options }

  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    // If the geometry has JSCAD as source, use JSCAD extrusion to avoid conversion issues
    if (hasJscadSource(geom) || (!isManifoldGeom2(geom) && (geom.sides || geom.outlines))) {
      const geom2 = toJscadGeom2(geom)
      const extruded = jscadExtrusions.extrudeLinear(options, geom2)
      return new ManifoldGeom3(geom3ToManifold(extruded))
    }

    // Use Manifold's native extrusion for CrossSection-sourced geometries
    const section = isManifoldGeom2(geom) ? geom.crossSection : geom2ToCrossSection(geom)

    // Convert twist angle from radians to degrees
    const twistDegrees = twistAngle * (180 / Math.PI)

    // Manifold extrude signature: extrude(height, nDivisions=0, twistDegrees=0, scaleTop=[1,1], center=false)
    const scaleTop = Array.isArray(scale) ? scale : [scale, scale]
    const nDivisions = twistAngle !== 0 ? twistSteps : 0

    const extruded = section.extrude(height, nDivisions, twistDegrees, scaleTop, false)

    return new ManifoldGeom3(extruded)
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Rotational extrusion - revolve a 2D shape around the Z axis.
 *
 * Uses Manifold's native revolve() which rotates around Y-axis and outputs
 * with Z as the revolution axis - matching JSCAD's convention.
 *
 * @param {Object} options - Options
 * @param {number} [options.angle=2*PI] - Angle of revolution in radians
 * @param {number} [options.startAngle=0] - Starting angle in radians
 * @param {number} [options.segments=32] - Number of segments
 * @param {...Object} geometries - 2D geometries to revolve
 * @returns {Object|Array} Revolved 3D geometry/geometries
 */
export const extrudeRotate = (options, ...geometries) => {
  const TAU = Math.PI * 2
  const defaults = { angle: TAU, startAngle: 0, segments: 32 }
  const { angle, startAngle, segments } = { ...defaults, ...options }

  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    // If geometry has JSCAD source with complex structure, use JSCAD fallback
    if (hasJscadSource(geom)) {
      const geom2 = toJscadGeom2(geom)
      const extruded = jscadExtrusions.extrudeRotate(options, geom2)
      return new ManifoldGeom3(geom3ToManifold(extruded))
    }

    // Use Manifold's native revolve
    let section = isManifoldGeom2(geom) ? geom.crossSection : geom2ToCrossSection(geom)

    // Manifold's revolve() requires X > 0 (rotates around Y-axis, only uses positive X side)
    // If profile is entirely on negative X side, mirror it first
    const bounds = section.bounds()
    if (bounds.max[0] <= 0) {
      // Mirror across Y-axis (negate X values) to make X positive
      section = section.mirror([1, 0])
    }

    // Convert angle from radians to degrees
    const angleDegrees = angle * (180 / Math.PI)

    // Manifold.revolve(circularSegments, revolveDegrees)
    let revolved = section.revolve(segments, angleDegrees)

    // Handle startAngle by rotating the result around Z-axis
    if (startAngle !== 0) {
      const startDegrees = startAngle * (180 / Math.PI)
      revolved = revolved.rotate([0, 0, startDegrees])
    }

    return new ManifoldGeom3(revolved)
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Helical extrusion - extrude along a helix path.
 *
 * @param {Object} options - Options
 * @param {number} [options.height=1] - Total height
 * @param {number} [options.turns=1] - Number of turns
 * @param {number} [options.startAngle=0] - Starting angle
 * @param {number} [options.segments=32] - Segments per turn
 * @param {...Object} geometries - 2D geometries to extrude
 * @returns {Object|Array} Extruded 3D geometry/geometries
 */
export const extrudeHelical = (options, ...geometries) => {
  // Use JSCAD fallback - helical extrusion is complex
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    // Convert to JSCAD geom2 using the dual-port helper
    const geom2 = toJscadGeom2(geom)

    const extruded = jscadExtrusions.extrudeHelical(options, geom2)
    return new ManifoldGeom3(geom3ToManifold(extruded))
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Extrude from slices - create geometry from a series of 2D slices.
 *
 * @param {Object} options - Options
 * @param {number} [options.numberOfSlices] - Number of slices
 * @param {Function} [options.callback] - Function to generate each slice
 * @param {...Object} geometries - Base 2D geometries
 * @returns {Object|Array} Extruded 3D geometry/geometries
 */
export const extrudeFromSlices = (options, ...geometries) => {
  // Use JSCAD fallback - this is complex
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    // Convert to JSCAD geom2 using the dual-port helper
    const geom2 = toJscadGeom2(geom)

    const extruded = jscadExtrusions.extrudeFromSlices(options, geom2)
    return new ManifoldGeom3(geom3ToManifold(extruded))
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Project a 3D geometry to 2D (XY plane projection).
 *
 * @param {Object} options - Options
 * @param {string} [options.axis='z'] - Axis to project along
 * @param {...Object} geometries - 3D geometries to project
 * @returns {Object|Array} Projected 2D geometry/geometries
 */
export const project = (options, ...geometries) => {
  const { axis = 'z' } = options || {}
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  const results = geoms.map(geom => {
    const manifold = toManifold(geom)

    // Manifold.project() projects to XY plane
    // If different axis, rotate first
    let toProject = manifold
    if (axis === 'x') {
      toProject = manifold.rotate([0, 90, 0]) // Rotate to put X as Z
    } else if (axis === 'y') {
      toProject = manifold.rotate([90, 0, 0]) // Rotate to put Y as Z
    }

    const projected = toProject.project()
    return new ManifoldGeom2(projected)
  })

  return results.length === 1 ? results[0] : results
}

/**
 * Slice module - re-export from JSCAD for extrudeFromSlices support.
 *
 * Slices are 2D shapes that can be positioned in 3D space and
 * used with extrudeFromSlices.
 */
export const slice = jscadExtrusions.slice

export default {
  extrudeLinear,
  extrudeRotate,
  extrudeHelical,
  extrudeFromSlices,
  project,
  slice
}
