/**
 * Extrusion helpers for OpenSCAD compatibility
 */

import { _globalFn, _getSegments } from './segments.js'
import { NO_CHILD } from './primitives.js'

// JSCAD extrusions and utilities - injected at init time
let extrudeLinear, extrudeRotate, extrudeFromSlices, translate, mirror, geom2, slice, mat4, subtract, union

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
  subtract = jscad.booleans.subtract
  union = jscad.booleans.union
}

// Linear extrude helper - uses extrudeFromSlices when scale is used
export const _linearExtrude = ({ height, center = false, twist = 0, slices, scale = 1, segments, $fn = 0, $fa = 12, $fs = 2 }, geo) => {
  // Propagate absent child (NO_CHILD = conditional branch not taken)
  if (geo === NO_CHILD) return NO_CHILD
  // Return undefined for empty/missing geometry to avoid degenerate extrusions
  if (!geo) return undefined
  // ManifoldGeom2 has 'crossSection' — delegate directly to Manifold's native extrudeLinear.
  // For twist with multi-outline (shapes with holes), fall through to JSCAD extrudeFromSlices
  // which handles hole subtraction more accurately for twisted extrusions.
  if (geo.crossSection !== undefined) {
    // Check for multi-outline + twist: fall through to JSCAD path for better accuracy
    let hasMultipleContours = false
    if (twist !== 0) {
      try {
        const cs = geo.crossSection
        if (cs && typeof cs.toPolygons === 'function') {
          hasMultipleContours = cs.toPolygons().length > 1
        }
      } catch (_) { /* fall through to Manifold path */ }
    }
    if (!hasMultipleContours) {
      let twistSteps
      if (twist !== 0) {
        twistSteps = slices !== undefined
          ? Math.max(1, Math.ceil(slices))
          : Math.max(1, Math.ceil(Math.abs(twist) * _getSegments(1, $fn, $fa, $fs) / 360))
      }
      // Negate twist: OpenSCAD twist convention is opposite to Manifold's
      const result = extrudeLinear({ height, twistAngle: -twist * Math.PI / 180, twistSteps, scale, $fa, $fs }, geo)
      return center ? translate([0, 0, -height / 2], result) : result
    }
  }
  // Only check toSides for standard JSCAD geom2 (has 'outlines' property).
  if (geo.outlines !== undefined && geom2.toSides(geo).length === 0) return undefined
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
    steps = Math.max(1, Math.ceil(Math.abs(twist) * _getSegments(1, $fn, $fa, $fs) / 360))
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

    // Extrude one outline (CCW array of [x,y] points) as a 3D solid
    const extrudeOneSolid = (outline, segsPerEdge) => {
      let sides = outline.map((p, i) => [p, outline[(i + 1) % outline.length]])

      // For multi-outline rings, OpenSCAD's CDT triangulation adds edge splits before extrusion.
      if (twist !== 0 && segsPerEdge !== undefined) {
        if (segsPerEdge > 1) {
          const subdividedSides = []
          for (const [p0, p1] of sides) {
            for (let i = 0; i < segsPerEdge; i++) {
              const t0 = i / segsPerEdge
              const t1 = (i + 1) / segsPerEdge
              subdividedSides.push([
                [p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0],
                [p0[0] + (p1[0] - p0[0]) * t1, p0[1] + (p1[1] - p0[1]) * t1]
              ])
            }
          }
          sides = subdividedSides
        }
      }

      const baseSlice = slice.fromSides(sides)
      const baseGeo = geom2.create(sides)
      return extrudeFromSlices({ numberOfSlices: steps + 1, callback: (progress) => {
        const m = mat4.create()
        mat4.translate(m, m, [0, 0, height * progress])
        mat4.rotateZ(m, m, twistRad * progress)
        mat4.scale(m, m, [1 + (scaleArr[0] - 1) * progress, 1 + (scaleArr[1] - 1) * progress, 1])
        return slice.transform(m, baseSlice)
      }}, baseGeo)
    }

    // For multi-outline geometries (shapes with holes) extruded with twist, extrudeFromSlices
    // inflates volume when applied to the combined outline set. Instead, extrude each outline
    // separately and subtract holes from the outer solid.
    // Scale-only multi-outline extrusions work fine with whole-geo extrudeFromSlices.
    const outlines = geom2.toOutlines(geo)
    if (outlines.length > 1 && twist !== 0) {
      // Compute signed area to determine winding (positive = CCW = outer, negative = CW = hole)
      const signedArea = (outline) => {
        let a = 0
        for (let i = 0; i < outline.length; i++) {
          const p0 = outline[i], p1 = outline[(i + 1) % outline.length]
          a += p0[0] * p1[1] - p1[0] * p0[1]
        }
        return a
      }
      // Classify outlines: positive area = CCW outer, negative area = CW inner hole
      const classified = outlines.map(o => ({ outline: o, area: signedArea(o) }))

      // OpenSCAD formula: segsPerEdge = max(1, floor(circleSegs / maxEdgesPerPoly))
      // circleSegs uses $fa/$fs (NOT $fn) with the polygon's estimated circumradius.
      // This matches OpenSCAD's CDT pre-subdivision for twisted multi-contour extrusions.
      const maxEdges = Math.max(...outlines.map(o => o.length))
      const circumR = Math.max(...outlines.flatMap(o => o.map(p => Math.sqrt(p[0] * p[0] + p[1] * p[1]))))
      const circleSegs = _getSegments(circumR, 0, $fa, $fs)
      const segsPerEdge = segments !== undefined
        ? Math.max(1, segments)
        : Math.max(1, Math.floor(circleSegs / maxEdges))

      let solid = null
      for (const { outline, area } of classified) {
        if (area > 0) {
          // CCW = outer: extrude and union with other outers
          const extruded = extrudeOneSolid(outline, segsPerEdge)
          solid = solid ? union(solid, extruded) : extruded
        } else {
          // CW = inner hole: reverse to CCW, extrude, then subtract
          const reversed = outline.slice().reverse()
          const extruded = extrudeOneSolid(reversed, segsPerEdge)
          if (solid) solid = subtract(solid, extruded)
        }
      }
      result = solid
    } else {
      // Single outline: use all sides together (original approach)
      let sides = geom2.toSides(geo)

      // OpenSCAD does not subdivide edges for single-outline twisted extrusions.
      // Only subdivide when caller explicitly provides a segments count.
      if (twist !== 0 && segments !== undefined) {
        const segsPerEdge = Math.max(1, segments)
        if (segsPerEdge > 1) {
          const subdividedSides = []
          for (const [p0, p1] of sides) {
            for (let i = 0; i < segsPerEdge; i++) {
              const t0 = i / segsPerEdge
              const t1 = (i + 1) / segsPerEdge
              subdividedSides.push([
                [p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0],
                [p0[0] + (p1[0] - p0[0]) * t1, p0[1] + (p1[1] - p0[1]) * t1]
              ])
            }
          }
          sides = subdividedSides
        }
      }

      const baseSlice = slice.fromSides(sides)
      result = extrudeFromSlices({ numberOfSlices: steps + 1, callback: (progress) => {
        const m = mat4.create()
        mat4.translate(m, m, [0, 0, height * progress])
        mat4.rotateZ(m, m, twistRad * progress)
        mat4.scale(m, m, [1 + (scaleArr[0] - 1) * progress, 1 + (scaleArr[1] - 1) * progress, 1])
        return slice.transform(m, baseSlice)
      }}, geo)
    }
  } else {
    result = extrudeLinear({ height }, geo)
  }

  return center ? translate([0, 0, -height/2], result) : result
}

