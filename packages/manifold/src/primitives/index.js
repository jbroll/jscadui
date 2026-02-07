/**
 * Manifold-native primitives.
 *
 * These create shapes directly using Manifold's API for maximum performance.
 * API is compatible with @jscad/modeling-for-manifold primitives.
 */

import { getManifold, getCrossSection } from '../init.js'
import { ManifoldGeom3 } from '../geometries/ManifoldGeom3.js'
import { ManifoldGeom2 } from '../geometries/ManifoldGeom2.js'
import { geom3ToManifold, geom2ToCrossSection } from '../conversions/index.js'
import { TAU } from '../maths/index.js'
import { translateIfNonZero } from '../utils/index.js'
import * as jscadModule from '@jscad/modeling-for-manifold'

// Handle both ESM default export (Node.js) and bundled named exports (vitest/bundler)
const jscad = jscadModule.default || jscadModule

const jscadPrimitives = jscad.primitives

// ============================================================================
// 3D Primitives
// ============================================================================

/**
 * Create a cube (or cuboid).
 *
 * @param {Object} options - Options
 * @param {Array|number} [options.size=2] - Size as [x, y, z] or single value
 * @param {Array} [options.center=[0,0,0]] - Center point
 * @returns {ManifoldGeom3} The cube geometry
 */
export const cube = (options = {}) => {
  const defaults = { size: 2, center: [0, 0, 0] }
  const { size, center } = { ...defaults, ...options }

  const Manifold = getManifold()
  const s = Array.isArray(size) ? size : [size, size, size]

  // Manifold.cube creates centered cube, we need to handle JSCAD's default (corner at origin)
  const manifold = translateIfNonZero(Manifold.cube(s, true), center)

  return new ManifoldGeom3(manifold)
}

/**
 * Create a cuboid with different dimensions.
 *
 * @param {Object} options - Options
 * @param {Array} [options.size=[2,2,2]] - Size as [x, y, z]
 * @param {Array} [options.center=[0,0,0]] - Center point
 * @returns {ManifoldGeom3} The cuboid geometry
 */
export const cuboid = (options = {}) => {
  const defaults = { size: [2, 2, 2], center: [0, 0, 0] }
  const { size, center } = { ...defaults, ...options }

  const Manifold = getManifold()
  const manifold = translateIfNonZero(Manifold.cube(size, true), center)

  return new ManifoldGeom3(manifold)
}

/**
 * Create a sphere.
 *
 * @param {Object} options - Options
 * @param {number} [options.radius=1] - Sphere radius
 * @param {Array} [options.center=[0,0,0]] - Center point
 * @param {number} [options.segments=32] - Number of segments
 * @returns {ManifoldGeom3} The sphere geometry
 */
export const sphere = (options = {}) => {
  const defaults = { radius: 1, center: [0, 0, 0], segments: 32 }
  const { radius, center, segments } = { ...defaults, ...options }

  const Manifold = getManifold()
  const manifold = translateIfNonZero(Manifold.sphere(radius, segments), center)

  return new ManifoldGeom3(manifold)
}

/**
 * Create an ellipsoid.
 *
 * @param {Object} options - Options
 * @param {Array} [options.radius=[1,1,1]] - Radii as [rx, ry, rz]
 * @param {Array} [options.center=[0,0,0]] - Center point
 * @param {number} [options.segments=32] - Number of segments
 * @param {Array} [options.axes] - Custom axes for orientation
 * @returns {ManifoldGeom3} The ellipsoid geometry
 */
export const ellipsoid = (options = {}) => {
  const defaults = { radius: [1, 1, 1], center: [0, 0, 0], segments: 32 }
  const { radius, center, segments, axes } = { ...defaults, ...options }

  // If custom axes are specified, fall back to JSCAD (handles rotation)
  if (axes !== undefined) {
    const jscadEllipsoid = jscadPrimitives.ellipsoid(options)
    return new ManifoldGeom3(geom3ToManifold(jscadEllipsoid))
  }

  const Manifold = getManifold()
  // Create unit sphere and scale it
  const manifold = translateIfNonZero(Manifold.sphere(1, segments).scale(radius), center)

  return new ManifoldGeom3(manifold)
}

