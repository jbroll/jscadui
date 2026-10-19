import { between, fill, sortedDims, volume, watertight } from '../measures.js'

export const scenario = {
  name: 'screw-top-jar',
  category: 'threads',
  prompt: 'a jar with a screw-on lid I can print',
  persona: 'maker who wants a storage jar for screws and small parts',
  facts: [
    'about 60 mm across and 70 mm tall with the lid on',
    'the lid really screws on with a coarse thread, a few turns',
    'it has to print without supports and the thread must not be too tight',
    'plain outside, a ribbed or knurled lid is a nice extra',
  ],
  checks: (m, { solid } = {}) => {
    const [a, b, c] = sortedDims(m)
    return [
      { name: 'jar-sized', pass: between(a, 40, 110) && between(c, 50, 200) },
      { name: 'hollow, not a solid block', pass: volume(m) > 0 && fill(m) < 0.5 },
      { name: 'watertight', pass: watertight(solid) },
      { name: 'round footprint', pass: b > 0 && a / b > 0.85 },
    ]
  },
}