// Rotate extrude helper
export const _rotateExtrude = ({ angle = 360, $fn, $fa, $fs } = {}, geo) => {
  // Propagate absent child (NO_CHILD = conditional branch not taken)
  if (geo === NO_CHILD) return NO_CHILD
  // Return undefined for empty/missing geometry to avoid degenerate extrusions
  // that break subsequent boolean operations
  if (!geo) return undefined
  // Only call toSides for standard JSCAD geom2; ManifoldGeom2 has 'crossSection' not 'outlines'
  const sides = geo.outlines !== undefined ? geom2.toSides(geo) : []
  if (sides.length === 0 && geo.outlines !== undefined) return undefined
  const absAngle = Math.abs(angle)

  // Compute max X (outer radius) of the 2D profile for segment calculation.
  // OpenSCAD uses the profile radius in: numFragments = max(5, ceil(min(360/$fa, 2π*r/$fs)))
  // Use absolute X values: negative-X profiles (e.g. after rotate([0,0,90])) are reflected
  // to positive X by extrudeRotate, so the effective radius is |X|.
  let maxX = 0
  for (const [p0, p1] of sides) {
    if (Math.abs(p0[0]) > maxX) maxX = Math.abs(p0[0])
    if (Math.abs(p1[0]) > maxX) maxX = Math.abs(p1[0])
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
