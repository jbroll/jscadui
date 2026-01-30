/**
 * Manifold-native boolean operations.
 *
 * These are the core operations that fix JSCAD's broken BSP-based booleans.
 * Manifold guarantees watertight, manifold output.
 *
 * For 2D operations, uses a hybrid approach:
 * - When inputs have JSCAD geom2 as source, uses JSCAD booleans to avoid conversion issues
 * - Otherwise uses Manifold's CrossSection for robust boolean operations
 */

import { getManifold, getCrossSection } from '../init.js'
import { ManifoldGeom3, isManifoldGeom3, toManifold } from '../geometries/ManifoldGeom3.js'
import { ManifoldGeom2, isManifoldGeom2, toCrossSection, toJscadGeom2, fromJscadGeom2 } from '../geometries/ManifoldGeom2.js'
import * as jscad from '@jscad/modeling-for-manifold'

const jscadBooleans = jscad.booleans

// ============================================================================
// 3D Boolean Operations
// ============================================================================

/**
 * Union of multiple 3D geometries.
 *
 * @param {...Object} geometries - Geometries to union (ManifoldGeom3 or geom3)
 * @returns {ManifoldGeom3} The union result
 */
export const union = (...geometries) => {
  // Flatten if passed as array
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  if (geoms.length === 0) {
    throw new Error('union requires at least one geometry')
  }

  // Separate 2D and 3D geometries
  const is2D = isManifoldGeom2(geoms[0]) || (geoms[0].sides !== undefined) || (geoms[0].outlines !== undefined)

  if (is2D) {
    return union2D(geoms)
  }

  // Convert all to Manifold objects
  const manifolds = geoms.map(g => toManifold(g))

  if (manifolds.length === 1) {
    return new ManifoldGeom3(manifolds[0])
  }

  // Use Manifold's batch union for efficiency
  const Manifold = getManifold()
  const result = Manifold.union(manifolds)

  return new ManifoldGeom3(result)
}

/**
 * Check if any geometry has JSCAD as its source of truth.
 * If so, we should use JSCAD booleans to avoid conversion issues.
 */
const hasJscadSource = (geometries) => {
  return geometries.some(g => isManifoldGeom2(g) && g.hasJscadSource)
}

/**
 * Union of multiple 2D geometries.
 *
 * @param {Array} geometries - Geometries to union
 * @returns {ManifoldGeom2} The union result
 */
const union2D = (geometries) => {
  // If any input has JSCAD as source, use JSCAD booleans to avoid conversion issues
  if (hasJscadSource(geometries)) {
    const jscadGeoms = geometries.map(g => toJscadGeom2(g))
    const result = jscadBooleans.union(jscadGeoms)
    return fromJscadGeom2(result)
  }

  // Otherwise use Manifold's CrossSection for robust booleans
  const sections = geometries.map(g => toCrossSection(g))

  if (sections.length === 1) {
    return new ManifoldGeom2(sections[0])
  }

  const CrossSection = getCrossSection()
  const result = CrossSection.union(sections)

  return new ManifoldGeom2(result)
}

/**
 * Subtract geometries from the first geometry.
 *
 * @param {...Object} geometries - First is target, rest are subtracted
 * @returns {ManifoldGeom3} The subtraction result
 */
export const subtract = (...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  if (geoms.length === 0) {
    throw new Error('subtract requires at least one geometry')
  }

  if (geoms.length === 1) {
    return isManifoldGeom3(geoms[0]) ? geoms[0] : new ManifoldGeom3(toManifold(geoms[0]))
  }

  // Check if 2D
  const is2D = isManifoldGeom2(geoms[0]) || (geoms[0].sides !== undefined) || (geoms[0].outlines !== undefined)

  if (is2D) {
    return subtract2D(geoms)
  }

  // Convert all to Manifold objects
  const manifolds = geoms.map(g => toManifold(g))

  // Subtract all subsequent geometries from the first
  let result = manifolds[0]
  for (let i = 1; i < manifolds.length; i++) {
    result = result.subtract(manifolds[i])
  }

  return new ManifoldGeom3(result)
}

/**
 * Subtract 2D geometries.
 *
 * @param {Array} geometries - Geometries to subtract
 * @returns {ManifoldGeom2} The subtraction result
 */
const subtract2D = (geometries) => {
  // If any input has JSCAD as source, use JSCAD booleans to avoid conversion issues
  if (hasJscadSource(geometries)) {
    const jscadGeoms = geometries.map(g => toJscadGeom2(g))
    const result = jscadBooleans.subtract(jscadGeoms)
    return fromJscadGeom2(result)
  }

  // Otherwise use Manifold's CrossSection for robust booleans
  const sections = geometries.map(g => toCrossSection(g))

  let result = sections[0]
  for (let i = 1; i < sections.length; i++) {
    result = result.subtract(sections[i])
  }

  return new ManifoldGeom2(result)
}

