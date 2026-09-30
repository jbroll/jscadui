import { holeLoops } from '../probe.js'

// Box and sliding lid as separate parts that do not overlap, assembled or laid out.
const FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9]

const hollow = (body) => (body.sections ?? []).some((s) => holeLoops(s).length > 0)

// Touching parts share no volume; boolean noise leaves a sliver at most.
export const apart = (probe) =>
  (probe?.overlaps ?? []).every(({ a, b, volume }) => volume <= 0.5 + 0.002 * Math.min(probe.bodies[a].volume, probe.bodies[b].volume))

export const fixture = {
  name: 'sliding-lid-box',
  group: 'harder',
  prompt: 'a box with a sliding lid',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { bodies: { sections: [{ axis: 'z', at: FRACTIONS }], overlaps: true } },
  checks: (m, { solid, probe } = {}) => {
    const size = (b) => b.dimensions[0] * b.dimensions[1] * b.dimensions[2]
    const bodies = [...(probe?.bodies ?? [])]
    const box = bodies.filter(hollow).sort((a, b) => size(b) - size(a))[0]
    const lid = bodies.filter((b) => b !== box).sort((a, b) => size(b) - size(a))[0]
    const outer = box ? [...box.dimensions.slice(0, 2)].sort((a, b) => a - b) : []
    const lidPrint = lid ? [...lid.dimensions].sort((a, b) => a - b) : []
    // A lid lies flat or stands on edge: its thickness is its smallest size either way.
    const fits = Boolean(box && lid) && lidPrint[0] <= Math.min(10, box.dimensions[2] / 2) &&
      lidPrint.slice(1).every((d, k) => d >= outer[k] * 0.6 && d <= outer[k] + 2)
    return [
      { name: 'box and lid are separate parts', pass: Boolean(box) && Boolean(lid) },
      { name: 'parts do not overlap', pass: Boolean(probe) && apart(probe) },
      { name: 'box-sized', pass: Boolean(box) && outer[0] >= 20 && outer[1] <= 300 && box.dimensions[2] >= 10 },
      { name: 'lid matches the box', pass: fits },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
