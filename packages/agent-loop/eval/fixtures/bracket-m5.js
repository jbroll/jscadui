import { footprint, holeLoops } from '../probe.js'

// Two constraints in one follow-up to a saved bracket: holes an M5 bolt passes
// (a clearance size the model must know) and a height limit it must shrink to.
const BRACKET = `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const width = 40
  const t = 5
  const upright = jf.cuboid({ size: [width, t, 70] }).translate([0, t / 2, 35])
  const base = jf.cuboid({ size: [width, 50, t] }).translate([0, 25, t / 2])
  const hole = jf.cylinder({ radius: 2, height: 20 })
  return upright
    .union(base)
    .subtract(hole.rotateX(Math.PI / 2).translate([0, t / 2, 50]), hole.translate([0, 32, t / 2]))
}

module.exports = { main }
`

const BRACKET_MODELING = `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract, union } = booleans
const { cuboid, cylinder } = primitives
const { rotateX, translate } = transforms

const main = () => {
  const width = 40
  const t = 5
  const upright = translate([0, t / 2, 35], cuboid({ size: [width, t, 70] }))
  const base = translate([0, 25, t / 2], cuboid({ size: [width, 50, t] }))
  const hole = cylinder({ radius: 2, height: 20 })
  return subtract(union(upright, base), translate([0, t / 2, 50], rotateX(Math.PI / 2, hole)), translate([0, 32, t / 2], hole))
}

module.exports = { main }
`

const AXES = ['x', 'y', 'z']
const PLANE = [
  [1, 2],
  [2, 0],
  [0, 1],
]
const ALONG = Array.from({ length: 50 }, (_, k) => 0.01 + k * 0.02)

// Bolt-sized holes by where they are, each with its narrowest width over the cuts through it.
const boltHoles = (sections) => {
  const holes = new Map()
  for (const s of sections) {
    const i = AXES.indexOf(s.axis)
    for (const h of holeLoops(s)) {
      const [narrow, wide] = footprint(h, s.axis)
      if (wide > 15) continue
      const key = [s.axis, ...PLANE[i].map((k) => Math.round((h.boundingBox[0][k] + h.boundingBox[1][k]) / 2))].join(',')
      holes.set(key, Math.min(holes.get(key) ?? Infinity, narrow))
    }
  }
  return [...holes.values()]
}

export const fixture = {
  name: 'bracket-m5',
  group: 'harder',
  prompt: 'it has to fit an M5 bolt, and the whole thing must stay under 60mm tall',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  transcript: [
    { role: 'user', content: 'an L bracket to hold up a small shelf, with a screw hole in each side' },
    { role: 'assistant', content: 'I saved an L bracket to main.js: 40 mm wide, a 70 mm upright and a 50 mm base, both 5 mm thick, with a 4 mm hole in each.' },
  ],
  apiFiles: { fluent: { 'main.js': BRACKET }, modeling: { 'main.js': BRACKET_MODELING } },
  probe: { sections: AXES.map((axis) => ({ axis, at: ALONG })) },
  checks: (m, { solid, probe } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const volume = m?.volume ?? 0
    const holes = boltHoles(probe?.sections ?? [])
    return [
      { name: 'under 60mm tall', pass: dims[2] > 0 && dims[2] <= 60 },
      { name: 'an M5 bolt passes every hole', pass: holes.length >= 2 && holes.every((w) => w >= 5.15 && w <= 6.1) },
      { name: 'still an L bracket', pass: volume > 0 && volume < 0.6 * dims[0] * dims[1] * dims[2] && dims.every((d) => d >= 20) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
