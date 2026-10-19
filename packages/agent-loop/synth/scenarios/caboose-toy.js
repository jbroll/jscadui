import { between, fill, sortedDims, volume } from '../measures.js'

export const scenario = {
  name: 'caboose-toy',
  category: 'toy-vehicle',
  prompt: 'we need a model of a toy caboose',
  persona: 'grandparent making a wooden-train-style toy for a toddler',
  facts: [
    'about 120 mm long, chunky, with no tiny parts a toddler could pull off',
    'a little cupola on the roof, a rear platform with a rail, and four wheels',
    'rounded and friendly looking, not a precise scale model',
    'one printed piece is best',
  ],
  checks: (m) => {
    const [low, , longest] = sortedDims(m)
    return [
      { name: 'toy-sized (60-250 mm long)', pass: between(longest, 60, 250) },
      { name: 'solid enough, not flat', pass: low >= 25 },
      { name: 'shaped, not a plain block', pass: volume(m) > 0 && fill(m) < 0.8 },
    ]
  },
}
