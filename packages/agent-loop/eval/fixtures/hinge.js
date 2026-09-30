import { footprint, holeLoops, outerLoops } from '../probe.js'
import { apart } from './sliding-lid-box.js'

// Two leaves and a pin as three parts: none overlaps another, and the pin
// turns in the knuckles' bore with clearance.
const FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
const AXES = ['x', 'y', 'z']

const round = ([u, v]) => Math.abs(u - v) <= 0.1 * Math.max(u, v)

// How rod-like a body is: its longest size over the next, 0 unless its two smaller sizes are about equal.
const slenderness = (body) => {
  const [a, b, c] = [...body.dimensions].sort((p, q) => p - q)
  return a >= 0.8 * b ? c / b : 0
}

// The shaft: the narrowest round cut along the pin's length, so a head is left out.
const shaftOf = (pin) => {
  const axis = AXES[pin.dimensions.indexOf(Math.max(...pin.dimensions))]
  const cuts = pin.sections.filter((s) => s.axis === axis).flatMap((s) => outerLoops(s).map((l) => footprint(l, axis)))
  return cuts.filter(round).sort((p, q) => p[0] - q[0])[0] ?? null
}

const boresOf = (body) => body.sections.flatMap((s) => holeLoops(s).map((l) => footprint(l, s.axis))).filter(round)

const clearance = (shaft, bore) => shaft.every((d, k) => (bore[k] - d) / 2 > 0.02 && (bore[k] - d) / 2 <= 1)

export const fixture = {
  name: 'hinge',
  group: 'harder',
  prompt: 'a hinge: two knuckle leaves and a pin',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { bodies: { sections: AXES.map((axis) => ({ axis, at: FRACTIONS })), overlaps: true } },
  checks: (m, { solid, probe } = {}) => {
    const bodies = probe?.bodies ?? []
    const pin = [...bodies].sort((a, b) => slenderness(b) - slenderness(a)).find((b) => slenderness(b) >= 2.5)
    const leaves = bodies.filter((b) => b !== pin)
    const shaft = pin ? shaftOf(pin) : null
    const largest = Math.max(0, ...(m?.dimensions ?? []))
    return [
      { name: 'two leaves and a pin', pass: Boolean(pin) && leaves.length >= 2 },
      { name: 'parts do not overlap', pass: Boolean(probe) && apart(probe) },
      { name: 'hinge-sized', pass: largest >= 20 && largest <= 250 },
      { name: 'pin turns in the knuckles with clearance', pass: Boolean(shaft) && leaves.filter((l) => boresOf(l).some((bore) => clearance(shaft, bore))).length >= 2 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
