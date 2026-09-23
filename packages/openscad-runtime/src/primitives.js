/**
 * Primitive wrapper helpers for OpenSCAD compatibility
 * These wrap JSCAD primitives to match OpenSCAD semantics
 */

import { _num } from './math.js'
import { _getSegments } from './segments.js'

/**
 * Sentinel for "no child produced by a conditional branch".
 * `if(cond) child` with cond=false and no else branch emits j$.NO_CHILD.
 * Distinct from undefined (which means "module/geometry produced nothing").
 * In intersection: NO_CHILD is absent (skipped); undefined makes intersection empty.
 */
export const NO_CHILD = Symbol('no_child')

// JSCAD primitives and transforms - injected at init time
let cube, cuboid, cylinder, circle, rectangle, polygon, polyhedron, translate, union, subtract, intersect, hull, minkowski, geom2

export const initPrimitives = (jscad) => {
  cube = jscad.primitives.cube
  cuboid = jscad.primitives.cuboid
  cylinder = jscad.primitives.cylinder
  circle = jscad.primitives.circle
  rectangle = jscad.primitives.rectangle
  polygon = jscad.primitives.polygon
  polyhedron = jscad.primitives.polyhedron
  translate = jscad.transforms.translate
  union = jscad.booleans.union
  subtract = jscad.booleans.subtract
  intersect = jscad.booleans.intersect
  hull = jscad.hulls.hull
  minkowski = jscad.booleans.minkowski
  geom2 = jscad.geometries?.geom2
}

export const _cube = ({ size, center = false }) => {
  const s = Array.isArray(size)
    ? size.map(v => _num(v) ?? 1)
    : [_num(size) ?? 1, _num(size) ?? 1, _num(size) ?? 1]
  const geo = s[0] === s[1] && s[1] === s[2] ? cube({ size: s[0] }) : cuboid({ size: s })
  return center ? geo : translate([s[0]/2, s[1]/2, s[2]/2], geo)
}

export const _cylinder = ({ h, r, r1, r2, d, d1, d2, center = false, $fn = 0, $fa, $fs }) => {
  const height = _num(h) ?? 1
  const rr = _num(r), dd = _num(d), rr1 = _num(r1), rr2 = _num(r2), dd1 = _num(d1), dd2 = _num(d2)
  const radius1 = rr1 ?? (dd1 != null ? dd1/2 : (rr ?? (dd != null ? dd/2 : 1)))
  const radius2 = rr2 ?? (dd2 != null ? dd2/2 : (rr ?? (dd != null ? dd/2 : 1)))
  // OpenSCAD: cylinder with negative radius is empty geometry
  if (radius1 < 0 || radius2 < 0 || isNaN(radius1) || isNaN(radius2)) return undefined
  const segments = _getSegments(Math.max(radius1, radius2), $fn, $fa, $fs)
  const geo = cylinder({ height, startRadius: radius1, endRadius: radius2, segments })
  return center ? geo : translate([0, 0, height/2], geo)
}

export const _sphere = ({ r, d, $fn = 0, $fa, $fs }) => {
  const rr = _num(r), dd = _num(d)
  const radius = rr ?? (dd ? dd/2 : 1)
  // OpenSCAD: sphere with negative radius is empty geometry
  if (radius < 0 || isNaN(radius)) return undefined
  const fn = _getSegments(radius, $fn, $fa, $fs)
  const numRings = Math.floor((fn + 1) / 2)
  const points = []
  const faces = []

  // Generate ring vertices (no poles - matches OpenSCAD)
  for (let i = 0; i < numRings; i++) {
    const phi = (180 * (i + 0.5)) / numRings * Math.PI / 180
    const z = radius * Math.cos(phi)
    const ringR = radius * Math.sin(phi)
    for (let j = 0; j < fn; j++) {
      const theta = 2 * Math.PI * j / fn
      points.push([ringR * Math.cos(theta), ringR * Math.sin(theta), z])
    }
  }

  // Top cap: triangulate first ring as polygon
  for (let j = 1; j < fn - 1; j++) faces.push([0, j, j + 1])

  // Body: quads between adjacent rings
  for (let i = 0; i < numRings - 1; i++) {
    const ring = i * fn, nextRing = (i + 1) * fn
    for (let j = 0; j < fn; j++) {
      const next = (j + 1) % fn
      faces.push([ring + j, nextRing + j, ring + next])
      faces.push([ring + next, nextRing + j, nextRing + next])
    }
  }

  // Bottom cap: triangulate last ring as polygon
  const lastRing = (numRings - 1) * fn
  for (let j = 1; j < fn - 1; j++) faces.push([lastRing, lastRing + j + 1, lastRing + j])

  return polyhedron({ points, faces, orientation: 'outward' })
}

