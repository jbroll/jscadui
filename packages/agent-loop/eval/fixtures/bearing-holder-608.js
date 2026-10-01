import { footprint, holeLoops } from '../probe.js'

// A 608 bearing (skateboard-bearing size) is 22mm OD, 8mm ID, 7mm wide: the
// holder just needs a 22mm bore, not a press-fit allowance the agent would guess at.
const AXES = ['x', 'y', 'z']
const FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]

const BEARING_SOURCE = /(?:require\(['"]|include\s*<)(?:_catalog\/)?(?:NopSCADlib|BOSL2)\/[^'">]*bearing/i

const hasBore = (sections) =>
  sections.some((s) => holeLoops(s).some((h) => footprint(h, s.axis)[0] >= 22.0 && footprint(h, s.axis)[0] <= 22.4))

// The two largest dims must clear the 22mm bore with room for a wall; the
// smallest must be thick enough to hold a 7mm-wide bearing, not a wafer.
const sizeOk = (dims) => {
  const [thin, ...rest] = [...dims].sort((a, b) => a - b)
  return thin >= 3 && rest.every((d) => d >= 24 && d <= 80)
}

export const fixture = {
  name: 'bearing-holder-608',
  prompt: 'A holder for a 608 ball bearing',
  requires: ['measure', 'write'],
  verifyBeforeWrite: true,
  maxTurns: 12,
  probe: { sections: AXES.map((axis) => ({ axis, at: FRACTIONS })) },
  checks: (m, { solid, probe, source } = {}) => [
    { name: 'requires a catalog ball bearing', pass: BEARING_SOURCE.test(source ?? '') },
    { name: 'a 22mm bearing bore', pass: hasBore(probe?.sections ?? []) },
    { name: 'sized for the bearing, not a placeholder', pass: sizeOk(m?.dimensions ?? [0, 0, 0]) },
    { name: 'watertight', pass: solid?.watertight === true },
  ],
}
