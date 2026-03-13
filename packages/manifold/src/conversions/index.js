/**
 * Conversion functions between JSCAD geometries and Manifold objects.
 *
 * Handles the transformation between JSCAD's polygon-based geom3 format
 * and Manifold's indexed triangle mesh format.
 */

import { getModule, getManifold, getCrossSection } from '../init.js'
import * as jscadModule from '@jscad/modeling-for-manifold'

// Handle both ESM default export (Node.js) and bundled named exports (vitest/bundler)
const jscad = jscadModule.default || jscadModule

// JSCAD geom2 utilities for proper conversion
const jscadGeom2 = jscad.geometries.geom2

/**
 * Compute signed area of a 2D polygon (projected onto a plane).
 * Used to determine winding order and check if a polygon is convex.
 */
const signedArea2D = (points) => {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i][0] * points[j][1]
    area -= points[j][0] * points[i][1]
  }
  return area / 2
}

/**
 * Check if a point is inside a triangle (2D).
 */
const pointInTriangle2D = (p, a, b, c) => {
  const sign = (p1, p2, p3) => {
    return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
  }
  const d1 = sign(p, a, b)
  const d2 = sign(p, b, c)
  const d3 = sign(p, c, a)
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0)
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0)
  return !(hasNeg && hasPos)
}

/**
 * Project 3D polygon onto 2D plane for triangulation.
 * Uses the polygon's normal to determine the best projection plane.
 */
const projectTo2D = (vertices3D) => {
  // Compute polygon normal using Newell's method
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < vertices3D.length; i++) {
    const curr = vertices3D[i]
    const next = vertices3D[(i + 1) % vertices3D.length]
    nx += (curr[1] - next[1]) * (curr[2] + next[2])
    ny += (curr[2] - next[2]) * (curr[0] + next[0])
    nz += (curr[0] - next[0]) * (curr[1] + next[1])
  }

  // Determine dominant axis and project accordingly
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
  if (ax >= ay && ax >= az) {
    // Project onto YZ plane
    return vertices3D.map(v => [v[1], v[2]])
  } else if (ay >= ax && ay >= az) {
    // Project onto XZ plane
    return vertices3D.map(v => [v[0], v[2]])
  } else {
    // Project onto XY plane
    return vertices3D.map(v => [v[0], v[1]])
  }
}

/**
 * Ear-clipping triangulation for simple polygons.
 * Returns array of triangle indices [i0, i1, i2, i3, i4, i5, ...]
 *
 * This algorithm works for both convex and non-convex polygons.
 */
const earClipTriangulate = (vertices3D) => {
  const n = vertices3D.length
  if (n < 3) return []
  if (n === 3) return [0, 1, 2]

  // Project to 2D for triangulation
  const vertices2D = projectTo2D(vertices3D)

  // Determine winding WITHOUT reversing indices.
  // Reversing indices changes which boundary edges appear in the triangulation,
  // causing non-manifold edges when triangulated caps are adjacent to side faces
  // that share edges in a specific direction.
  const area = signedArea2D(vertices2D)
  const ccw = area >= 0  // true = CCW polygon, false = CW polygon
  const indices = []
  for (let i = 0; i < n; i++) indices.push(i)

  const triangles = []
  const remaining = [...indices]

  // Ear clipping loop
  let safety = remaining.length * 2
  while (remaining.length > 3 && safety-- > 0) {
    let earFound = false

    for (let i = 0; i < remaining.length; i++) {
      const prev = remaining[(i + remaining.length - 1) % remaining.length]
      const curr = remaining[i]
      const next = remaining[(i + 1) % remaining.length]

      const a = vertices2D[prev]
      const b = vertices2D[curr]
      const c = vertices2D[next]

      // Check if this is a convex vertex (ear candidate).
      // For CCW polygon: convex = cross > 0. For CW polygon: convex = cross < 0.
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      if (ccw ? cross <= 0 : cross >= 0) continue // Reflex vertex, not an ear

      // Check if any other vertex is inside this triangle
      let hasPointInside = false
      for (let j = 0; j < remaining.length; j++) {
        const idx = remaining[j]
        if (idx === prev || idx === curr || idx === next) continue
        if (pointInTriangle2D(vertices2D[idx], a, b, c)) {
          hasPointInside = true
          break
        }
      }

      if (!hasPointInside) {
        // Found an ear - add triangle and remove vertex
        triangles.push(prev, curr, next)
        remaining.splice(i, 1)
        earFound = true
        break
      }
    }

    // If no ear found, use fan triangulation as fallback
    if (!earFound) break
  }

  // Handle remaining triangle
  if (remaining.length === 3) {
    triangles.push(remaining[0], remaining[1], remaining[2])
  } else if (remaining.length > 3) {
    // Fallback to fan triangulation for remaining vertices
    for (let i = 1; i < remaining.length - 1; i++) {
      triangles.push(remaining[0], remaining[i], remaining[i + 1])
    }
  }

  return triangles
}

