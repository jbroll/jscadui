import { between, fill, sortedDims, volume } from '../measures.js'

export const scenario = {
  name: 'turret-gear-assembly',
  category: 'mechanism-assembly',
  prompt:
    'We are designing a small water gun turret. The azimuth and altitude positions are each controlled by separate 10:1 gear ratios driven from a Pelton wheel through a reducing gear. The mechanisms should use 608 skate bearings',
  persona: 'maker designing a printable water gun turret, comfortable with gear ratios, new to this tool',
  facts: [
    'overall size around 230 x 165 x 210 mm is fine',
    'each axis, azimuth and altitude, needs exactly 10:1 total, not 40:1',
    '608 skate bearings are 22 mm outside, 8 mm bore, 7 mm wide, on 8 mm shafts',
    'the Pelton wheels are driven by a small water jet, one per axis',
    'parts must not collide with each other, and the gears must really mesh',
    'would like to see everything laid out so it can be checked, printing plates come later',
  ],
  checks: (m) => {
    const [low, , longest] = sortedDims(m)
    return [
      { name: 'turret sized (100-450 mm long)', pass: between(longest, 100, 450) },
      { name: 'more than a flat plate', pass: low >= 40 },
      { name: 'open mechanism, not a solid block', pass: volume(m) > 0 && fill(m) < 0.4 },
    ]
  },
}