/**
 * Create a cylinder.
 *
 * @param {Object} options - Options
 * @param {number} [options.height=2] - Height of cylinder
 * @param {number} [options.radius=1] - Radius (or use startRadius/endRadius)
 * @param {number} [options.startRadius] - Start radius (for cone)
 * @param {number} [options.endRadius] - End radius (for cone)
 * @param {Array} [options.center=[0,0,0]] - Center point
 * @param {number} [options.segments=32] - Number of segments
 * @returns {ManifoldGeom3} The cylinder geometry
 */
export const cylinder = (options = {}) => {
  const defaults = { height: 2, radius: 1, center: [0, 0, 0], segments: 32 }
  const { height, radius, center, segments } = { ...defaults, ...options }
  let { startRadius, endRadius } = options

  // Handle radius variants
  if (startRadius === undefined) startRadius = radius
  if (endRadius === undefined) endRadius = radius

  // Manifold doesn't support zero radius - use small epsilon for cones
  const EPS = 1e-6
  if (startRadius === 0) startRadius = EPS
  if (endRadius === 0) endRadius = EPS

  const Manifold = getManifold()
  // Manifold.cylinder(height, radiusLow, radiusHigh=-1, circularSegments=0, center=false)
  const manifold = translateIfNonZero(
    Manifold.cylinder(height, startRadius, endRadius, segments, true),
    center
  )

  return new ManifoldGeom3(manifold)
}

/**
 * Create a cylinder with elliptical cross-section.
 *
 * @param {Object} options - Options
 * @param {number} [options.height=2] - Height
 * @param {Array} [options.startRadius=[1,1]] - Start radii [rx, ry]
 * @param {Array} [options.endRadius=[1,1]] - End radii [rx, ry]
 * @param {number} [options.startAngle=0] - Start angle in radians
 * @param {number} [options.endAngle=TAU] - End angle in radians
 * @param {Array} [options.center=[0,0,0]] - Center point
 * @param {number} [options.segments=32] - Number of segments
 * @returns {ManifoldGeom3} The cylinder geometry
 */
export const cylinderElliptic = (options = {}) => {
  const defaults = {
    height: 2,
    startRadius: [1, 1],
    endRadius: [1, 1],
    center: [0, 0, 0],
    segments: 32,
    startAngle: 0,
    endAngle: TAU
  }
  const { height, startRadius, endRadius, center, segments } = { ...defaults, ...options }
  // Handle angle defaults explicitly to detect if partial
  const startAngle = options.startAngle !== undefined ? options.startAngle : 0
  const endAngle = options.endAngle !== undefined ? options.endAngle : TAU

  const isPartial = options.startAngle !== undefined || options.endAngle !== undefined
  const CrossSection = getCrossSection()
  const Manifold = getManifold()

  if (isPartial) {
    // Create partial elliptic cylinder natively using Manifold
    // Generate a 2D sector (pie slice with elliptical outer edge)
    const angleRange = endAngle - startAngle
    const numSegments = Math.max(3, Math.ceil(segments * Math.abs(angleRange) / TAU))

    // Build points for the sector: center + arc points
    const points = [[0, 0]] // center point
    for (let i = 0; i <= numSegments; i++) {
      const angle = startAngle + (angleRange * i) / numSegments
      const x = startRadius[0] * Math.cos(angle)
      const y = startRadius[1] * Math.sin(angle)
      points.push([x, y])
    }

    // Create 2D cross-section from the sector polygon
    const section = new CrossSection([points])

    // Calculate scale for top (tapered cylinder)
    const scaleTop = [
      endRadius[0] / startRadius[0],
      endRadius[1] / startRadius[1]
    ]

    // Extrude to create 3D shape
    const manifold = translateIfNonZero(
      section.extrude(height, 1, 0, scaleTop, true),
      center
    )

    return new ManifoldGeom3(manifold)
  }

  // Check if the ellipse aspect ratio changes (rotation needed)
  // e.g., startRadius: [1, 1.5] -> endRadius: [1.5, 1] means the ellipse rotates
  const startAspect = startRadius[0] / startRadius[1]
  const endAspect = endRadius[0] / endRadius[1]
  const aspectRatioChanges = Math.abs(startAspect - endAspect) > 0.01

  if (aspectRatioChanges) {
    // Fall back to JSCAD for rotating ellipse case - Manifold can't handle this natively
    const jscadCylinder = jscadPrimitives.cylinderElliptic(options)
    return new ManifoldGeom3(geom3ToManifold(jscadCylinder))
  }

  // Full cylinder with same aspect ratio - use Manifold's native cylinder with scaling
  const maxStartR = Math.max(startRadius[0], startRadius[1])
  const maxEndR = Math.max(endRadius[0], endRadius[1])

  let manifold = Manifold.cylinder(height, maxStartR, maxEndR, segments, true)

  // Scale to make elliptical if needed
  const scaleX = startRadius[0] / maxStartR
  const scaleY = startRadius[1] / maxStartR
  if (scaleX !== 1 || scaleY !== 1) {
    manifold = manifold.scale([scaleX, scaleY, 1])
  }

  return new ManifoldGeom3(translateIfNonZero(manifold, center))
}