/**
 * Check if a polygon is convex (allows fast fan triangulation).
 */
const isConvexPolygon = (vertices3D) => {
  if (vertices3D.length <= 3) return true

  const vertices2D = projectTo2D(vertices3D)
  let sign = null

  for (let i = 0; i < vertices2D.length; i++) {
    const a = vertices2D[i]
    const b = vertices2D[(i + 1) % vertices2D.length]
    const c = vertices2D[(i + 2) % vertices2D.length]

    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (Math.abs(cross) < 1e-10) continue // Collinear, skip

    if (sign === null) {
      sign = cross > 0
    } else if ((cross > 0) !== sign) {
      return false // Sign changed, polygon is non-convex
    }
  }
  return true
}

/**
 * Convert a JSCAD geom3 to a Manifold object.
 *
 * @param {Object} geom - JSCAD geom3 geometry
 * @returns {Object} Manifold object
 */
export const geom3ToManifold = (geom) => {
  const Manifold = getManifold()
  const Module = getModule()

  // Get polygons, applying any pending transforms
  const polygons = geom.polygons || []
  const transforms = geom.transforms

  // Collect all vertices and triangulate polygons
  const vertices = []
  const triVerts = []
  const vertexMap = new Map()

  const getVertexIndex = (v) => {
    // Apply transform if present
    let x = v[0], y = v[1], z = v[2]
    if (transforms) {
      const tx = transforms[0] * x + transforms[4] * y + transforms[8] * z + transforms[12]
      const ty = transforms[1] * x + transforms[5] * y + transforms[9] * z + transforms[13]
      const tz = transforms[2] * x + transforms[6] * y + transforms[10] * z + transforms[14]
      x = tx; y = ty; z = tz
    }

    // Use string key for vertex deduplication
    // Normalize near-zero values to exactly 0 to avoid issues with -0 and trig residuals
    // (e.g., sin(π) ≈ 1.22e-16 is geometrically 0 but would produce a different key)
    const nz = (v) => Math.abs(v) < 1e-9 ? 0 : v
    const key = `${nz(x).toFixed(9)},${nz(y).toFixed(9)},${nz(z).toFixed(9)}`
    if (vertexMap.has(key)) {
      return vertexMap.get(key)
    }
    const index = vertices.length / 3
    vertices.push(x, y, z)
    vertexMap.set(key, index)
    return index
  }

  // Triangulate each polygon and collect vertex indices
  for (const poly of polygons) {
    const polyVertices = poly.vertices || poly
    if (polyVertices.length < 3) continue

    // Get transformed vertices for this polygon
    const transformedVerts = polyVertices.map(v => {
      let x = v[0], y = v[1], z = v[2]
      if (transforms) {
        const tx = transforms[0] * x + transforms[4] * y + transforms[8] * z + transforms[12]
        const ty = transforms[1] * x + transforms[5] * y + transforms[9] * z + transforms[13]
        const tz = transforms[2] * x + transforms[6] * y + transforms[10] * z + transforms[14]
        x = tx; y = ty; z = tz
      }
      return [x, y, z]
    })

    // Use fast fan triangulation for convex polygons, ear-clipping for non-convex
    if (polyVertices.length === 3 || isConvexPolygon(transformedVerts)) {
      // Fan triangulation (fast path for convex polygons)
      const v0 = getVertexIndex(polyVertices[0])
      for (let i = 1; i < polyVertices.length - 1; i++) {
        const v1 = getVertexIndex(polyVertices[i])
        const v2 = getVertexIndex(polyVertices[i + 1])
        // Skip degenerate triangles (zero area - two or more identical vertices)
        if (v0 !== v1 && v1 !== v2 && v0 !== v2) {
          triVerts.push(v0, v1, v2)
        }
      }
    } else {
      // Ear-clipping triangulation for non-convex polygons
      const localIndices = earClipTriangulate(transformedVerts)
      for (let i = 0; i < localIndices.length; i += 3) {
        const v0 = getVertexIndex(polyVertices[localIndices[i]])
        const v1 = getVertexIndex(polyVertices[localIndices[i + 1]])
        const v2 = getVertexIndex(polyVertices[localIndices[i + 2]])
        // Skip degenerate triangles
        if (v0 !== v1 && v1 !== v2 && v0 !== v2) {
          triVerts.push(v0, v1, v2)
        }
      }
    }
  }

  if (vertices.length === 0 || triVerts.length === 0) {
    // Return proper empty manifold
    return Manifold.ofMesh(new Module.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(0),
      triVerts: new Uint32Array(0)
    }))
  }

  // Create Manifold mesh
  const mesh = new Module.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(vertices),
    triVerts: new Uint32Array(triVerts)
  })

  // Create Manifold from mesh
  // Note: Mesh is a plain data object, not a WASM class - no delete() needed
  return Manifold.ofMesh(mesh)
}

