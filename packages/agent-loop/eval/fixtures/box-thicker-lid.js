import { footprint, holeLoops, outerLoops } from '../probe.js'
import { covers } from './box-with-lid.js'

// Two changes in one message to a saved open box: thicker walls, and a lid as its own part.
const BOX = `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const wall = 2
  const size = [60, 40, 30]
  const inside = jf.cuboid({ size: [size[0] - 2 * wall, size[1] - 2 * wall, size[2]] }).translateZ(wall)
  return jf.cuboid({ size }).subtract(inside)
}

module.exports = { main }
`

const BOX_MODELING = `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract } = booleans
const { cuboid } = primitives
const { translateZ } = transforms

const main = () => {
  const wall = 2
  const size = [60, 40, 30]
  const inside = translateZ(wall, cuboid({ size: [size[0] - 2 * wall, size[1] - 2 * wall, size[2]] }))
  return subtract(cuboid({ size }), inside)
}

module.exports = { main }
`

const FRACTIONS = [0.05, 0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85, 0.95]

const hollow = (body) => (body.sections ?? []).some((s) => holeLoops(s).length > 0)

// Mean wall of the box halfway up: its outline less its opening, per side.
const wallOf = (box) => {
  const middle = box.sections?.find((s) => s.at === 0.5)
  const [outer] = outerLoops(middle)
  const [hole] = holeLoops(middle)
  if (!outer || !hole) return null
  const [o, h] = [footprint(outer, 'z'), footprint(hole, 'z')]
  return ((o[0] - h[0]) / 2 + (o[1] - h[1]) / 2) / 2
}

export const fixture = {
  name: 'box-thicker-lid',
  group: 'harder',
  prompt: 'make the walls thicker and add a lid',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  transcript: [
    { role: 'user', content: 'a small box, about 60 by 40 by 30' },
    { role: 'assistant', content: 'I saved an open box to main.js: 60 x 40 x 30 mm outside, with 2 mm walls and a 2 mm floor.' },
  ],
  apiFiles: { fluent: { 'main.js': BOX }, modeling: { 'main.js': BOX_MODELING } },
  probe: { bodies: { sections: [{ axis: 'z', at: FRACTIONS }] } },
  checks: (m, { solid, probe } = {}) => {
    const size = (b) => b.dimensions[0] * b.dimensions[1] * b.dimensions[2]
    const bodies = [...(probe?.bodies ?? [])]
    const box = bodies.filter(hollow).sort((a, b) => size(b) - size(a))[0]
    const lid = bodies.filter((b) => b !== box).sort((a, b) => b.dimensions[0] * b.dimensions[1] - a.dimensions[0] * a.dimensions[1])[0]
    const wall = box ? wallOf(box) : null
    const [short, long] = box ? [...box.dimensions.slice(0, 2)].sort((a, b) => a - b) : [0, 0]
    return [
      { name: 'box and lid are separate parts', pass: Boolean(box) && Boolean(lid) },
      { name: 'walls thicker than 2mm', pass: wall !== null && wall >= 2.5 && wall <= 12 },
      { name: 'box keeps its size', pass: short >= 36 && short <= 60 && long >= 56 && long <= 84 && box.dimensions[2] >= 26 && box.dimensions[2] <= 45 },
      { name: 'box still open', pass: Boolean(box) && holeLoops(box.sections.at(-1)).length > 0 },
      { name: 'lid covers the opening', pass: Boolean(box) && Boolean(lid) && covers(box, lid) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