/**
 * Create a rounded cuboid.
 *
 * @param {Object} options - Options
 * @param {Array} [options.size=[2,2,2]] - Size
 * @param {number} [options.roundRadius=0.2] - Corner radius
 * @param {Array} [options.center=[0,0,0]] - Center point
 * @param {number} [options.segments=16] - Segments for rounding
 * @returns {ManifoldGeom3} The rounded cuboid geometry
 */
export const roundedCuboid = (options = {}) => {
  const defaults = { size: [2, 2, 2], roundRadius: 0.2, center: [0, 0, 0], segments: 16 }
  const { size, roundRadius, center, segments } = { ...defaults, ...options }

  // Use JSCAD's implementation via fallback for now
  // Manifold doesn't have a native rounded cuboid
  const jscadRoundedCuboid = jscadPrimitives.roundedCuboid({ size, roundRadius, center, segments })

  // Convert to Manifold
  return new ManifoldGeom3(geom3ToManifold(jscadRoundedCuboid))
}

/**
 * Create a rounded cylinder.
 *
 * @param {Object} options - Options
 * @param {number} [options.height=2] - Height
 * @param {number} [options.radius=1] - Radius
 * @param {number} [options.roundRadius=0.2] - Edge radius
 * @param {Array} [options.center=[0,0,0]] - Center point
 * @param {number} [options.segments=32] - Number of segments
 * @returns {ManifoldGeom3} The rounded cylinder geometry
 */
export const roundedCylinder = (options = {}) => {
  const defaults = { height: 2, radius: 1, roundRadius: 0.2, center: [0, 0, 0], segments: 32 }
  const { height, radius, roundRadius, center, segments } = { ...defaults, ...options }

  // Use JSCAD's implementation via fallback
  const jscadRoundedCylinder = jscadPrimitives.roundedCylinder({ height, radius, roundRadius, center, segments })

  return new ManifoldGeom3(geom3ToManifold(jscadRoundedCylinder))
}

/**
 * Create a geodesic sphere.
 *
 * @param {Object} options - Options
 * @param {number} [options.radius=1] - Radius
 * @param {number} [options.frequency=6] - Subdivision frequency
 * @param {Array} [options.center=[0,0,0]] - Center point
 * @returns {ManifoldGeom3} The geodesic sphere geometry
 */
export const geodesicSphere = (options = {}) => {
  const defaults = { radius: 1, frequency: 6, center: [0, 0, 0] }
  const { radius, frequency, center } = { ...defaults, ...options }

  // Use JSCAD's implementation
  const jscadGeodesic = jscadPrimitives.geodesicSphere({ radius, frequency, center })

  return new ManifoldGeom3(geom3ToManifold(jscadGeodesic))
}

/**
 * Create a torus.
 *
 * @param {Object} options - Options
 * @param {number} [options.innerRadius=1] - Inner radius (tube center to torus center)
 * @param {number} [options.outerRadius=4] - Outer radius (distance from center to tube center)
 * @param {number} [options.innerSegments=16] - Segments around tube
 * @param {number} [options.outerSegments=32] - Segments around torus
 * @param {number} [options.innerRotation=0] - Rotation of inner segments
 * @param {Array} [options.center=[0,0,0]] - Center point
 * @returns {ManifoldGeom3} The torus geometry
 */
export const torus = (options = {}) => {
  const defaults = {
    innerRadius: 1,
    outerRadius: 4,
    innerSegments: 16,
    outerSegments: 32,
    innerRotation: 0,
    center: [0, 0, 0]
  }
  const { innerRadius, outerRadius, innerSegments, outerSegments, innerRotation, center } = { ...defaults, ...options }

  // Use JSCAD's implementation - torus is complex
  const jscadTorus = jscadPrimitives.torus({
    innerRadius,
    outerRadius,
    innerSegments,
    outerSegments,
    innerRotation,
    center
  })

  return new ManifoldGeom3(geom3ToManifold(jscadTorus))
}

