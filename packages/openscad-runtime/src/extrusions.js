/**
 * Extrusion helpers for OpenSCAD compatibility
 */

import { _getSegments } from './segments.js'
import { NO_CHILD, _is2D, _polyhedron } from './primitives.js'
import { linearExtrudeParams, linearExtrudeMesh } from './linearExtrude.js'
import { consuming } from './consume.js'

// JSCAD extrusions and utilities - injected at init time
let extrudeLinear, extrudeMesh, extrudeRotate, translate, mirror, geom2, slice

export const initExtrusions = (jscad) => {
  extrudeLinear = consuming(jscad.extrusions.extrudeLinear)
  extrudeRotate = consuming(jscad.extrusions.extrudeRotate)
  extrudeMesh = consuming((p, geo) => {
    const mesh = linearExtrudeMesh(p, geom2.toOutlines(geo), slice)
    return mesh ? _polyhedron(mesh) : undefined
  })
  translate = consuming(jscad.transforms.translate)
  mirror = consuming(jscad.transforms.mirror)
  geom2 = jscad.geometries.geom2
  // slice is under extrusions in the Manifold runtime, but under geometries in standard JSCAD
  slice = jscad.extrusions?.slice || jscad.geometries?.slice
}

// Sides of a native v2 geom2 ({ sides }) or a ManifoldGeom2 (sides/outlines getters), transforms
// applied; undefined for anything else. Moving to v3 geom2 ({ outlines }) only changes this function.
const profileSides = (geo) =>
  geo.sides !== undefined || geo.outlines !== undefined ? geom2.toSides(geo) : undefined

/**
 * linear_extrude. A plain extrusion (no twist, unit scale, straight up) goes to
 * the engine's extrudeLinear; anything else is built as OpenSCAD builds it
 * (linearExtrude.js) and handed over as a polyhedron.
 */
export const _linearExtrude = (args, geo) => {
  // Propagate absent child (NO_CHILD = conditional branch not taken)
  if (geo === NO_CHILD) return NO_CHILD
  // Return undefined for empty/missing geometry to avoid degenerate extrusions
  if (!geo) return undefined
  // A lone 3D child: OpenSCAD ignores it ("Ignoring 3D child object for 2D operation")
  if (!_is2D(geo)) return undefined
  if (profileSides(geo)?.length === 0) return undefined
  const p = linearExtrudeParams(args)
  const [vx, vy, height] = p.vector
  if (height <= 0) return undefined

  if (p.twist === 0 && p.scaleX === 1 && p.scaleY === 1 && vx === 0 && vy === 0) {
    const result = extrudeLinear({ height }, geo)
    return p.center ? translate([0, 0, -height / 2], result) : result
  }

  return extrudeMesh(p, geo)
}

const _isZeroArea = (sides) => {
  let area = 0
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [p0, p1] of sides) {
    area += p0[0] * p1[1] - p1[0] * p0[1]
    minX = Math.min(minX, p0[0], p1[0])
    maxX = Math.max(maxX, p0[0], p1[0])
    minY = Math.min(minY, p0[1], p1[1])
    maxY = Math.max(maxY, p0[1], p1[1])
  }
  const extent = Math.max(maxX - minX, maxY - minY)
  return Math.abs(area / 2) <= 1e-9 * extent * extent
}

// Rotate extrude helper
export const _rotateExtrude = ({ angle = 360, $fn, $fa, $fs } = {}, geo) => {
  // Propagate absent child (NO_CHILD = conditional branch not taken)
  if (geo === NO_CHILD) return NO_CHILD
  // Return undefined for empty/missing geometry to avoid degenerate extrusions
  // that break subsequent boolean operations
  if (!geo) return undefined
  // A lone 3D child: OpenSCAD ignores it ("Ignoring 3D child object for 2D operation")
  if (!_is2D(geo)) return undefined
  const sides = profileSides(geo)
  if (sides?.length === 0) return undefined
  const absAngle = Math.abs(angle)

  // Compute max X (outer radius) of the 2D profile for segment calculation.
  // OpenSCAD uses the profile radius in: numFragments = max(5, ceil(min(360/$fa, 2π*r/$fs)))
  // Use absolute X values: negative-X profiles (e.g. after rotate([0,0,90])) are reflected
  // to positive X by extrudeRotate, so the effective radius is |X|.
  let maxX = 0
  for (const [p0, p1] of sides ?? []) {
    if (Math.abs(p0[0]) > maxX) maxX = Math.abs(p0[0])
    if (Math.abs(p1[0]) > maxX) maxX = Math.abs(p1[0])
  }

  // A profile collapsed to a point or a line still has sides, so the
  // empty-profile guard above lets it through, and extrudeRotate either throws
  // on the empty slice or returns zero-volume polygons. OpenSCAD revolves a
  // zero-area profile to nothing.
  if (sides && _isZeroArea(sides)) return undefined

  // _getSegments handles priority: explicit $fn arg > scope $fn > globalFn > $fa/$fs formula
  // Using undefined defaults so scope stack values are used when not explicitly set
  const fullCircleSegments = _getSegments(maxX, $fn, $fa, $fs)
  // Use abs(angle) for segment count; minimum 3 (JSCAD requirement)
  const segments = Math.max(3, Math.ceil(fullCircleSegments * absAngle / 360))
  const opts = { segments }
  if (absAngle !== 360) { opts.angle = absAngle * Math.PI / 180 }
  const result = extrudeRotate(opts, geo)
  // Negative angle = clockwise rotation. Achieved by mirroring about XZ plane (negate Y).
  // This is mathematically equivalent: rotate_extrude(-θ, S) = mirror_xz(rotate_extrude(+θ, S))
  // JSCAD's mirror() reverses polygon winding, preserving correct outward normals.
  return angle < 0 ? mirror({ normal: [0, 1, 0] }, result) : result
}
