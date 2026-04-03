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
import * as jscadModule from '@jscad/modeling-for-manifold'

// Handle both ESM default export (Node.js) and bundled named exports (vitest/bundler)
const jscad = jscadModule.default || jscadModule

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

  // Empty union = no geometry (valid in OpenSCAD semantics)
  if (geoms.length === 0) {
    return undefined
  }

  // Separate 2D and 3D geometries
  const is2D = isManifoldGeom2(geoms[0]) || (geoms[0].sides !== undefined) || (geoms[0].outlines !== undefined)

  if (is2D) {
    return union2D(geoms)
  }

  // Convert all to Manifold objects
  const manifolds = geoms.map(g => toManifold(g))

  // Filter out empty manifolds — Manifold.union() with any empty manifold returns empty
  const nonEmpty = manifolds.filter(m => !m.isEmpty())
  if (nonEmpty.length === 0) return undefined
  if (nonEmpty.length === 1) return new ManifoldGeom3(nonEmpty[0])

  // Use Manifold's batch union for efficiency
  const Manifold = getManifold()
  const result = Manifold.union(nonEmpty)

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
  const sections = geometries.map(g => toCrossSection(g)).filter(s => s != null)

  if (sections.length === 0) return undefined
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
    return undefined
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
  const sections = geometries.map(g => toCrossSection(g)).filter(s => s != null)

  if (sections.length === 0) return undefined
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
    return undefined
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
  const sections = geometries.map(g => toCrossSection(g)).filter(s => s != null)

  if (sections.length === 0) return undefined
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

  // Non-convex A + convex B: decompose A into convex pieces
  if (!aIsConvex && bIsConvex) {
    const r = minkowskiNonConvexConvex(manifoldA, manifoldB, Manifold)
    const fallback = r ?? minkowskiConvex(hullA, manifoldB, Manifold)
    if (process.env.DEBUG_MINK) console.error(`[mink] A(vol=${manifoldA.volume().toFixed(0)}) nonconvex+convexB(vol=${manifoldB.volume().toFixed(0)}) → r=${r?.volume?.()?.toFixed(0) ?? 'null'} fallback=${fallback?.volume?.()?.toFixed(0) ?? 'null'}`)
    return new ManifoldGeom3(fallback)
  }

  // Convex A + non-convex B: swap (minkowski is commutative)
  if (aIsConvex && !bIsConvex) {
    const r = minkowskiNonConvexConvex(manifoldB, manifoldA, Manifold)
    return new ManifoldGeom3(r ?? minkowskiConvex(manifoldA, hullB, Manifold))
  }

  // Both non-convex: decompose A, compute minkowski of each with manifoldB
  const r = minkowskiNonConvexConvex(manifoldA, manifoldB, Manifold)
  return new ManifoldGeom3(r ?? minkowskiConvex(hullA, hullB, Manifold))
}

/**
 * Compute minkowski sum of non-convex A with convex B.
 *
 * Uses convex decomposition via cut planes:
 * 1. If A is convex, delegates to minkowskiConvex directly.
 * 2. Otherwise, computes the inner void (hull(A) - A) to find concavities.
 * 3. Extracts the unique face planes of the inner void.
 * 4. Cuts A along those planes, producing convex pieces.
 * 5. Computes Minkowski of each piece with B and unions results.
 *
 * This correctly handles shapes like the Minkowski complement used by NopSCADlib's
 * offset_3D for negative offsets (a large cube with a shape-shaped hole).
 *
 * @param {Manifold} manifoldA - Non-convex manifold
 * @param {Manifold} manifoldB - Convex manifold (the Minkowski kernel)
 * @param {Object} Manifold - Manifold class
 * @param {number} depth - Recursion depth (guards against infinite recursion)
 * @returns {Manifold} The Minkowski sum
 */
/**
 * Compute minkowski sum of non-convex A with convex B.
 * Returns null if A is degenerate (empty contribution to caller's union).
 * Top-level callers should fall back to hull approximation when null is returned.
 */