/**
 * Intersection of multiple 3D geometries.
 *
 * @param {...Object} geometries - Geometries to intersect
 * @returns {ManifoldGeom3} The intersection result
 */
export const intersect = (...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  if (geoms.length === 0) {
    throw new Error('intersect requires at least one geometry')
  }

  // Check if 2D
  const is2D = isManifoldGeom2(geoms[0]) || (geoms[0].sides !== undefined) || (geoms[0].outlines !== undefined)

  if (is2D) {
    return intersect2D(geoms)
  }

  // Convert all to Manifold objects
  const manifolds = geoms.map(g => toManifold(g))

  if (manifolds.length === 1) {
    return new ManifoldGeom3(manifolds[0])
  }

  // Use Manifold's batch intersection for efficiency
  const Manifold = getManifold()
  const result = Manifold.intersection(manifolds)

  return new ManifoldGeom3(result)
}

/**
 * Intersection of 2D geometries.
 *
 * @param {Array} geometries - Geometries to intersect
 * @returns {ManifoldGeom2} The intersection result
 */
const intersect2D = (geometries) => {
  // If any input has JSCAD as source, use JSCAD booleans to avoid conversion issues
  if (hasJscadSource(geometries)) {
    const jscadGeoms = geometries.map(g => toJscadGeom2(g))
    const result = jscadBooleans.intersect(jscadGeoms)
    return fromJscadGeom2(result)
  }

  // Otherwise use Manifold's CrossSection for robust booleans
  const sections = geometries.map(g => toCrossSection(g))

  if (sections.length === 1) {
    return new ManifoldGeom2(sections[0])
  }

  const CrossSection = getCrossSection()
  const result = CrossSection.intersection(sections)

  return new ManifoldGeom2(result)
}

/**
 * Split a geometry into disconnected pieces (scission).
 *
 * @param {Object} geometry - Geometry to split
 * @returns {Array} Array of ManifoldGeom3 pieces
 */
export const scission = (geometry) => {
  const manifold = toManifold(geometry)

  // Manifold's decompose splits into connected components
  const pieces = manifold.decompose()

  return pieces.map(piece => new ManifoldGeom3(piece))
}

/**
 * Compute the Minkowski sum of two geometries.
 *
 * The Minkowski sum A + B is the set of all points a + b where a ∈ A and b ∈ B.
 * Practically: summing with a sphere rounds all edges, summing with a cube chamfers them.
 *
 * For convex inputs: uses hull of all pairwise vertex sums (fast and exact).
 * For non-convex inputs: decomposes into tetrahedra, computes minkowski of each, then unions.
 *
 * @param {...Object} geometries - Two geom3 geometries to sum
 * @returns {ManifoldGeom3} The Minkowski sum
 */
export const minkowski = (...geometries) => {
  const geoms = geometries.flat(Infinity).filter(g => g != null)

  if (geoms.length < 2) {
    throw new Error('minkowski requires at least two geometries')
  }

  if (geoms.length > 2) {
    throw new Error('minkowski currently supports exactly two geometries')
  }

  // Convert both inputs to Manifold
  const manifoldA = toManifold(geoms[0])
  const manifoldB = toManifold(geoms[1])

  const Manifold = getManifold()

  // Check if inputs are convex by comparing to their hulls
  const hullA = manifoldA.hull()
  const hullB = manifoldB.hull()
  const aIsConvex = Math.abs(manifoldA.volume() - hullA.volume()) < 1e-10
  const bIsConvex = Math.abs(manifoldB.volume() - hullB.volume()) < 1e-10

  if (aIsConvex && bIsConvex) {
    // Fast path: both convex - hull of pairwise vertex sums
    return new ManifoldGeom3(minkowskiConvex(manifoldA, manifoldB, Manifold))
  }

  // Non-convex A + convex B: decompose A into tetrahedra
  if (!aIsConvex && bIsConvex) {
    return new ManifoldGeom3(minkowskiNonConvexConvex(manifoldA, manifoldB, Manifold))
  }

  // Convex A + non-convex B: swap (minkowski is commutative)
  if (aIsConvex && !bIsConvex) {
    return new ManifoldGeom3(minkowskiNonConvexConvex(manifoldB, manifoldA, Manifold))
  }

  // Both non-convex: decompose A, compute minkowski of each with B
  // This is an approximation but handles most practical cases
  return new ManifoldGeom3(minkowskiNonConvexConvex(manifoldA, hullB, Manifold))
}

/**
 * Compute minkowski sum of non-convex A with convex B.
 * Decomposes A into tetrahedra from centroid, computes minkowski of each, unions results.
 */
