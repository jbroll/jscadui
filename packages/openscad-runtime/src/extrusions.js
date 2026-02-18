/**
 * Extrusion helpers for OpenSCAD compatibility
 */

import { _globalFn, _getSegments } from './segments.js'

// JSCAD extrusions and utilities - injected at init time
let extrudeLinear, extrudeRotate, extrudeFromSlices, translate, mirror, geom2, slice, mat4

export const initExtrusions = (jscad) => {
  extrudeLinear = jscad.extrusions.extrudeLinear
  extrudeRotate = jscad.extrusions.extrudeRotate
  extrudeFromSlices = jscad.extrusions.extrudeFromSlices
  translate = jscad.transforms.translate
  mirror = jscad.transforms.mirror
  geom2 = jscad.geometries.geom2
  // slice is under extrusions in the Manifold runtime, but under geometries in standard JSCAD
  slice = jscad.extrusions?.slice || jscad.geometries?.slice
  mat4 = jscad.maths.mat4
}

// Linear extrude helper - uses extrudeFromSlices when scale is used
export const _linearExtrude = ({ height, center = false, twist = 0, slices, scale = 1, segments, $fn = 0 }, geo) => {
  // Return undefined for empty/missing geometry to avoid degenerate extrusions
  if (!geo || geom2.toSides(geo).length === 0) return undefined
  // Normalize scale to [x, y] array
  // Clamp near-zero scale values to avoid degenerate zero-area polygons in extrudeFromSlices
  const rawScaleArr = Array.isArray(scale) ? scale : [scale, scale]
  const SCALE_MIN = 0.001
  const scaleArr = rawScaleArr.map(s => (Math.abs(s) < SCALE_MIN ? (s < 0 ? -SCALE_MIN : SCALE_MIN) : s))
  const needsScale = scaleArr[0] !== 1 || scaleArr[1] !== 1

  // Calculate number of steps (slices along Z axis)
  let steps
  if (slices !== undefined) {
    steps = Math.max(1, Math.ceil(slices))
  } else if (twist !== 0) {
    steps = $fn > 0 ? $fn : Math.max(1, Math.ceil(Math.abs(twist) / 6))
  } else if (needsScale) {
    steps = 16
  } else {
    steps = 1
  }

  let result
  if (needsScale || twist !== 0) {
    // Use extrudeFromSlices for scale/twist support
    // Negate twist: OpenSCAD uses clockwise, JSCAD uses counter-clockwise
    const twistRad = -twist * Math.PI / 180
    let sides = geom2.toSides(geo)

    // Subdivide edges for smoother twist
    if (twist !== 0) {
      const segsPerEdge = segments !== undefined ? Math.max(1, segments) : Math.max(1, Math.ceil(Math.abs(twist) / 30))
      if (segsPerEdge > 1) {
        const subdividedSides = []
        for (const [p0, p1] of sides) {
          for (let i = 0; i < segsPerEdge; i++) {
            const t0 = i / segsPerEdge
            const t1 = (i + 1) / segsPerEdge
            const start = [p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0]
            const end = [p0[0] + (p1[0] - p0[0]) * t1, p0[1] + (p1[1] - p0[1]) * t1]
            subdividedSides.push([start, end])
          }
        }
        sides = subdividedSides
      }
    }

    const baseSlice = slice.fromSides(sides)

    const callback = (progress, _index, _base) => {
      const angle = twistRad * progress
      const sx = 1 + (scaleArr[0] - 1) * progress
      const sy = 1 + (scaleArr[1] - 1) * progress
      const z = height * progress

      const m = mat4.create()
      mat4.translate(m, m, [0, 0, z])
      mat4.rotateZ(m, m, angle)
      mat4.scale(m, m, [sx, sy, 1])

      return slice.transform(m, baseSlice)
    }

    result = extrudeFromSlices({ numberOfSlices: steps + 1, callback }, geo)
  } else {
    result = extrudeLinear({ height }, geo)
  }

  return center ? translate([0, 0, -height/2], result) : result
}

// Rotate extrude helper
export const _rotateExtrude = ({ angle = 360, $fn, $fa, $fs } = {}, geo) => {
  // Return undefined for empty/missing geometry to avoid degenerate extrusions
  // that break subsequent boolean operations
  const sides = geom2.toSides(geo)
  if (!geo || sides.length === 0) return undefined
  const absAngle = Math.abs(angle)

  // Compute max X (outer radius) of the 2D profile for segment calculation.
  // OpenSCAD uses the profile radius in: numFragments = max(5, ceil(min(360/$fa, 2π*r/$fs)))
  let maxX = 0
  for (const [p0, p1] of sides) {
    if (p0[0] > maxX) maxX = p0[0]
    if (p1[0] > maxX) maxX = p1[0]
  }

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
