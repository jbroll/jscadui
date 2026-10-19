import { between, fill, sortedDims, volume, watertight } from '../measures.js'

export const scenario = {
  name: 'spur-gear',
  category: 'gears',
  prompt: 'a pair of spur gears, 20 and 40 teeth, that mesh',
  persona: 'tinkerer who wants a small gear reduction to print and try',
  facts: [
    'gears about 8 mm thick with a 5 mm bore for a shaft',
    'the 40-tooth gear should be roughly 60 mm across',
    'either shown meshed or laid side by side is fine',
    'prints on a regular hobby printer, so tooth size should not be tiny',
  ],
  checks: (m, { solid } = {}) => {
    const [thin, mid, longest] = sortedDims(m)
    return [
      { name: 'gear-sized', pass: between(longest, 40, 250) && between(thin, 3, 40) },
      { name: 'two gears take more room than one', pass: longest > 1.15 * mid },
      { name: 'toothed discs, not a block', pass: volume(m) > 0 && fill(m) < 0.8 },
      { name: 'watertight', pass: watertight(solid) },
    ]
  },
}