export const _circle = ({ r, d, $fn = 0, $fa, $fs }) => {
  const rr = _num(r), dd = _num(d)
  const radius = rr ?? (dd ? dd/2 : 1)
  // OpenSCAD circle(r=0) creates a degenerate point used in hull() to anchor corners.
  // JSCAD circle(radius=0) returns empty geometry (no sides), losing the hull anchor.
  // Return a tiny centered square so hull() treats it as a point at origin.
  if (radius <= 0) return rectangle({ size: [0.0001, 0.0001] })
  const segments = _getSegments(radius, $fn, $fa, $fs)
  return circle({ radius, segments })
}

export const _square = ({ size, center = false }) => {
  const s = Array.isArray(size)
    ? size.map(v => _num(v) ?? 1)
    : [_num(size) ?? 1, _num(size) ?? 1]
  const geo = rectangle({ size: s })
  return center ? geo : translate([s[0]/2, s[1]/2], geo)
}

export const _regular_polygon = ({ order = 6, n, r = 1, $fn: _$fn = 0 }) => {
  const sides = _num(n) ?? _num(order) ?? 6
  const radius = _num(r) ?? 1
  return circle({ radius, segments: sides })
}

export const _polyhedron = ({ points, faces, triangles, convexity: _convexity }) => {
  if (!points || !Array.isArray(points) || points.length === 0) return undefined
  const faceList = faces || triangles || []
  // Filter out any invalid faces (undefined or non-array elements)
  const validFaces = faceList.filter(f => Array.isArray(f))
  if (validFaces.length === 0) return undefined

  // Filter out invalid points (undefined, null, non-array) — replace with [0,0,0]
  // to preserve face indexing
  const cleanPoints = points.map(p => Array.isArray(p) ? p : [0, 0, 0])

  // OpenSCAD silently promotes 2D points to 3D by adding Z=0
  const points3d = cleanPoints[0] && cleanPoints[0].length === 2
    ? cleanPoints.map(p => [p[0], p[1], 0])
    : cleanPoints

  // Determine winding convention by computing signed volume (divergence theorem).
  // Outward-pointing normals → positive signed volume; inward → negative.
  // OpenSCAD's polyhedron accepts either winding convention, but JSCAD needs outward normals.
  // Different BOSL2 code paths generate faces with different winding:
  // - rotate_sweep/sweep traverses angles in decreasing order → inward normals
  // - direct vnf_vertex_array with increasing angles → outward normals
  let signedVol = 0
  for (const face of validFaces) {
    const p0 = points3d[face[0]]
    for (let i = 1; i < face.length - 1; i++) {
      const p1 = points3d[face[i]]
      const p2 = points3d[face[i + 1]]
      // Contribution: p0 · (p1 × p2) for divergence theorem
      signedVol += p0[0] * (p1[1] * p2[2] - p2[1] * p1[2])
               + p0[1] * (p1[2] * p2[0] - p2[2] * p1[0])
               + p0[2] * (p1[0] * p2[1] - p2[0] * p1[1])
    }
  }

  // Reverse faces if they have inward normals (negative signed volume),
  // so JSCAD receives consistently outward-facing geometry.
  const finalFaces = signedVol < 0
    ? validFaces.map(f => [...f].reverse())
    : validFaces

  try {
    return polyhedron({ points: points3d, faces: finalFaces, orientation: 'outward' })
  } catch (_e) {
    // OpenSCAD silently ignores polyhedron errors in preview mode
    return undefined
  }
}

const _isAbsent = (p) => p === undefined || p === null || p === NO_CHILD

/**
 * OpenSCAD takes a group's dimensionality from its first child and ignores the
 * siblings that do not match ("Ignoring 3D child object for 2D operation"),
 * where @jscad/modeling's union throws on the mix. A `if($preview)` overlay
 * beside a 3D model is the common way to hit it.
 */
