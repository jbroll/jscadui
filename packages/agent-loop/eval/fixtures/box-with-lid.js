import { footprint, holeLoops, outerLoops } from '../probe.js'

// Box and lid as separate parts; the lid's plug sits inside the opening, or
// its skirt around the box, with a printable clearance.
const FRACTIONS = [0.05, 0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85, 0.95]

const loopsOf = (body, pick) => (body?.sections ?? []).flatMap((s) => pick(s).map((l) => footprint(l, 'z')))

// Per-side gaps between a smaller loop and the larger one around it.
const gaps = (inner, outer) => [(outer[0] - inner[0]) / 2, (outer[1] - inner[1]) / 2]

const fitClearance = (box, lid) => {
  const pairs = [
    ...loopsOf(lid, outerLoops).flatMap((l) => loopsOf(box, holeLoops).map((b) => gaps(l, b))),
    ...loopsOf(box, outerLoops).flatMap((b) => loopsOf(lid, holeLoops).map((l) => gaps(b, l))),
  ]
  return pairs.some((g) => g.every((c) => c > 0 && c <= 1))
}

const covers = (box, lid) => {
  const lidPrint = [lid.dimensions[0], lid.dimensions[1]].sort((a, b) => a - b)
  const outer = [box.dimensions[0], box.dimensions[1]].sort((a, b) => a - b)
  const top = box.sections?.findLast((s) => holeLoops(s).length > 0)
  const opening = top ? footprint(holeLoops(top)[0], 'z') : outer
  return lidPrint.every((d, k) => d >= opening[k] - 2 && d <= outer[k] + 6)
}

export const fixture = {
  name: 'box-with-lid',
  prompt: 'a box with a lid that fits',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { bodies: { sections: [{ axis: 'z', at: FRACTIONS }] } },
  checks: (m, { solid, probe } = {}) => {
    const size = (b) => b.dimensions[0] * b.dimensions[1] * b.dimensions[2]
    const bodies = [...(probe?.bodies ?? [])].sort((a, b) => size(b) - size(a))
    const [box, ...rest] = bodies
    const lid = rest.sort((a, b) => b.dimensions[0] * b.dimensions[1] - a.dimensions[0] * a.dimensions[1])[0]
    return [
      { name: 'box and lid are separate parts', pass: bodies.length >= 2 },
      { name: 'lid covers the opening', pass: Boolean(lid) && covers(box, lid) },
      { name: 'fit clearance 0-1mm', pass: Boolean(lid) && fitClearance(box, lid) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
