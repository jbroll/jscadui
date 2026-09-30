import { outerLoops } from '../probe.js'

const AXES = ['x', 'y', 'z']
// In-plane axes of a cut normal to each axis, as eval/probe.js orders them.
const PLANE = { x: [1, 2], y: [2, 0], z: [0, 1] }
const ALONG = Array.from({ length: 24 }, (_, k) => 0.02 + k * 0.04)
const DESK = 20

// Two loops of one cut facing each other across a gap: the arms either side of the slot.
const gapsIn = (section) => {
  const loops = outerLoops(section)
  const [u, v] = PLANE[section.axis]
  const gaps = []
  for (let a = 0; a < loops.length; a += 1) {
    for (let b = a + 1; b < loops.length; b += 1) {
      const [[pLo, pHi], [qLo, qHi]] = [loops[a].boundingBox, loops[b].boundingBox]
      for (const [k, other] of [
        [u, v],
        [v, u],
      ]) {
        const gap = Math.max(pLo[k] - qHi[k], qLo[k] - pHi[k])
        const facing = Math.min(pHi[other], qHi[other]) - Math.max(pLo[other], qLo[other]) > 0
        if (gap > 0 && facing) gaps.push(gap)
      }
    }
  }
  return gaps
}

export const fixture = {
  name: 'cable-clip',
  group: 'complex',
  prompt: 'a clip to run cables along the edge of my desk, the desk is 20mm thick',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  probe: { sections: AXES.map((axis) => ({ axis, at: ALONG })) },
  gates: (m, { probe } = {}) => [
    { name: `a slot ${DESK} to ${DESK + 1.5} mm wide`, pass: (probe?.sections ?? []).some((s) => gapsIn(s).some((w) => w >= DESK && w <= DESK + 1.5)) },
  ],
}
