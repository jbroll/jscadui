// Three changes in one message to a saved stand: bigger, a second slot, rounded edges.
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
  const slot = jf.cuboid({ size: [12, 30, 20] }).translate([0, -25, 5])
  return base.union(back, lip).subtract(slot)
}

module.exports = { main }
`

const PHONE_STAND_MODELING = `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract, union } = booleans
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
  const slot = translate([0, -25, 5], cuboid({ size: [12, 30, 20] }))
  return subtract(union(base, back, lip), slot)
}

module.exports = { main }
`

// The starting model as graded (reference-answers.test.js checks these against it).
export const ORIGINAL = { dimensions: [80, 90.7085, 90.5804], polygonCount: 28 }

// Cuts across the width, clear of edges rounded at its ends.
const ACROSS = Array.from({ length: 45 }, (_, k) => 0.06 + k * 0.02)

// A slot shows as a run of cuts across the width whose area falls below the rest.
const slotCount = (sections) => {
  const areas = sections.map((s) => s.loops.reduce((sum, l) => sum + l.area, 0))
  const median = [...areas].sort((a, b) => a - b)[Math.floor(areas.length / 2)]
  let runs = 0
  areas.forEach((a, k) => {
    if (a < median * 0.95 && !(k > 0 && areas[k - 1] < median * 0.95)) runs += 1
  })
  return runs
}

export const fixture = {
  name: 'stand-bigger-slots',
  group: 'regression',
  prompt: 'make it 20% bigger, add a second cable slot and round the edges',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  transcript: [
    { role: 'user', content: 'A phone stand for my desk, with a slot for the charging cable' },
    {
      role: 'assistant',
      content:
        'I saved a phone stand to main.js: a base, a back rest leaning back 15°, a lip at the front, and a 12 mm cable slot through the lip and the front of the base. The Height slider sets the back rest.',
    },
  ],
  apiFiles: { fluent: { 'main.js': PHONE_STAND }, modeling: { 'main.js': PHONE_STAND_MODELING } },
  probe: { sections: [{ axis: 'x', at: ACROSS }], bodies: {} },
  checks: (m, { solid, probe } = {}) => {
    const ratios = (m?.dimensions ?? [0, 0, 0]).map((d, k) => d / ORIGINAL.dimensions[k])
    // A rounded edge is many facets where a sharp one is none.
    const polygons = (probe?.bodies ?? []).reduce((sum, b) => sum + b.polygonCount, 0)
    return [
      { name: 'about 20% bigger', pass: ratios.every((r) => r >= 0.98 && r <= 1.45) && ratios.filter((r) => r >= 1.1 && r <= 1.35).length >= 2 },
      { name: 'two cable slots', pass: slotCount(probe?.sections ?? []) >= 2 },
      { name: 'rounded edges', pass: polygons >= ORIGINAL.polygonCount * 3 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
