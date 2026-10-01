import { footprint, holeLoops } from '../probe.js'

// A correction mid-conversation: the holes the model drilled through the top go through the side instead.
const BLOCK = `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const hole = jf.cylinder({ radius: 4, height: 40 })
  return jf.cuboid({ size: [60, 40, 30] }).subtract(hole.translateX(-15), hole.translateX(15))
}

module.exports = { main }
`

const BLOCK_MODELING = `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract } = booleans
const { cuboid, cylinder } = primitives
const { translateX } = transforms

const main = () => {
  const hole = cylinder({ radius: 4, height: 40 })
  return subtract(cuboid({ size: [60, 40, 30] }), translateX(-15, hole), translateX(15, hole))
}

module.exports = { main }
`

const FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
const AXES = ['x', 'y', 'z']

const holesIn = (s) => holeLoops(s).filter((l) => footprint(l, s.axis).every((d) => d >= 6.5 && d <= 9.5)).length

export const fixture = {
  name: 'holes-through-side',
  group: 'regression',
  prompt: 'no, the holes should go through the side, not the top',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  transcript: [
    { role: 'user', content: 'a 60 x 40 x 30 mounting block with two 8mm holes' },
    { role: 'assistant', content: 'I saved the block to main.js: 60 x 40 x 30 mm, with two 8 mm holes through the top, 30 mm apart.' },
  ],
  apiFiles: { fluent: { 'main.js': BLOCK }, modeling: { 'main.js': BLOCK_MODELING } },
  probe: { sections: AXES.map((axis) => ({ axis, at: FRACTIONS })) },
  checks: (m, { solid, probe } = {}) => {
    const [a, b, c] = [...(m?.dimensions ?? [0, 0, 0])].sort((p, q) => p - q)
    const sections = probe?.sections ?? []
    const across = (axis) => sections.filter((s) => s.axis === axis)
    return [
      { name: 'still 60 x 40 x 30', pass: Math.abs(a - 30) <= 0.5 && Math.abs(b - 40) <= 0.5 && Math.abs(c - 60) <= 0.5 },
      { name: 'no holes through the top', pass: across('z').every((s) => holeLoops(s).length === 0) },
      { name: 'two 8mm holes through a side', pass: ['x', 'y'].some((axis) => across(axis).some((s) => holesIn(s) >= 2)) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
