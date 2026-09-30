import { footprint, holeLoops } from '../probe.js'

const LEVELS = Array.from({ length: 19 }, (_, k) => 0.05 + k * 0.05)
// A 3 inch sticky-note pad is 76 mm square.
const POCKET = 77

export const fixture = {
  name: 'desk-organizer',
  group: 'complex',
  prompt: 'a desk organizer with spots for pens, my phone and sticky notes (the 3 inch square ones)',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  pieces: 1,
  followUps: [],
  probe: { sections: [{ axis: 'z', at: LEVELS }] },
  gates: (m, { probe } = {}) => [
    {
      name: `a pocket at least ${POCKET} x ${POCKET} mm`,
      pass: (probe?.sections ?? []).some((s) => holeLoops(s).some((loop) => footprint(loop, 'z').every((d) => d >= POCKET))),
    },
  ],
}