const minkowskiNonConvexConvex = (manifoldA, manifoldB, Manifold) => {
  const mesh = manifoldA.getMesh()
  const vertices = extractAllVertices(mesh)
  const triangles = extractTriangles(mesh)

  if (triangles.length === 0) {
    return manifoldB
  }

  // Compute centroid
  const centroid = computeCentroid(vertices)

  // Build tetrahedra from centroid to each triangle face
  const results = []
  for (const tri of triangles) {
    const v0 = vertices[tri[0]]
    const v1 = vertices[tri[1]]
    const v2 = vertices[tri[2]]

    // Create tetrahedron from centroid and triangle vertices
    const tetManifold = createTetrahedron(centroid, v0, v1, v2, Manifold)
    if (tetManifold) {
      // Compute minkowski of this tetrahedron with B
      const minkResult = minkowskiConvex(tetManifold, manifoldB, Manifold)
      results.push(minkResult)
    }
  }

  if (results.length === 0) {
    return manifoldB
  }

  if (results.length === 1) {
    return results[0]
  }

  // Union all results - Manifold's union is robust
  return Manifold.union(results)
}

/**
 * Create a tetrahedron manifold from 4 points.
 */
const createTetrahedron = (p0, p1, p2, p3, Manifold) => {
  // Check for degenerate tetrahedron (coplanar points)
  const v1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
  const v2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
  const v3 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]]

  // Volume = |v1 · (v2 × v3)| / 6
  const cross = [
    v2[1] * v3[2] - v2[2] * v3[1],
    v2[2] * v3[0] - v2[0] * v3[2],
    v2[0] * v3[1] - v2[1] * v3[0]
  ]
  const volume = Math.abs(v1[0] * cross[0] + v1[1] * cross[1] + v1[2] * cross[2]) / 6

  if (volume < 1e-10) {
    return null // Degenerate tetrahedron
  }

  // Use hull to create tetrahedron - guaranteed valid
  return Manifold.hull([p0, p1, p2, p3])
}

/**
 * Extract all vertices from mesh (with indices).
 */
const extractAllVertices = (mesh) => {
  const vertices = []
  const props = mesh.vertProperties
  const numProp = mesh.numProp

  for (let i = 0; i < props.length; i += numProp) {
    vertices.push([props[i], props[i + 1], props[i + 2]])
  }

  return vertices
}

/**
 * Extract triangles (face indices) from mesh.
 */
const extractTriangles = (mesh) => {
  const triangles = []
  const indices = mesh.triVerts

  for (let i = 0; i < indices.length; i += 3) {
    triangles.push([indices[i], indices[i + 1], indices[i + 2]])
  }

  return triangles
}

/**
 * Compute centroid of vertices.
 */
const computeCentroid = (vertices) => {
  if (vertices.length === 0) return [0, 0, 0]

  let x = 0, y = 0, z = 0
  for (const v of vertices) {
    x += v[0]
    y += v[1]
    z += v[2]
  }

  const n = vertices.length
  return [x / n, y / n, z / n]
}

/**
 * Compute Minkowski sum of two convex manifolds using hull of pairwise vertex sums.
 * @param {Manifold} manifoldA - First convex manifold
 * @param {Manifold} manifoldB - Second convex manifold
 * @param {Object} Manifold - Manifold class
 * @returns {Manifold} The minkowski sum
 */
const minkowskiConvex = (manifoldA, manifoldB, Manifold) => {
  const verticesA = extractUniqueVertices(manifoldA.getMesh())
  const verticesB = extractUniqueVertices(manifoldB.getMesh())

  if (verticesA.length === 0 || verticesB.length === 0) {
    return manifoldA
  }

  // Compute all pairwise vertex sums
  const summedPoints = []
  for (const a of verticesA) {
    for (const b of verticesB) {
      summedPoints.push([a[0] + b[0], a[1] + b[1], a[2] + b[2]])
    }
  }

  // Hull of all pairwise sums gives the minkowski sum for convex inputs
  return Manifold.hull(summedPoints)
}

/**
 * Extract unique vertices from a Manifold mesh.
 * @param {Object} mesh - Manifold mesh object
 * @returns {Array} Array of [x, y, z] vertex positions
 */
const extractUniqueVertices = (mesh) => {
  const found = new Set()
  const unique = []
  const props = mesh.vertProperties
  const numProp = mesh.numProp

  for (let i = 0; i < props.length; i += numProp) {
    const x = props[i]
    const y = props[i + 1]
    const z = props[i + 2]
    // Round to avoid floating point duplicates
    const key = `${x.toFixed(9)},${y.toFixed(9)},${z.toFixed(9)}`
    if (!found.has(key)) {
      found.add(key)
      unique.push([x, y, z])
    }
  }

  return unique
}

export default {
  union,
  subtract,
  intersect,
  scission,
  minkowski
}
