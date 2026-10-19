import { between, fill, sortedDims, volume, watertight } from '../measures.js'

export const scenario = {
  name: 'shelf-bracket',
  category: 'bracket',
  prompt: 'An L bracket to hold a shelf, with countersunk screw holes',
  persona: 'homeowner putting up a small wall shelf',
  facts: [
    'the shelf is 20 mm thick and about 150 mm deep',
    'the bracket should be about 120 mm on each leg and 30 mm wide',
    'two screw holes in each leg, for flat-head wood screws that sit flush',
    'plastic printed bracket, so it should be thick enough not to snap',
  ],
  checks: (m, { solid } = {}) => {
    const dim = sortedDims(m)
    return [
      { name: 'L-shaped, not a flat plate or block', pass: volume(m) > 0 && fill(m) < 0.5 },
      { name: 'plausible size', pass: dim.every((d) => between(d, 20, 250)) },
      { name: 'watertight', pass: watertight(solid) },
    ]
  },
}