/**
 * Create a polyhedron from vertices and faces.
 *
 * @param {Object} options - Options
 * @param {Array} options.points - Array of [x, y, z] vertices
 * @param {Array} options.faces - Array of face index arrays
 * @param {Array} [options.colors] - Optional face colors
 * @param {string} [options.orientation='outward'] - Face orientation
 * @returns {ManifoldGeom3} The polyhedron geometry
 */
export const polyhedron = (options = {}) => {
  const { points, faces, colors, orientation = 'outward' } = options

  if (!points || !faces) {
    throw new Error('polyhedron requires points and faces')
  }

  // Use JSCAD's implementation for complex face handling
  const jscadPolyhedron = jscadPrimitives.polyhedron({ points, faces, colors, orientation })

  return new ManifoldGeom3(geom3ToManifold(jscadPolyhedron))
}

// ============================================================================
// 2D Primitives
// ============================================================================

/**
 * Create a rectangle.
 *
 * @param {Object} options - Options
 * @param {Array|number} [options.size=[2,2]] - Size as [x, y] or single value
 * @param {Array} [options.center=[0,0]] - Center point
 * @returns {ManifoldGeom2} The rectangle geometry
 */
export const rectangle = (options = {}) => {
  const defaults = { size: [2, 2], center: [0, 0] }
  let { size } = { ...defaults, ...options }
  const { center } = { ...defaults, ...options }

  if (!Array.isArray(size)) size = [size, size]

  const CrossSection = getCrossSection()
  const hw = size[0] / 2
  const hh = size[1] / 2

  const contour = [
    [center[0] - hw, center[1] - hh],
    [center[0] + hw, center[1] - hh],
    [center[0] + hw, center[1] + hh],
    [center[0] - hw, center[1] + hh]
  ]

  return new ManifoldGeom2(new CrossSection([contour]))
}

/**
 * Create a square.
 *
 * @param {Object} options - Options
 * @param {number} [options.size=2] - Size
 * @param {Array} [options.center=[0,0]] - Center point
 * @returns {ManifoldGeom2} The square geometry
 */
export const square = (options = {}) => {
  const defaults = { size: 2, center: [0, 0] }
  const { size, center } = { ...defaults, ...options }
  return rectangle({ size: [size, size], center })
}

/**
 * Create a circle.
 *
 * @param {Object} options - Options
 * @param {number} [options.radius=1] - Radius
 * @param {Array} [options.center=[0,0]] - Center point
 * @param {number} [options.segments=32] - Number of segments
 * @returns {ManifoldGeom2} The circle geometry
 */
export const circle = (options = {}) => {
  const defaults = { radius: 1, center: [0, 0], segments: 32 }
  const { radius, center, segments } = { ...defaults, ...options }

  const CrossSection = getCrossSection()
  const contour = []

  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments
    contour.push([
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle)
    ])
  }

  return new ManifoldGeom2(new CrossSection([contour]))
}

/**
 * Create an ellipse.
 *
 * @param {Object} options - Options
 * @param {Array} [options.radius=[1,1]] - Radii as [rx, ry]
 * @param {Array} [options.center=[0,0]] - Center point
 * @param {number} [options.segments=32] - Number of segments
 * @returns {ManifoldGeom2} The ellipse geometry
 */
export const ellipse = (options = {}) => {
  const defaults = { radius: [1, 1], center: [0, 0], segments: 32 }
  const { radius, center, segments } = { ...defaults, ...options }

  const CrossSection = getCrossSection()
  const contour = []

  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments
    contour.push([
      center[0] + radius[0] * Math.cos(angle),
      center[1] + radius[1] * Math.sin(angle)
    ])
  }

  return new ManifoldGeom2(new CrossSection([contour]))
}

/**
 * Calculate the signed area of a 2D polygon.
 * Positive = counterclockwise, Negative = clockwise.
 *
 * @param {Array} points - Array of [x, y] points
 * @returns {number} Signed area
 */
const signedArea = (points) => {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i][0] * points[j][1]
    area -= points[j][0] * points[i][1]
  }
  return area / 2
}

/**
 * Ensure polygon points are in counterclockwise order.
 * Manifold's CrossSection requires CCW winding for outer contours.
 *
 * @param {Array} points - Array of [x, y] points
 * @param {boolean} [shouldBeCCW=true] - true for outer contour, false for holes
 * @returns {Array} Points in correct winding order
 */
