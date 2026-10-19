import { between, fill, sortedDims, volume, watertight } from '../measures.js'

export const scenario = {
  name: 'enclosure-lid',
  category: 'enclosure',
  prompt: 'a project box with a lid for an Arduino Uno, with screw posts to mount the board',
  persona: 'electronics hobbyist putting an Uno in a box on a shelf',
  facts: [
    'the Uno board is 68.6 by 53.4 mm and needs about 10 mm of room above it',
    'the board mounts on four posts with M3 screws',
    'the lid should sit on the box and be held by screws or a snug fit, whichever is simpler',
    'a hole in one end for the USB cable',
    'prints on a 220 x 220 mm bed',
  ],
  checks: (m, { solid } = {}) => {
    const [height, mid, longest] = sortedDims(m)
    return [
      { name: 'fits an Uno footprint, within the bed', pass: between(longest, 70, 220) && between(mid, 55, 220) },
      { name: 'height 15-100 mm', pass: between(height, 15, 100) },
      { name: 'hollow, not a solid block', pass: volume(m) > 0 && fill(m) < 0.5 },
      { name: 'watertight', pass: watertight(solid) },
    ]
  },
}
