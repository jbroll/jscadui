// Raised or engraved text: the plate's volume moves off its bounding box, and
// a cut through the lettering splits into separate loops.
const FRACTIONS = [0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98]

export const fixture = {
  name: 'nameplate',
  prompt: 'a desk nameplate that says JOHN',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { sections: ['x', 'y', 'z'].map((axis) => ({ axis, at: FRACTIONS })) },
  checks: (m, { solid, probe } = {}) => {
    const [smallest, mid, largest] = [...(m?.dimensions ?? [0, 0, 0])].sort((a, b) => a - b)
    const volume = m?.volume ?? 0
    const bboxVolume = smallest * mid * largest
    const loops = (probe?.sections ?? []).map((s) => s.loops.length)
    return [
      { name: 'nameplate-sized', pass: largest >= 60 && largest <= 300 && mid >= 15 && mid <= 120 && smallest >= 1 },
      { name: 'watertight', pass: solid?.watertight === true },
      { name: 'text changes the volume', pass: volume > 0 && Math.abs(bboxVolume - volume) > bboxVolume * 0.001 },
      { name: 'lettering shows in a section', pass: Math.max(0, ...loops) >= 3 },
    ]
  },
}