const _sameDimensionAsFirst = (parts) => {
  // `in`, not a read: on ManifoldGeom2 these are getters that convert the
  // whole cross-section.
  const is2D = (p) => p !== null && typeof p === 'object' && ('sides' in p || 'outlines' in p)
  const first2D = is2D(parts[0])
  return parts.every((p) => is2D(p) === first2D) ? parts : parts.filter((p) => is2D(p) === first2D)
}

const _unionPresent = (parts) => {
  const valid = parts.filter(p => !_isAbsent(p))
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  const same = _sameDimensionAsFirst(valid)
  if (same.length === 1) return same[0]
  return union(...same.map(withoutDegeneratePolygons))
}

export const _safeUnion = (parts) => {
  // Flatten nested arrays and filter out undefined/null/NO_CHILD values
  // This handles cases where children return empty arrays or nested undefined values
  const flattened = parts.flat(Infinity)

  // Check if any element is a Promise (async children thunks, e.g. from text())
  const hasPromise = flattened.some(p => p instanceof Promise || (p && typeof p.then === 'function'))
  if (hasPromise) return Promise.all(flattened).then(_unionPresent)
  return _unionPresent(flattened)
}

// Re-export direct JSCAD primitives for passthrough
export const getPolygon = () => polygon

/**
 * Compute the signed area of a polygon (shoelace formula).
 * Positive = CCW, Negative = CW.
 */
const _signedArea = (pts) => {
  let area = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i][0] * pts[j][1]
    area -= pts[j][0] * pts[i][1]
  }
  return area / 2
}

/**
 * Point-in-polygon test using ray casting.
 * Returns true if point [px, py] is inside the polygon defined by pts.
 */
const _pointInPolygon = (px, py, pts) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1]
    const xj = pts[j][0], yj = pts[j][1]
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Compute centroid of polygon.
 */
const _centroid = (pts) => {
  let cx = 0, cy = 0
  for (const p of pts) { cx += p[0]; cy += p[1] }
  return [cx / pts.length, cy / pts.length]
}

/**
 * Build 2D geometry from an array of path-data objects using the even-odd fill rule.
 *
 * OpenSCAD's polygon() and region() both use even-odd fill:
 * - Depth-0 paths (outermost): solid
 * - Depth-1 paths (inside one outer): holes
 * - Depth-2 paths (inside a hole): solid again (re-inclusion)
 * - etc.
 *
 * Implements this by finding each path's immediate parent (smallest containing path)
 * to build a containment tree, then recursively applying:
 *   node geometry = polygon(node) - union(children) + union(grandchildren subtrees)
 *
 * @param {Array<{pts: number[][], area: number, centroid: number[]}>} pathData
 * @returns {geom2 | undefined}
 */
