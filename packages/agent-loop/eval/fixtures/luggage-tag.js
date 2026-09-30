import { holeLoops } from '../probe.js'

// A name cut through a thin tag: each letter a hole in a cut across its
// thickness, and a strap hole beside them toward one end.
const FRACTIONS = [0.25, 0.5, 0.75]
const AXES = ['x', 'y', 'z']

export const fixture = {
  name: 'luggage-tag',
  group: 'harder',
  prompt: 'a luggage tag with my name, SAM, cut through it',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { sections: AXES.map((axis) => ({ axis, at: FRACTIONS })) },
  checks: (m, { solid, probe } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const [thickness, mid, length] = [...dims].sort((a, b) => a - b)
    const thin = AXES[dims.indexOf(thickness)]
    const long = dims.indexOf(length)
    const cuts = (probe?.sections ?? []).filter((s) => s.axis === thin)
    const holes = Math.min(...cuts.map((s) => holeLoops(s).length), Infinity)
    const [lo, hi] = m?.boundingBox ?? [[0, 0, 0], [0, 0, 0]]
    const nearEnd = (l) => l.boundingBox[1][long] <= lo[long] + 0.3 * length || l.boundingBox[0][long] >= hi[long] - 0.3 * length
    return [
      { name: 'tag-sized', pass: thickness >= 1 && thickness <= 8 && mid >= 20 && mid <= 90 && length >= 40 && length <= 160 },
      { name: 'the name is cut through', pass: cuts.length > 0 && holes >= 3 },
      { name: 'a strap hole beside the name', pass: cuts.length > 0 && holes >= 4 && cuts.every((s) => holeLoops(s).some(nearEnd)) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
