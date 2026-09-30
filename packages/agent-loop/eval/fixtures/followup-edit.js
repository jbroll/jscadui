// A follow-up edit to a saved model: taller, plus a cable slot cut out of it.
const PHONE_STAND = `const jf = require('@jbroll/jscad-fluent')

const main = (params) => {
  params._type = 'Phone Stand'
  params.height = { type: 'slider', default: 90, min: 60, max: 160, step: 5, label: 'Height' }
  const width = 80
  const base = jf.cuboid({ size: [width, 70, 5] }).translateZ(2.5)
  const back = jf.cuboid({ size: [width, 5, params.height] })
    .translateZ(params.height / 2)
    .rotateX((-15 * Math.PI) / 180)
    .translate([0, 30, 3])
  const lip = jf.cuboid({ size: [width, 8, 12] }).translate([0, -31, 6])
  return base.union(back, lip)
}

module.exports = { main }
`

// The same stand as a modeling-style chat would have saved it.
const PHONE_STAND_MODELING = `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { union } = booleans
const { cuboid } = primitives
const { rotateX, translate } = transforms

const main = (params) => {
  params._type = 'Phone Stand'
  params.height = { type: 'slider', default: 90, min: 60, max: 160, step: 5, label: 'Height' }
  const width = 80
  const base = translate([0, 0, 2.5], cuboid({ size: [width, 70, 5] }))
  const back = translate(
    [0, 30, 3],
    rotateX((-15 * Math.PI) / 180, translate([0, 0, params.height / 2], cuboid({ size: [width, 5, params.height] }))),
  )
  const lip = translate([0, -31, 6], cuboid({ size: [width, 8, 12] }))
  return union(base, back, lip)
}

module.exports = { main }
`

// Heights above the bottom whose section area the original model fixes; making
// it taller leaves them alone, so a slot shows as less area at one of them.
const LEVELS = [1, 2.5, 4, 6, 8, 10, 15, 20, 30, 45, 60, 75]

// The saved model as graded (fixtures.test.js checks these against it).
export const ORIGINAL = {
  height: 90.5804,
  areas: [5600, 5600, 5600, 1054.1105, 1054.1105, 1054.1105, 414.1105, 414.1105, 414.1105, 414.1105, 414.1105, 414.1105],
}

export const fixture = {
  name: 'followup-edit',
  prompt: 'make it taller and add a slot for the cable',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  transcript: [
    { role: 'user', content: 'A phone stand for my desk' },
    { role: 'assistant', content: 'I saved a phone stand to main.js: a base, a back rest leaning back 15°, and a lip at the front. The Height slider sets the back rest.' },
  ],
  apiFiles: { fluent: { 'main.js': PHONE_STAND }, modeling: { 'main.js': PHONE_STAND_MODELING } },
  probe: { sections: [{ axis: 'z', above: LEVELS }] },
  checks: (m, { solid, source = '', probe } = {}) => {
    const height = m?.dimensions?.[2] ?? 0
    const areas = (probe?.sections ?? []).map((s) => s.loops.reduce((sum, l) => sum + l.area, 0))
    const lessArea = ORIGINAL.areas.some((a, k) => areas[k] > 0 && areas[k] < a - Math.max(10, a * 0.03))
    return [
      { name: 'taller than before', pass: height >= ORIGINAL.height + 10 },
      { name: 'watertight', pass: solid?.watertight === true },
      { name: 'a slot removes material', pass: lessArea },
      { name: 'saved', pass: source.trim().length > 0 && source !== PHONE_STAND && source !== PHONE_STAND_MODELING },
    ]
  },
}