const _buildEvenOddGeom = (pathData) => {
  if (pathData.length === 0) return undefined

  if (pathData.length === 1) {
    const { pts, area } = pathData[0]
    const ccwPts = area < 0 ? [...pts].reverse() : pts
    try { return polygon({ points: ccwPts }) } catch (_e) { return undefined }
  }

  // Find immediate parent for each path:
  // immediate parent = smallest-area path that contains this path's centroid.
  // Process in descending area order so containers are discovered before contained.
  const sortedIdx = pathData.map((_, i) => i)
    .sort((a, b) => Math.abs(pathData[b].area) - Math.abs(pathData[a].area))

  const immediateParent = new Array(pathData.length).fill(-1)
  for (let ii = 1; ii < sortedIdx.length; ii++) {
    const i = sortedIdx[ii]
    let bestParent = -1
    let bestArea = Infinity
    for (let jj = 0; jj < ii; jj++) {
      const j = sortedIdx[jj]
      if (!_pointInPolygon(pathData[i].centroid[0], pathData[i].centroid[1], pathData[j].pts)) continue
      if (Math.abs(pathData[j].area) < bestArea) {
        bestArea = Math.abs(pathData[j].area)
        bestParent = j
      }
    }
    immediateParent[i] = bestParent
  }

  const makePolygon = (pts) => {
    const area = _signedArea(pts)
    const ccwPts = area < 0 ? [...pts].reverse() : pts
    try { return polygon({ points: ccwPts }) } catch (_e) { return undefined }
  }

  // Recursively build even-odd geometry for a subtree:
  // - This node is solid
  // - Direct children are holes (subtracted)
  // - Grandchildren are islands (unioned back)
  const buildSubtree = (idx) => {
    let geom = makePolygon(pathData[idx].pts)
    if (!geom) return undefined

    const children = pathData.map((_, i) => i).filter(i => immediateParent[i] === idx)
    if (children.length === 0) return geom

    const childPolygons = children.map(c => makePolygon(pathData[c].pts)).filter(Boolean)
    if (childPolygons.length > 0) {
      const holeUnion = childPolygons.length === 1 ? childPolygons[0] : union(...childPolygons)
      geom = subtract(geom, holeUnion)
    }

    // Add back grandchildren subtrees (even-odd re-inclusion)
    for (const child of children) {
      const grandchildren = pathData.map((_, i) => i).filter(i => immediateParent[i] === child)
      for (const gc of grandchildren) {
        const gcGeom = buildSubtree(gc)
        if (gcGeom) geom = union(geom, gcGeom)
      }
    }

    return geom
  }

  const roots = pathData.map((_, i) => i).filter(i => immediateParent[i] === -1)
  if (roots.length === 0) return undefined

  const rootGeoms = roots.map(buildSubtree).filter(Boolean)
  if (rootGeoms.length === 0) return undefined
  if (rootGeoms.length === 1) return rootGeoms[0]
  return union(...rootGeoms)
}

/**
 * Polygon wrapper - normalizes winding order for JSCAD compatibility.
 *
 * OpenSCAD accepts polygons in any winding order; JSCAD requires CCW for solid
 * outer boundaries and CW for holes. For multiple paths, applies the even-odd
 * fill rule using a containment tree (see _buildEvenOddGeom).
 */
export const _polygon = ({ points, paths }) => {
  // OpenSCAD silently ignores degenerate polygons; don't throw.
  if (!points || points.length < 3) return undefined
  if (paths && paths.length > 0) {
    if (paths.length === 1) {
      // Single path: ensure CCW
      const pathPts = paths[0].map(i => points[i])
      const area = _signedArea(pathPts)
      if (area < 0) return polygon({ points, paths: [[...paths[0]].reverse()] })
      return polygon({ points, paths })
    }

    // Build path data and delegate to even-odd containment tree
    const pathData = paths.map(path => {
      const pts = path.map(i => points[i])
      return { pts, area: _signedArea(pts), centroid: _centroid(pts) }
    })
    return _buildEvenOddGeom(pathData)
  }
  // Single boundary: ensure CCW (positive area) so extrudeLinear produces correct normals.
  const area = _signedArea(points)
  if (area < 0) {
    return polygon({ points: [...points].reverse() })
  }
  return polygon({ points })
}

/**
 * Region module - creates 2D geometry from a BOSL2 region (list of polygon paths).
 * Each path is a list of 2D [x,y] points forming a closed contour.
 * Applies the even-odd fill rule via _buildEvenOddGeom.
 */
export const _region = ({ r } = {}) => {
  if (!r || !Array.isArray(r) || r.length === 0) return undefined
  const validPaths = r.filter(p => Array.isArray(p) && p.length >= 3)
  if (validPaths.length === 0) return undefined
  const pathData = validPaths.map(pts => ({
    pts,
    area: _signedArea(pts),
    centroid: _centroid(pts),
  }))
  return _buildEvenOddGeom(pathData)
}

// Hull wrapper - filter absent/null/undefined geometry.
// OpenSCAD hull() with no valid children produces nothing; JSCAD throws.
// NOTE: Do NOT short-circuit for valid.length === 1. OpenSCAD hull() computes the
// convex hull even of a single (non-convex) child; returning it directly would skip
// that convexification and break models like BOSL cyl() with fillets.
export const _hull = (...args) => {
  const valid = args.filter(a => !_isAbsent(a))
  if (valid.length === 0) return undefined
  return hull(...valid)
}

