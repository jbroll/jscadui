import { holeLoops, outerLoops } from '../probe.js'

// A cup stands on z: hollow, open at the top, walls as thick as asked.
const wall = (section) => {
  const outer = outerLoops(section)[0]
  const hole = holeLoops(section)[0]
  if (!outer || !hole) return null
  return ((outer.dimensions[0] - hole.dimensions[0]) / 2 + (outer.dimensions[1] - hole.dimensions[1]) / 2) / 2
}

export const fixture = {
  name: 'pencil-cup',
  prompt: 'a small pencil cup with 2mm walls',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { sections: [{ axis: 'z', at: [0.5, 0.99] }] },
  checks: (m, { solid, probe } = {}) => {
    const [x, y, z] = m?.dimensions ?? [0, 0, 0]
    const volume = m?.volume ?? 0
    const [middle, top] = probe?.sections ?? []
    const thickness = wall(middle)
    return [
      { name: 'pencil-cup-sized', pass: [x, y].every((d) => d >= 30 && d <= 150) && z >= 40 && z <= 200 },
      { name: 'hollow', pass: volume > 0 && volume < x * y * z * 0.5 },
      { name: 'open top', pass: holeLoops(top).length > 0 },
      { name: '2mm walls', pass: thickness !== null && Math.abs(thickness - 2) <= 0.6 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
