import { between, fill, sortedDims, volume, watertight } from '../measures.js'

export const scenario = {
  name: 'nameplate',
  category: 'text',
  prompt: 'a desk nameplate that says JOHN',
  persona: 'office worker who wants a name sign for their desk',
  facts: [
    'about 150 mm wide, 40 mm tall, standing on its own',
    'the letters should be raised or cut into the plate so they can be read',
    'prints in one colour',
  ],
  checks: (m, { solid } = {}) => {
    const [smallest, mid, largest] = sortedDims(m)
    return [
      { name: 'nameplate-sized', pass: between(largest, 60, 300) && between(mid, 15, 120) && smallest >= 1 },
      { name: 'text changes the volume', pass: volume(m) > 0 && fill(m) < 0.999 },
      { name: 'watertight', pass: watertight(solid) },
    ]
  },
}
