import { footprint, holeLoops } from '../probe.js'

// A NEMA 17 bolts to a square of M3 holes 31mm apart in both axes (the
// "holes" column of NopSCADlib's stepper_motors.scad and the SCREW_SPACING
// row of BOSL2's nema_steppers.scad agree), around a centre boss for the body.
const AXES = ['x', 'y', 'z']
const FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]

const STEPPER_SOURCE = /(?:require\(['"]|include\s*<)(?:_catalog\/)?(?:NopSCADlib|BOSL2)\/[^'">]*(?:stepper|nema)/i

// Holes a z-axis cut sees, grouped by (x, y) position with the narrowest width kept.
const zHoles = (sections) => {
  const holes = new Map()
  for (const s of sections.filter((s) => s.axis === 'z')) {
    for (const h of holeLoops(s)) {
      const [narrow] = footprint(h, 'z')
      const cx = (h.boundingBox[0][0] + h.boundingBox[1][0]) / 2
      const cy = (h.boundingBox[0][1] + h.boundingBox[1][1]) / 2
      const key = `${Math.round(cx)},${Math.round(cy)}`
      const prev = holes.get(key)
      if (!prev || narrow < prev.narrow) holes.set(key, { narrow, cx, cy })
    }
  }
  return [...holes.values()]
}

// Four holes read as an axis-aligned square when both spans are the pitch and
// two holes sit on each low edge, not three bunched on one side.
const isSquarePitch = (corners, pitch = 31, tol = 0.3) => {
  if (corners.length !== 4) return false
  const xs = corners.map((c) => c.cx)
  const ys = corners.map((c) => c.cy)
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)]
  if (Math.abs(maxX - minX - pitch) > tol || Math.abs(maxY - minY - pitch) > tol) return false
  return xs.filter((x) => Math.abs(x - minX) < 1).length === 2 && ys.filter((y) => Math.abs(y - minY) < 1).length === 2
}

export const fixture = {
  name: 'nema17-mount',
  prompt: 'A mounting plate for a NEMA 17 stepper motor with M3 screws holding the motor on',
  requires: ['measure', 'write'],
  verifyBeforeWrite: true,
  maxTurns: 12,
  probe: { sections: AXES.map((axis) => ({ axis, at: FRACTIONS })) },
  checks: (m, { solid, probe, source } = {}) => {
    const holes = zHoles(probe?.sections ?? [])
    const corners = holes.filter((h) => h.narrow >= 3.2 && h.narrow <= 3.6)
    const centre = holes.find((h) => h.narrow >= 22)
    return [
      { name: 'requires a catalog stepper', pass: STEPPER_SOURCE.test(source ?? '') },
      { name: 'four M3 holes on a 31mm square', pass: isSquarePitch(corners) },
      { name: 'a centre hole at least 22mm wide for the boss', pass: !!centre },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
