import { holeLoops, outerLoops, turnOf } from '../probe.js'

// Three stated numbers at once on a computed shape: the height, the wall and a
// twist the outline must show from its bottom cut to its top one.
const AXES = ['x', 'y', 'z']
const ALONG = Array.from({ length: 25 }, (_, k) => 0.02 + k * 0.04)

// Wall across a cut: the ring's area over its mean outline length.
const wallOf = (section) => {
  const [outer] = outerLoops(section)
  const [hole] = holeLoops(section)
  return outer && hole ? (outer.area + hole.area) / ((outer.perimeter + hole.perimeter) / 2) : null
}

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]

export const fixture = {
  name: 'twisted-vase',
  group: 'harder',
  prompt: 'a twisted vase, 120mm tall with 2mm walls, twisting 90 degrees from bottom to top',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { sections: AXES.map((axis) => ({ axis, at: ALONG, above: [0.4], outline: true })) },
  checks: (m, { solid, probe } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const k = dims.reduce((best, d, n) => (Math.abs(d - 120) < Math.abs(dims[best] - 120) ? n : best), 0)
    const cuts = (probe?.sections ?? []).filter((s) => s.axis === AXES[k])
    const along = cuts.filter((s) => s.at !== undefined)
    const walls = along.filter((s) => s.at >= 0.3 && s.at <= 0.8).map(wallOf)
    const outlines = along.map((s) => outerLoops(s)[0])
    const turn = outlines.length && outlines.every(Boolean) ? turnOf(outlines) : null
    const twist = turn && turn.magnitude >= 0.002 ? Math.abs(turn.degrees.at(-1)) / (along.at(-1).at - along[0].at) : 0
    const bottom = cuts.find((s) => s.above !== undefined)
    const top = along.at(-1)
    return [
      { name: '120mm tall', pass: Math.abs(dims[k] - 120) <= 1.5 },
      { name: '2mm walls', pass: walls.length > 0 && walls.every((w) => w !== null) && median(walls) >= 1.5 && median(walls) <= 3 },
      { name: 'twists 90 degrees bottom to top', pass: twist >= 80 && twist <= 100 },
      { name: 'open top, closed bottom', pass: Boolean(bottom && top) && holeLoops(bottom).length === 0 && holeLoops(top).length > 0 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
