import { between, fill, sortedDims, volume } from '../measures.js'

export const scenario = {
  name: 'jeep-1-10',
  category: 'scale-vehicle',
  prompt: 'create a 1:10 scale model of a WW2 Willys Jeep',
  persona: 'hobbyist building a display shelf of scale military vehicles',
  facts: [
    'a real Willys MB is about 3.4 m long, so 1:10 is about 340 mm long',
    'about 160 mm wide and 150 mm tall at the windshield',
    'display piece, not printed as one part',
    'wants it to look like a Jeep from the side: wheels, hood, seats, windshield, grille',
    'does not care about the interior detail',
  ],
  checks: (m) => {
    const [, , longest] = sortedDims(m)
    const [low] = sortedDims(m)
    return [
      { name: 'about 1:10 length (280-400 mm)', pass: between(longest, 280, 400) },
      { name: 'not a flat slab', pass: low >= 80 },
      { name: 'open vehicle, not a solid block', pass: volume(m) > 0 && fill(m) < 0.5 },
    ]
  },
}
