/**
 * Extrusion helpers for OpenSCAD compatibility
 */

import { _globalFn } from './segments.js'

// JSCAD extrusions and utilities - injected at init time
let extrudeLinear, extrudeRotate, extrudeFromSlices, translate, geom2, slice, mat4

export const initExtrusions = (jscad) => {
  extrudeLinear = jscad.extrusions.extrudeLinear
  extrudeRotate = jscad.extrusions.extrudeRotate
  extrudeFromSlices = jscad.extrusions.extrudeFromSlices
  translate = jscad.transforms.translate
  geom2 = jscad.geometries.geom2
  // slice is under extrusions in the Manifold runtime, but under geometries in standard JSCAD
  slice = jscad.extrusions?.slice || jscad.geometries?.slice
  mat4 = jscad.maths.mat4
}

// Linear extrude helper - uses extrudeFromSlices when scale is used
export const _linearExtrude = ({ height, center = false, twist = 0, slices, scale = 1, segments, $fn = 0 }, geo) => {
  // Normalize scale to [x, y] array
  const scaleArr = Array.isArray(scale) ? scale : [scale, scale]
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
export const _rotateExtrude = ({ angle = 360, $fn = 0, $fa = 12 }, geo) => {
  const fullCircleSegments = $fn > 0 ? $fn : (_globalFn > 0 ? _globalFn : Math.ceil(360 / $fa))
  const segments = Math.max(1, Math.ceil(fullCircleSegments * angle / 360))
  const opts = { segments }
  if (angle !== 360) { opts.angle = angle * Math.PI / 180 }
  return extrudeRotate(opts, geo)
}