/**
 * Convert a Manifold object to a JSCAD geom3.
 *
 * @param {Object} manifold - Manifold object
 * @returns {Object} JSCAD geom3 geometry
 */
export const manifoldToGeom3 = (manifold) => {
  const mesh = manifold.getMesh()
  const vertProps = mesh.vertProperties
  const triVerts = mesh.triVerts

  // Extract vertices from flat array
  const getVertex = (index) => {
    const base = index * 3
    return [vertProps[base], vertProps[base + 1], vertProps[base + 2]]
  }

  // Convert each triangle to a poly3
  const polygons = []
  for (let i = 0; i < triVerts.length; i += 3) {
    const v0 = getVertex(triVerts[i])
    const v1 = getVertex(triVerts[i + 1])
    const v2 = getVertex(triVerts[i + 2])
    polygons.push({ vertices: [v0, v1, v2] })
  }

  return {
    polygons,
    transforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] // Identity matrix
  }
}

/**
 * Convert a JSCAD geom2 to a Manifold CrossSection.
 *
 * @param {Object} geom - JSCAD geom2 geometry
 * @returns {Object} Manifold CrossSection object
 */
export const geom2ToCrossSection = (geom) => {
  const CrossSection = getCrossSection()

  // Helper to validate a point
  const isValidPoint = (point) => {
    if (!point || !Array.isArray(point) || point.length < 2) return false
    const x = point[0]
    const y = point[1]
    return typeof x === 'number' && typeof y === 'number' &&
           isFinite(x) && isFinite(y)
  }

  // Try multiple approaches to get valid outlines
  let outlines = null

  // Approach 1: Use JSCAD's toOutlines (handles sides and transforms properly)
  try {
    outlines = jscadGeom2.toOutlines(geom)
    if (outlines && outlines.length > 0 && outlines[0] && outlines[0].length > 0) {
      if (!isValidPoint(outlines[0][0])) {
        outlines = null
      }
    } else {
      outlines = null
    }
  } catch (e) {
    console.warn('geom2ToCrossSection: toOutlines failed:', e.message)
    outlines = null
  }

  // Approach 2: Direct outlines property
  if (!outlines && geom.outlines && geom.outlines.length > 0) {
    outlines = geom.outlines
  }

  // Approach 3: Build from sides manually
  if (!outlines && geom.sides && geom.sides.length > 0) {
    outlines = buildOutlinesFromSides(geom.sides, geom.transforms)
  }

  if (!outlines || outlines.length === 0) {
    console.warn('geom2ToCrossSection: no valid outlines found, returning empty CrossSection')
    return new CrossSection()
  }

  // Filter and convert to CrossSection format
  const contours = outlines
    .filter(outline => Array.isArray(outline) && outline.length >= 3)
    .map(outline => {
      return outline
        .filter(isValidPoint)
        .map(point => [point[0], point[1]])
    })
    .filter(contour => contour.length >= 3)

  if (contours.length === 0) {
    console.warn('geom2ToCrossSection: no valid contours after filtering, returning empty CrossSection')
    return new CrossSection()
  }

  try {
    return new CrossSection(contours)
  } catch (e) {
    console.warn('geom2ToCrossSection: CrossSection construction failed:', e.message)
    return new CrossSection()
  }
}