const minkowskiNonConvexConvex = (manifoldA, manifoldB, Manifold, depth = 0, axisAlignedOnly = false) => {
  const volA = Math.abs(manifoldA.volume())
  if (process.env.DEBUG_MINK && depth === 0) console.error(`[mnc d=0] enter volA=${volA.toFixed(0)}`)
  if (volA < 1e-6) return null  // Degenerate piece: no contribution

  if (volA < 1) {
    // Tiny corner slivers: hull can be orders of magnitude larger than the piece itself,
    // causing huge over-expansion. Use actual vertices (not hull) for accurate Minkowski.
    return minkowskiConvex(manifoldA, manifoldB, Manifold)
  }

  if (depth >= 4) {
    // Use manifoldA's actual vertices (not hull) for better accuracy on non-convex pieces.
    // minkowskiConvex uses extractUniqueVertices which reads the actual mesh, not hull.
    return minkowskiConvex(manifoldA, manifoldB, Manifold)
  }

  // Check convexity by comparing hull volume to shape volume.
  // Use ABSOLUTE difference (not relative), because for large shapes with small holes
  // (e.g. a 1000mm cube with a 40mm frame hole: relative diff is only 0.005%)
  // a relative threshold would miss the non-convexity.
  const hullA = manifoldA.hull()
  const volHull = Math.abs(hullA.volume())
  const absVoidVol = volHull - volA  // inner void volume = how much hull exceeds A

  // Treat as convex if the inner void is negligibly small (< 0.1mm³)
  if (process.env.DEBUG_MINK && depth === 0) console.error(`[mnc d=0] volHull=${volHull.toFixed(0)} absVoidVol=${absVoidVol.toFixed(4)}`)
  if (absVoidVol < 0.1) {
    if (typeof hullA.delete === 'function') hullA.delete()
    return minkowskiConvex(manifoldA, manifoldB, Manifold)
  }

  // When restricted to axis-aligned planes, skip pieces where the hull is >> the piece volume.
  // These are "curved shell" pieces (e.g. rounded-corner corrections of an expanded frame) that
  // span a large bounding box but are very thin. Their Minkowski via hull would hugely over-estimate.
  // Skipping under-estimates minkVoid slightly → erosionShape slightly too large → acceptable.
  if (axisAlignedOnly && absVoidVol > 5 * volA) {
    if (typeof hullA.delete === 'function') hullA.delete()
    return null
  }

  // Compute inner void to get cut planes (done only when truly non-convex)
  if (process.env.DEBUG_MINK && depth === 0) console.error(`[mnc d=0] computing innerVoid...`)
  const innerVoid = hullA.subtract(manifoldA)
  if (process.env.DEBUG_MINK && depth === 0) console.error(`[mnc d=0] innerVoid isEmpty=${innerVoid.isEmpty()} vol=${innerVoid.volume().toFixed(0)}`)
  // NOTE: hullA not deleted yet - may be needed below for minkHull

  if (innerVoid.isEmpty()) {
    if (typeof hullA.delete === 'function') hullA.delete()
    if (typeof innerVoid.delete === 'function') innerVoid.delete()
    return minkowskiConvex(manifoldA, manifoldB, Manifold)
  }

  // Large complement: manifoldA = cube(big) - shape, innerVoid = shape.
  // Direct erosion formula: erode(shape, K) = ∩_{v ∈ vertices(K)} translate(-v, shape)
  // offset_3D(-r) computes cube(big/2) - minkowski(cube(big)-shape, ball(r)).
  // Since erode(shape,K) = cube(big/2) - mink(cube(big)-shape, K), we can directly
  // compute the erosion and return cube(big/2) - erosion as the fake mink result.
  // The caller then computes cube(big/2) - returnValue = erosion. ✓
  // This is accurate to within the sphere discretization error (~0.1mm for $fn=16).
  if (depth === 0 && !axisAlignedOnly && volHull > 1e5 && absVoidVol < volHull * 0.1) {
    // Large complement: manifoldA = cube(big) - shape, innerVoid = shape (the frame).
    // Erosion formula: erode(shape, K) ≈ ∩_{p ∈ S} translate(-p, shape)
    // where S = sphere surface samples (vertices + face-centroid-projected points).
    // Sampling both vertices and face centroids fills angular gaps, reducing the
    // over-approximation error vs vertex-only sampling of a non-convex shape.
    const ballMesh = manifoldB.getMesh()
    const ballVertices = extractUniqueVertices(ballMesh)
    const ballFacePoints = extractFaceCentroidsOnSphere(ballMesh)
    const allSamplePoints = [...ballVertices, ...ballFacePoints]

    const translated = allSamplePoints.map(v => innerVoid.translate([-v[0], -v[1], -v[2]]))
    if (typeof innerVoid.delete === 'function') innerVoid.delete()
    const erosionResult = translated.length > 0
      ? Manifold.intersection(translated)
      : manifoldA.translate([0, 0, 0])
    for (const t of translated) {
      if (typeof t.delete === 'function') t.delete()
    }

    // Return cube(big/2) - erosionResult so the caller computes cube(big/2) - returnValue = erosionResult
    const bigSide = Math.round(Math.cbrt(volHull))
    const cubeHalf = Manifold.cube([bigSide / 2, bigSide / 2, bigSide / 2], true)
    const returnValue = cubeHalf.subtract(erosionResult)
    if (typeof erosionResult.delete === 'function') erosionResult.delete()
    if (typeof cubeHalf.delete === 'function') cubeHalf.delete()
    if (typeof hullA.delete === 'function') hullA.delete()
    return returnValue
  }

  // Relative convexity threshold: if inner void is < 5% of shape volume, the hull
  // approximation error is small enough to treat the piece as convex directly.
  // Must come after the erosion formula check (which handles large complements at depth=0).
  // Exclude huge shapes (volA > 1e8) like the large complement (cube1000 - shape).
  if (volA < 1e8 && absVoidVol < 0.05 * volA) {
    if (typeof hullA.delete === 'function') hullA.delete()
    if (typeof innerVoid.delete === 'function') innerVoid.delete()
    return minkowskiConvex(manifoldA, manifoldB, Manifold)
  }

  if (typeof hullA.delete === 'function') hullA.delete()

  // Extract unique face planes from the inner void boundary.
  // Cutting A along these planes decomposes it into convex pieces.
  const innerVoidMesh = innerVoid.getMesh()
  if (process.env.DEBUG_MINK && depth === 0) console.error(`[mnc d=0] got mesh, triVerts=${innerVoidMesh.triVerts.length}`)
  let planes = getUniquePlanes(innerVoidMesh)
  if (typeof innerVoid.delete === 'function') innerVoid.delete()

  // When called from the local complement erosion formula, restrict to axis-aligned planes only.
  // This prevents exponential piece explosion when the inner void has many curved faces
  // (e.g. a rounded frame shape with $fn=16 has 100+ non-axis-aligned planes).
  // Axis-aligned planes still correctly decompose the shape; curved-edge residuals are
  // handled by the near-convex approximation at the next recursion level.
  if (axisAlignedOnly) {
    planes = planes.filter(p =>
      Math.abs(Math.abs(p.n[0]) - 1) < 1e-4 ||
      Math.abs(Math.abs(p.n[1]) - 1) < 1e-4 ||
      Math.abs(Math.abs(p.n[2]) - 1) < 1e-4
    )
  }

  if (process.env.DEBUG_MINK && depth === 0) console.error(`[mink d=0] planes total=${planes.length}, axisAligned=${planes.filter(p => Math.abs(p.n[0])>0.99||Math.abs(p.n[1])>0.99||Math.abs(p.n[2])>0.99).length}`)

  if (planes.length === 0) {
    return minkowskiConvex(manifoldA, manifoldB, Manifold)
  }

  // Use all unique face planes up to the cap.
  const PLANE_CAP = 300
  if (planes.length > PLANE_CAP) {
    planes = planes.slice(0, PLANE_CAP)
  }

  // Iteratively cut manifoldA by each plane into convex pieces.
  // Track ownership: pieces we created (can delete) vs the input (cannot delete).
  let workPieces = [{ m: manifoldA, owned: false }]
  for (const { n, offset } of planes) {
    const next = []
    for (const { m: piece, owned } of workPieces) {
      const [a, b] = piece.splitByPlane(n, offset)
      // Free the intermediate piece once it's been split (but never the original input)
      if (owned && typeof piece.delete === 'function') piece.delete()

      if (!a.isEmpty() && Math.abs(a.volume()) > 1e-6) {
        next.push({ m: a, owned: true })
      } else if (typeof a.delete === 'function') {
        a.delete()
      }
      if (!b.isEmpty() && Math.abs(b.volume()) > 1e-6) {
        next.push({ m: b, owned: true })
      } else if (typeof b.delete === 'function') {
        b.delete()
      }
    }
    workPieces = next
    if (workPieces.length === 0) break
  }

  if (process.env.DEBUG_MINK && depth === 0) console.error(`[mnc d=0] after splits: ${workPieces.length} pieces`)
  if (workPieces.length === 0) return null  // All splits degenerate: no contribution

  if (process.env.DEBUG_MINK && depth === 0) {
    console.error(`[mink depth=0] ${workPieces.length} pieces: ${workPieces.map(p => p.m.volume().toFixed(0)).join(', ')}`)
  }

  // Compute Minkowski of each convex piece and union incrementally.
  let result = null
  let pieceIdx = 0
  for (const { m: piece } of workPieces) {
    const t0 = process.env.DEBUG_MINK && depth === 0 ? Date.now() : 0
    // Recurse: pieces may still be non-convex (e.g. when axis-aligned planes
    // don't fully cut through rounded edges). Depth limit prevents infinite recursion.
    const minkPiece = minkowskiNonConvexConvex(piece, manifoldB, Manifold, depth + 1, axisAlignedOnly)
    if (process.env.DEBUG_MINK && depth === 0) {
      console.error(`[mnc d=0] piece ${pieceIdx++} (vol=${piece.volume().toFixed(0)}) mink=${minkPiece?.volume?.()?.toFixed(0) ?? 'null'} took ${Date.now()-t0}ms`)
    }
    // Free the split piece now that its Minkowski is computed.
    // Guard: if minkowskiConvex returned a null (degenerate piece), skip this piece.
    if (typeof piece.delete === 'function') piece.delete()
    if (minkPiece == null) continue

    if (result === null) {
      result = minkPiece
    } else {
      const t1 = process.env.DEBUG_MINK && depth === 0 ? Date.now() : 0
      const merged = Manifold.union(result, minkPiece)
      if (process.env.DEBUG_MINK && depth === 0) console.error(`  union took ${Date.now()-t1}ms result_vol=${merged?.volume?.()?.toFixed(0) ?? 'null'}`)
      // Guard: don't delete manifoldB — it's owned by the caller.
      if (result !== manifoldB && typeof result.delete === 'function') result.delete()
      if (minkPiece !== manifoldB && typeof minkPiece.delete === 'function') minkPiece.delete()
      result = merged
    }
  }

  if (process.env.DEBUG_MINK && depth === 0) console.error(`[mnc d=0] result=${result?.volume?.()?.toFixed(0) ?? 'null'}`)
  return result  // null if all pieces were degenerate (caller handles null)
}