/**
 * Drop polygons with fewer than three vertices.
 *
 * The jscad engine's own booleans emit them when a split lands on a
 * near-coincident pair. They carry no plane, so the next boolean to take them
 * as input throws inside plane.fromPoints. Only plain geom3 objects are
 * touched: a Manifold geometry exposes `polygons` as a getter that would
 * convert the whole mesh to read it.
 */
export const withoutDegeneratePolygons = (geometry) => {
  if (!geometry || !Object.hasOwn(geometry, 'polygons') || !Array.isArray(geometry.polygons)) return geometry
  const polygons = geometry.polygons.filter(p => p?.vertices?.length >= 3)
  return polygons.length === geometry.polygons.length ? geometry : { ...geometry, polygons }
}

// Boolean wrappers - these filter absent/undefined values and call JSCAD booleans
// NO_CHILD = conditional branch not taken (absent) → always filtered out
// undefined/null = module/geometry produced nothing (empty geometry)
export const _union = (...args) => {
  const valid = args.filter(a => !_isAbsent(a))
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  return union(...valid.map(withoutDegeneratePolygons))
}

export const _subtract = (...args) => {
  const valid = args.filter(a => !_isAbsent(a))
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  const same = _sameDimensionAsFirst(valid)
  if (same.length === 1) return same[0]
  return subtract(...same.map(withoutDegeneratePolygons))
}

export const _intersect = (...args) => {
  // NO_CHILD (conditional branch not taken) → absent, skip
  // undefined/null (module returned empty geometry) → intersection is empty
  const withoutAbsent = args.filter(a => a !== NO_CHILD)
  if (withoutAbsent.some(a => a === undefined || a === null)) return undefined
  if (withoutAbsent.length === 0) return undefined
  if (withoutAbsent.length === 1) return withoutAbsent[0]
  const same = _sameDimensionAsFirst(withoutAbsent)
  if (same.length === 1) return same[0]
  return intersect(...same.map(withoutDegeneratePolygons))
}

// Own property, not the prototype getter a Manifold geometry exposes: that
// engine has its own 2D minkowski and must keep it.
const _isJscadGeom2 = (g) => g !== null && typeof g === 'object' && Object.prototype.hasOwnProperty.call(g, 'sides')

/** Signed area of a ring; its sign is the winding. */
const _ringArea = (ring) => {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

const _isConvexRing = (ring) => {
  let sign = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], r = ring[(i + 2) % ring.length]
    const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])
    if (cross === 0) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Minkowski sum of two 2D geometries, for a convex second operand.
 *
 * Sweeping a convex shape along a segment covers exactly the hull of the shape
 * at both ends, so the sum is that hull over every side of the first operand,
 * unioned with the operand itself. That last part needs the origin to lie
 * inside the swept shape, so it is recentred on its centroid and the result
 * translated back — the sum commutes with translation.
 *
 * The union of the translated copies at the convex shape's vertices, which the
 * manifold engine uses, is not the same thing: it leaves gaps wherever the
 * first operand is thinner than the second's edges.
 */
const _minkowski2D = (a, b) => {
  const ring = geom2.toOutlines(b).sort((x, y) => Math.abs(_ringArea(y)) - Math.abs(_ringArea(x)))[0]
  if (!ring || ring.length < 3) return a
  if (!_isConvexRing(ring)) throw new Error('2D minkowski needs one convex operand')

  const cx = ring.reduce((t, p) => t + p[0], 0) / ring.length
  const cy = ring.reduce((t, p) => t + p[1], 0) / ring.length
  const centred = translate([-cx, -cy], b)

  const pieces = [a]
  for (const [p, q] of geom2.toSides(a)) {
    pieces.push(hull(translate([p[0], p[1]], centred), translate([q[0], q[1]], centred)))
  }
  return translate([cx, cy], union(...pieces))
}

export const _minkowski = (...args) => {
  const valid = args.filter(a => a !== undefined && a !== null && a !== NO_CHILD)
  if (valid.length < 2) return valid[0] || undefined
  if (valid.every(_isJscadGeom2)) {
    // Either operand may be the convex one, and the sum is symmetric.
    return valid.reduce((acc, next) => {
      const bRing = geom2.toOutlines(next)[0]
      return bRing && _isConvexRing(bRing) ? _minkowski2D(acc, next) : _minkowski2D(next, acc)
    })
  }
  return minkowski(...valid)
}
