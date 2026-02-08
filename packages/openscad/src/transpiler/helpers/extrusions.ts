/**
 * Extrusion helper generation
 */

import type { TranspileContext } from '../context.js'

/**
 * Build extrusion helpers based on usage
 */
export function buildExtrusionHelpers(ctx: TranspileContext): string[] {
  const imports: string[] = []

  // Linear extrude helper - uses extrudeFromSlices when scale is used (extrudeLinear ignores scale)
  if (ctx.usedExtrusions.has('extrudeLinear')) {
    imports.push(`
const _linearExtrude = ({ height, center = false, twist = 0, slices, scale = 1, segments, $fn = 0 }, geo) => {
  // Normalize scale to [x, y] array
  const scaleArr = Array.isArray(scale) ? scale : [scale, scale]
  const needsScale = scaleArr[0] !== 1 || scaleArr[1] !== 1

  // Calculate number of steps (slices along Z axis)
  let steps
  if (slices !== undefined) {
    steps = Math.max(1, Math.ceil(slices))
  } else if (twist !== 0) {
    // Auto-calculate for twist: ~6° per step for smooth result
    steps = $fn > 0 ? $fn : Math.max(1, Math.ceil(Math.abs(twist) / 6))
  } else if (needsScale) {
    // Need steps for smooth taper
    steps = 16
  } else {
    steps = 1
  }

  let result
  if (needsScale || twist !== 0) {
    // Use extrudeFromSlices for scale/twist support
    // Negate twist: OpenSCAD uses clockwise (right-hand rule), JSCAD uses counter-clockwise
    const twistRad = -twist * Math.PI / 180
    let sides = geom2.toSides(geo)

    // Subdivide edges for smoother twist (OpenSCAD's segments parameter)
    // Default: subdivide based on twist angle to get ~30° per segment per edge
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

    const baseSlice = _jscadSlice.fromSides(sides)

    const callback = (progress, index, base) => {
      const angle = twistRad * progress
      const sx = 1 + (scaleArr[0] - 1) * progress
      const sy = 1 + (scaleArr[1] - 1) * progress
      const z = height * progress

      const m = mat4.create()
      mat4.translate(m, m, [0, 0, z])
      mat4.rotateZ(m, m, angle)
      mat4.scale(m, m, [sx, sy, 1])

      return _jscadSlice.transform(m, baseSlice)
    }

    result = extrudeFromSlices({ numberOfSlices: steps + 1, callback }, geo)
  } else {
    // Simple extrusion without scale or twist
    result = extrudeLinear({ height }, geo)
  }

  return center ? translate([0, 0, -height/2], result) : result
}`)
  }

  // Rotate extrude helper - uses 360/$fa = 30 segments by default
  if (ctx.usedExtrusions.has('extrudeRotate')) {
    imports.push(`
const _rotateExtrude = ({ angle = 360, $fn = 0, $fa = 12 }, geo) => {
  // Calculate full-circle segments from $fn or $fa
  const fullCircleSegments = $fn > 0 ? $fn : (_globalFn > 0 ? _globalFn : Math.ceil(360 / $fa))
  // Scale segments proportionally to the angle (OpenSCAD uses ceil, not round)
  const segments = Math.max(1, Math.ceil(fullCircleSegments * angle / 360))
  const opts = { segments }
  if (angle !== 360) { opts.angle = angle * Math.PI / 180 }
  return extrudeRotate(opts, geo)
}`)
  }

  return imports
}
