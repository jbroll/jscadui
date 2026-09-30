import { outerLoops } from '../probe.js'
import { apart } from './sliding-lid-box.js'

// A computed profile twice over: two gears whose tooth counts, module and
// spacing must agree, meshed or laid out side by side.
const AXES = ['x', 'y', 'z']
const THROUGH = [0.1, 0.25, 0.5, 0.75, 0.9]

// The toothed cut of a body across its thinnest direction: the outline with the most lobes.
const gearOf = (body) => {
  const axis = AXES[body.dimensions.indexOf(Math.min(...body.dimensions))]
  const outlines = body.sections.filter((s) => s.axis === axis).map((s) => outerLoops(s)[0]).filter(Boolean)
  const best = outlines.sort((a, b) => b.lobes - a.lobes)[0]
  if (!best || best.lobes < 6) return null
  return { axis, teeth: best.lobes, tip: 2 * best.radius[1], centre: best.centroid }
}

export const fixture = {
  name: 'spur-gears',
  group: 'harder',
  prompt: 'a pair of spur gears, 20 and 40 teeth, that mesh',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 10,
  probe: { bodies: { sections: AXES.map((axis) => ({ axis, at: THROUGH, outline: true })), overlaps: true } },
  checks: (m, { solid, probe } = {}) => {
    const gears = (probe?.bodies ?? []).map(gearOf).filter(Boolean).sort((a, b) => a.teeth - b.teeth)
    const [small, large] = [gears.find((g) => g.teeth === 20), gears.find((g) => g.teeth === 40)]
    const pair = Boolean(small && large)
    // Tip diameters differ by module x 20 whatever addendum both share.
    const module = pair ? (large.tip - small.tip) / 20 : 0
    const addendum = pair ? (small.tip - 20 * module) / 2 : 0
    const distance = pair ? Math.hypot(...small.centre.map((c, k) => c - large.centre[k])) : 0
    const engaged = pair && small.axis === large.axis && distance < (small.tip + large.tip) / 2
    return [
      { name: 'two gears', pass: gears.length >= 2 },
      { name: '20 and 40 teeth', pass: pair },
      { name: 'same module', pass: module > 0 && addendum >= 0.5 * module && addendum <= 1.5 * module },
      { name: 'meshed at the pitch distance, or laid out apart', pass: pair && module > 0 && (!engaged || Math.abs(distance - 30 * module) <= 1.5 * module) },
      { name: 'parts do not overlap', pass: Boolean(probe) && apart(probe) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
