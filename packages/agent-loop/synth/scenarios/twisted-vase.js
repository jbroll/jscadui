import { between, dims, fill, volume, watertight } from '../measures.js'

export const scenario = {
  name: 'twisted-vase',
  category: 'organic-loft',
  prompt: 'a vase that swells in the middle and narrows at the top, with a gentle twist',
  persona: 'home decorator who wants a vase for dried flowers',
  facts: [
    'about 150 mm tall and 80 mm across at the widest',
    'the neck at the top is about 40 mm across',
    'the surface should show a slow spiral twist, smooth, not faceted',
    'a flat base so it stands, walls about 2 mm so it holds water',
  ],
  checks: (m, { solid } = {}) => {
    const [x, y, z] = dims(m)
    return [
      { name: 'vase proportions: taller than wide', pass: between(z, 100, 250) && between(Math.max(x, y), 50, 140) && z > Math.max(x, y) },
      { name: 'hollow, not a solid block', pass: volume(m) > 0 && fill(m) < 0.45 },
      { name: 'watertight', pass: watertight(solid) },
    ]
  },
}