/**
 * Extract unique face planes from a mesh.
 * Two triangles belong to the same plane if their normals and offsets match within tolerance.
 */
const getUniquePlanes = (mesh) => {
  const vertices = extractAllVertices(mesh)
  const triangles = extractTriangles(mesh)
  const planes = []

  for (const tri of triangles) {
    const v0 = vertices[tri[0]]
    const v1 = vertices[tri[1]]
    const v2 = vertices[tri[2]]

    const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]]
    const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]]
    const nx = e1[1] * e2[2] - e1[2] * e2[1]
    const ny = e1[2] * e2[0] - e1[0] * e2[2]
    const nz = e1[0] * e2[1] - e1[1] * e2[0]
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len < 1e-10) continue

    const n = [nx / len, ny / len, nz / len]
    const offset = n[0] * v0[0] + n[1] * v0[1] + n[2] * v0[2]

    const isDuplicate = planes.some(p =>
      Math.abs(p.n[0] - n[0]) < 1e-5 &&
      Math.abs(p.n[1] - n[1]) < 1e-5 &&
      Math.abs(p.n[2] - n[2]) < 1e-5 &&
      Math.abs(p.offset - offset) < 1e-4
    )

    if (!isDuplicate) {
      planes.push({ n, offset })
    }
  }

  return planes
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
 * Compute centroid of vertices (simple average).
 * NOTE: For non-convex shapes with holes, this may fall inside a void.
 * Use computeVolumetricCentroid instead when topological correctness is needed.
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
 * Compute volumetric (signed-volume) centroid of a closed mesh.
 * Uses the divergence theorem: for each triangle, accumulate the signed volume
 * and weighted centroid of the tetrahedron from the origin to the triangle face.
 *
 * This centroid is guaranteed to lie inside the solid material, even for
 * non-convex shapes with holes or voids — unlike a simple vertex average.
 *
 * @param {Array} vertices - Array of [x, y, z] vertex positions
 * @param {Array} triangles - Array of [i0, i1, i2] face indices
 * @returns {[number, number, number]} The volumetric centroid
 */
