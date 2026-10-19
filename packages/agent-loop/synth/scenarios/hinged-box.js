import { between, fill, sortedDims, volume, watertight } from '../measures.js'

export const scenario = {
  name: 'hinged-box',
  category: 'hinge',
  prompt: 'a little trinket box with a hinged lid',
  persona: 'crafter making a gift box for jewelry',
  facts: [
    'about 80 mm wide, 60 mm deep and 40 mm tall when closed',
    'the lid swings open on a hinge at the back and prints with the box, no glue',
    'a small lip or catch at the front so it stays shut',
    'walls about 2 mm thick',
  ],
  checks: (m, { solid } = {}) => {
    const [low, mid, longest] = sortedDims(m)
    return [
      { name: 'trinket-box sized', pass: between(longest, 50, 200) && between(mid, 40, 160) && between(low, 20, 100) },
      { name: 'hollow, not a solid block', pass: volume(m) > 0 && fill(m) < 0.6 },
      { name: 'watertight', pass: watertight(solid) },
    ]
  },
}
