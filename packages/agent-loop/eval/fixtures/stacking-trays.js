import { holeLoops, nesting } from '../probe.js'
import { apart } from './sliding-lid-box.js'

// Two parts that must fit each other: one tray's bottom goes into the other's
// top, by a foot inside its rim or a skirt around it, snug but not forced.
const AXES = ['x', 'y', 'z']
const ALONG = Array.from({ length: 50 }, (_, k) => 0.01 + k * 0.02)

const hollow = (body) => body.sections.some((s) => holeLoops(s).length > 0)

// The best way one tray goes into the other along any axis: deepest first.
const bestNest = (bodies) => {
  const fits = []
  for (const a of bodies) {
    for (const b of bodies) {
      if (a === b) continue
      for (const axis of AXES) fits.push(nesting(a, b, axis))
    }
  }
  return fits.filter((f) => f.play).sort((p, q) => q.depth - p.depth)
}

export const fixture = {
  name: 'stacking-trays',
  group: 'harder',
  prompt: 'stackable trays: make two so the bottom of one nests into the top of the other',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { bodies: { sections: AXES.map((axis) => ({ axis, at: ALONG })), overlaps: true } },
  checks: (m, { solid, probe } = {}) => {
    const bodies = (probe?.bodies ?? []).filter((b) => Math.min(...b.dimensions) >= 3)
    const trays = bodies.filter(hollow)
    const nests = trays.length >= 2 ? bestNest(trays) : []
    const snug = nests.find((f) => f.depth >= 1 && f.play.every((p) => p >= 0 && p <= 1))
    const largest = Math.max(0, ...(m?.dimensions ?? []))
    return [
      { name: 'two hollow trays', pass: trays.length >= 2 },
      { name: 'one nests into the other', pass: nests.some((f) => f.depth >= 1) },
      { name: 'nested with under 1mm of play', pass: Boolean(snug) },
      { name: 'parts do not overlap', pass: Boolean(probe) && apart(probe) },
      { name: 'tray-sized', pass: largest >= 30 && largest <= 400 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
