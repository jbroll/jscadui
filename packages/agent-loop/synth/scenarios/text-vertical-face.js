import { between, fill, sortedDims, volume, watertight } from '../measures.js'

export const scenario = {
  name: 'text-vertical-face',
  category: 'text',
  prompt: 'a small box with the word PLAY raised on the front',
  persona: 'parent making a toy storage box for a child',
  facts: [
    'box about 80 mm wide, 50 mm deep and 40 mm tall',
    'the letters should stand out from the front face by a couple of millimetres, readable from the front',
    'the lettering goes on the side facing you, not the top',
    'does not need a lid',
  ],
  checks: (m, { solid } = {}) => {
    const [low, , longest] = sortedDims(m)
    return [
      { name: 'box-sized', pass: between(longest, 50, 200) && between(low, 20, 100) },
      { name: 'lettering changes the volume', pass: volume(m) > 0 && fill(m) < 0.999 },
      { name: 'watertight', pass: watertight(solid) },
    ]
  },
}