const normalizeWinding = (points, shouldBeCCW = true) => {
  const area = signedArea(points)
  const isCCW = area > 0
  if (isCCW !== shouldBeCCW) {
    return [...points].reverse()
  }
  return points
}

/**
 * Create a polygon from points.
 *
 * @param {Object} options - Options
 * @param {Array} options.points - Array of [x, y] points
 * @param {Array} [options.paths] - Optional paths for holes
 * @returns {ManifoldGeom2} The polygon geometry
 */
export const polygon = (options = {}) => {
  const { points, paths } = options

  if (!points || points.length < 3) {
    throw new Error('polygon requires at least 3 points')
  }

  const CrossSection = getCrossSection()

  if (!paths || paths.length === 0) {
    // Simple polygon - single contour, ensure CCW winding
    const normalizedPoints = normalizeWinding(points, true)
    return new ManifoldGeom2(new CrossSection([normalizedPoints]))
  }

  // Multiple paths (outer + holes)
  // First path is outer contour (CCW), remaining are holes (CW)
  const contours = paths.map((path, idx) => {
    const contourPoints = path.map(i => points[i])
    // Outer contour should be CCW, holes should be CW
    return normalizeWinding(contourPoints, idx === 0)
  })
  return new ManifoldGeom2(new CrossSection(contours))
}

/**
 * Create a rounded rectangle.
 *
 * @param {Object} options - Options
 * @param {Array} [options.size=[2,2]] - Size as [x, y]
 * @param {number} [options.roundRadius=0.2] - Corner radius
 * @param {Array} [options.center=[0,0]] - Center point
 * @param {number} [options.segments=16] - Segments for corners
 * @returns {ManifoldGeom2} The rounded rectangle geometry
 */
export const roundedRectangle = (options = {}) => {
  const defaults = { size: [2, 2], roundRadius: 0.2, center: [0, 0], segments: 16 }
  const { size, roundRadius, center, segments } = { ...defaults, ...options }

  // Use JSCAD's implementation
  const jscadRoundedRect = jscadPrimitives.roundedRectangle({ size, roundRadius, center, segments })

  return new ManifoldGeom2(geom2ToCrossSection(jscadRoundedRect))
}

/**
 * Create a star shape.
 *
 * @param {Object} options - Options
 * @param {number} [options.vertices=5] - Number of points
 * @param {number} [options.outerRadius=1] - Outer radius
 * @param {number} [options.innerRadius=0] - Inner radius (0 = calculate from density)
 * @param {number} [options.density=2] - Density of star (used when innerRadius=0)
 * @param {number} [options.startAngle=0] - Starting angle in radians
 * @param {Array} [options.center=[0,0]] - Center point
 * @returns {ManifoldGeom2} The star geometry
 */
export const star = (options = {}) => {
  // Pass all options through to JSCAD - it handles all parameters correctly
  const jscadStar = jscadPrimitives.star(options)

  return new ManifoldGeom2(geom2ToCrossSection(jscadStar))
}

// ============================================================================
// Path primitives (fallback to JSCAD - these return path2, not geom2)
// ============================================================================

/**
 * Create an arc path.
 *
 * @param {Object} options - Options
 * @param {Array} [options.center=[0,0]] - Center of arc
 * @param {number} [options.radius=1] - Radius
 * @param {number} [options.startAngle=0] - Starting angle in radians
 * @param {number} [options.endAngle=TAU] - Ending angle in radians
 * @param {number} [options.segments=32] - Number of segments
 * @param {boolean} [options.makeTangent=false] - Add tangent segments at ends
 * @returns {Object} path2 geometry
 */
export const arc = (options = {}) => {
  return jscadPrimitives.arc(options)
}

/**
 * Create a line path from points.
 *
 * @param {Array} points - Array of [x, y] points
 * @returns {Object} path2 geometry
 */
export const line = (points) => {
  return jscadPrimitives.line(points)
}

export default {
  // 3D
  cube,
  cuboid,
  sphere,
  ellipsoid,
  cylinder,
  cylinderElliptic,
  roundedCuboid,
  roundedCylinder,
  geodesicSphere,
  torus,
  polyhedron,
  // 2D
  rectangle,
  square,
  circle,
  ellipse,
  polygon,
  roundedRectangle,
  star,
  // Paths
  arc,
  line
}
