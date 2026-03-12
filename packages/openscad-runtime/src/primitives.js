/**
 * Primitive wrapper helpers for OpenSCAD compatibility
 * These wrap JSCAD primitives to match OpenSCAD semantics
 */

import { _num } from './math.js'
import { _getSegments } from './segments.js'

// JSCAD primitives and transforms - injected at init time
let cube, cuboid, cylinder, circle, rectangle, polygon, polyhedron, translate, union, subtract, intersect, hull, minkowski

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
  const radius1 = rr1 ?? (dd1 ? dd1/2 : (rr ?? (dd ? dd/2 : 1)))
  const radius2 = rr2 ?? (dd2 ? dd2/2 : (rr ?? (dd ? dd/2 : 1)))
  const segments = _getSegments(Math.max(radius1, radius2), $fn, $fa, $fs)
  const geo = cylinder({ height, startRadius: radius1, endRadius: radius2, segments })
  return center ? geo : translate([0, 0, height/2], geo)
}

export const _sphere = ({ r, d, $fn = 0, $fa, $fs }) => {
  const rr = _num(r), dd = _num(d)
  const radius = rr ?? (dd ? dd/2 : 1)
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
  const faceList = faces || triangles || []
  // Filter out any invalid faces (undefined or non-array elements)
  const validFaces = faceList.filter(f => Array.isArray(f))

  // OpenSCAD silently promotes 2D points to 3D by adding Z=0
  const points3d = points && points[0] && points[0].length === 2
    ? points.map(p => [p[0], p[1], 0])
    : points

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

  return polyhedron({ points: points3d, faces: finalFaces, orientation: 'outward' })
}

export const _safeUnion = (parts) => {
  // Flatten nested arrays and filter out undefined/null values
  // This handles cases where children return empty arrays or nested undefined values
  const flattened = parts.flat(Infinity)

  // Check if any element is a Promise (async children thunks, e.g. from text())
  const hasPromise = flattened.some(p => p instanceof Promise || (p && typeof p.then === 'function'))
  if (hasPromise) {
    // Resolve all Promises then union
    return Promise.all(flattened.map(p => Promise.resolve(p))).then(resolved => {
      const valid = resolved.filter(p => p !== undefined && p !== null)
      if (valid.length === 0) return undefined
      if (valid.length === 1) return valid[0]
      return union(...valid)
    })
  }

  const valid = flattened.filter(p => p !== undefined && p !== null)
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  return union(...valid)
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
 * Polygon wrapper - normalizes winding order for JSCAD compatibility.
 *
 * OpenSCAD accepts polygons in any winding order; JSCAD requires CCW for solid
 * outer boundaries and CW for holes. Without normalization, CW outer paths
 * produce inverted normals when extruded (inside-out geometry).
 */
export const _polygon = ({ points, paths }) => {
  if (paths && paths.length > 0) {
    // First path = outer boundary (must be CCW); remaining paths = holes (must be CW).
    const normalizedPaths = paths.map((path, idx) => {
      const pathPts = path.map(i => points[i])
      const area = _signedArea(pathPts)
      const shouldBeCCW = idx === 0
      if ((shouldBeCCW && area < 0) || (!shouldBeCCW && area > 0)) {
        return [...path].reverse()
      }
      return path
    })
    return polygon({ points, paths: normalizedPaths })
  }
  // Single boundary: ensure CCW (positive area) so extrudeLinear produces correct normals.
  const area = _signedArea(points)
  if (area < 0) {
    return polygon({ points: [...points].reverse() })
  }
  return polygon({ points })
}

// Hull wrapper - passes through to JSCAD hull
export const _hull = (...args) => hull(...args)

// Boolean wrappers - these filter undefined values and call JSCAD booleans
export const _union = (...args) => {
  const valid = args.filter(a => a !== undefined && a !== null)
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  return union(...valid)
}

export const _subtract = (...args) => {
  const valid = args.filter(a => a !== undefined && a !== null)
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  return subtract(...valid)
}

export const _intersect = (...args) => {
  const valid = args.filter(a => a !== undefined && a !== null)
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  return intersect(...valid)
}

export const _minkowski = (...args) => {
  const valid = args.filter(a => a !== undefined && a !== null)
  if (valid.length < 2) return valid[0] || undefined
  return minkowski(...valid)
}