/**
 * Build outlines from sides format.
 * Sides are [start, end] pairs that form closed loops.
 */
const buildOutlinesFromSides = (sides, transforms) => {
  if (!sides || sides.length === 0) return []

  const applyTransform = (point) => {
    if (!transforms) return [point[0], point[1]]
    const x = transforms[0] * point[0] + transforms[4] * point[1] + transforms[12]
    const y = transforms[1] * point[0] + transforms[5] * point[1] + transforms[13]
    return [x, y]
  }

  const pointKey = (p) => `${p[0].toFixed(9)},${p[1].toFixed(9)}`
  const pointsEqual = (a, b) => pointKey(a) === pointKey(b)

  const outlines = []
  const usedSides = new Set()

  for (let i = 0; i < sides.length; i++) {
    if (usedSides.has(i)) continue

    const outline = []
    const currentSide = sides[i]
    if (!currentSide || !currentSide[0] || !currentSide[1]) {
      usedSides.add(i)
      continue
    }

    const startPoint = applyTransform(currentSide[0])
    outline.push(startPoint)
    usedSides.add(i)

    let currentEnd = applyTransform(currentSide[1])
    outline.push(currentEnd)

    // Follow the chain of sides
    let found = true
    let iterations = 0
    const maxIterations = sides.length + 1

    while (found && iterations < maxIterations) {
      iterations++
      found = false
      for (let j = 0; j < sides.length; j++) {
        if (usedSides.has(j)) continue
        const side = sides[j]
        if (!side || !side[0] || !side[1]) continue

        const sideStart = applyTransform(side[0])
        if (pointsEqual(sideStart, currentEnd)) {
          currentEnd = applyTransform(side[1])
          if (!pointsEqual(currentEnd, startPoint)) {
            outline.push(currentEnd)
          }
          usedSides.add(j)
          found = true
          break
        }
      }
    }

    if (outline.length >= 3) {
      outlines.push(outline)
    }
  }

  return outlines
}

/**
 * Convert a Manifold CrossSection to a JSCAD geom2.
 *
 * @param {Object} crossSection - Manifold CrossSection object
 * @returns {Object} JSCAD geom2 geometry
 */
export const crossSectionToGeom2 = (crossSection) => {
  const contours = crossSection.toPolygons()
  const sides = []
  const outlines = []

  for (const contour of contours) {
    // Build outline (array of [x, y] points)
    const outline = contour.map(point => [point[0], point[1]])
    outlines.push(outline)

    // Build sides ([start, end] pairs)
    for (let i = 0; i < contour.length; i++) {
      const start = contour[i]
      const end = contour[(i + 1) % contour.length]
      sides.push([[start[0], start[1]], [end[0], end[1]]])
    }
  }

  return {
    sides,
    outlines,
    transforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }
}

export default {
  geom3ToManifold,
  manifoldToGeom3,
  geom2ToCrossSection,
  crossSectionToGeom2
}