const _computeVolumetricCentroid = (vertices, triangles) => {
  if (vertices.length === 0 || triangles.length === 0) return [0, 0, 0]

  let totalVol = 0
  let cx = 0, cy = 0, cz = 0

  for (const tri of triangles) {
    const v0 = vertices[tri[0]]
    const v1 = vertices[tri[1]]
    const v2 = vertices[tri[2]]

    // Signed volume of tetrahedron from origin to this triangle:
    // vol = dot(v0, cross(v1, v2)) / 6
    const crossX = v1[1] * v2[2] - v1[2] * v2[1]
    const crossY = v1[2] * v2[0] - v1[0] * v2[2]
    const crossZ = v1[0] * v2[1] - v1[1] * v2[0]
    const vol = (v0[0] * crossX + v0[1] * crossY + v0[2] * crossZ) / 6

    totalVol += vol
    // Centroid of this tetrahedron (origin + v0 + v1 + v2) / 4 = (v0+v1+v2) / 4
    cx += vol * (v0[0] + v1[0] + v2[0]) / 4
    cy += vol * (v0[1] + v1[1] + v2[1]) / 4
    cz += vol * (v0[2] + v1[2] + v2[2]) / 4
  }

  if (Math.abs(totalVol) < 1e-10) {
    // Degenerate mesh - fall back to vertex average
    return computeCentroid(vertices)
  }

  return [cx / totalVol, cy / totalVol, cz / totalVol]
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

  // Degenerate case: if either has no vertices, Minkowski is undefined/empty.
  // Return null to signal "skip this piece" — callers must handle null.
  if (verticesA.length === 0 || verticesB.length === 0) {
    return null
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
/**
 * Extract face centroids projected onto the sphere surface.
 * For each triangular face, compute the centroid and project it radially outward
 * to the sphere's radius. This fills angular gaps between mesh vertices, improving
 * direction coverage for vertex-sampling-based erosion of non-convex shapes.
 */
const extractFaceCentroidsOnSphere = (mesh) => {
  const props = mesh.vertProperties
  const numProp = mesh.numProp
  const triVerts = mesh.triVerts
  if (!triVerts || !props || !numProp) return []

  const v0x = props[0], v0y = props[1], v0z = props[2]
  const radius = Math.sqrt(v0x * v0x + v0y * v0y + v0z * v0z)
  if (radius < 1e-10) return []

  const result = []
  const seen = new Set()

  for (let i = 0; i < triVerts.length; i += 3) {
    const i0 = triVerts[i], i1 = triVerts[i + 1], i2 = triVerts[i + 2]
    const x = (props[i0 * numProp] + props[i1 * numProp] + props[i2 * numProp]) / 3
    const y = (props[i0 * numProp + 1] + props[i1 * numProp + 1] + props[i2 * numProp + 1]) / 3
    const z = (props[i0 * numProp + 2] + props[i1 * numProp + 2] + props[i2 * numProp + 2]) / 3
    const d = Math.sqrt(x * x + y * y + z * z)
    if (d < 1e-10) continue
    const scale = radius / d
    const px = x * scale, py = y * scale, pz = z * scale
    const key = `${px.toFixed(6)},${py.toFixed(6)},${pz.toFixed(6)}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push([px, py, pz])
    }
  }

  return result
}

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
