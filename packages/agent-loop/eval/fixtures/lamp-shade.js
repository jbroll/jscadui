import { footprint, holeLoops } from '../probe.js'

const LEVELS = Array.from({ length: 49 }, (_, k) => 0.02 + k * 0.02)
// An E27 holder's shade ring takes a 40 mm hole; up to 44 mm still sits on it.
const [LOW, HIGH] = [40, 44]

const roundHole = (loop) => {
  const [a, b] = footprint(loop, 'z')
  return a >= LOW && b <= HIGH && b - a <= 1
}

export const fixture = {
  name: 'lamp-shade',
  group: 'complex',
  prompt: 'a lamp shade for a standard E27 bulb holder',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  probe: { sections: [{ axis: 'z', at: LEVELS }] },
  gates: (m, { probe } = {}) => [{ name: `a round hole ${LOW} to ${HIGH} mm across`, pass: (probe?.sections ?? []).some((s) => holeLoops(s).some(roundHole)) }],
}
