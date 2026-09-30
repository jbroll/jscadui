import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { complexGates, complexProbe } from './complex.js'
import { loadFixtures } from './run-eval.js'

const JF = "const jf = require('@jbroll/jscad-fluent')\n"
const model = (body) => `${JF}module.exports = { main: () => ${body} }\n`
// Two 4 mm arms `gap` apart, joined at the back: a C clip in profile, 30 mm long in x.
const clip = (gap) =>
  model(`[
  jf.cuboid({ size: [30, 20, 4] }).translate([0, 0, 2]),
  jf.cuboid({ size: [30, 20, 4] }).translate([0, 0, ${4 + gap + 2}]),
  jf.cuboid({ size: [30, 4, ${8 + gap}] }).translate([0, -12, ${(8 + gap) / 2}]),
]`)

const byName = Object.fromEntries((await loadFixtures()).map((f) => [f.name, f]))
const backend = createEvalBackend({ api: 'fluent' })
const COMPLEX = ['toy-caboose', 'birdhouse', 'desk-organizer', 'dump-truck', 'lamp-shade', 'planter', 'chess-pieces', 'cable-clip', 'toothbrush-holder', 'rocket-revised']

const gatesOf = async (name, source) => {
  const fixture = byName[name]
  const graded = await backend.gradeProject({ files: { 'main.js': source }, entry: 'main.js' }, { probe: complexProbe(fixture) })
  return Object.fromEntries(complexGates(fixture, graded).map((g) => [g.name, g.pass]))
}

describe('complex fixtures', () => {
  it('are the ten the spec lists', () => {
    expect(Object.values(byName).filter((f) => f.group === 'complex').map((f) => f.name).sort()).toEqual([...COMPLEX].sort())
  })

  it('have the stated pieces and follow-ups', () => {
    expect(COMPLEX.map((name) => byName[name].pieces)).toEqual([1, 1, 1, 1, 1, 2, 2, 1, 1, 1])
    expect(byName['rocket-revised'].followUps).toEqual([{ message: 'can you make it two stages, with fins only on the bottom one' }])
  })

  it('state as many gates as the requests do, and each fails a grade with no geometry', () => {
    const gates = COMPLEX.map((name) => byName[name].gates(null, { solid: null, probe: null, params: [] }))
    expect(gates.map((list) => list.length)).toEqual([0, 1, 1, 0, 1, 1, 1, 1, 0, 1])
    expect(gates.flat().map((g) => g.pass)).toEqual(Array(7).fill(false))
  })

  it.each([
    ['birdhouse', 'at least two bodies', true, model('[jf.cuboid({ size: [100, 100, 100] }).translateZ(50), jf.cuboid({ size: [110, 110, 5] }).translateZ(102.5)]')],
    ['birdhouse', 'at least two bodies', false, model('jf.cuboid({ size: [100, 100, 100] })')],
    ['desk-organizer', 'a pocket at least 77 x 77 mm', true, model('jf.cuboid({ size: [100, 100, 40] }).translateZ(20).subtract(jf.cuboid({ size: [80, 80, 40] }).translateZ(25))')],
    ['desk-organizer', 'a pocket at least 77 x 77 mm', false, model('jf.cuboid({ size: [100, 100, 40] }).translateZ(20).subtract(jf.cuboid({ size: [70, 70, 40] }).translateZ(25))')],
    ['lamp-shade', 'a round hole 40 to 44 mm across', true, model('jf.cylinder({ radius: 40, height: 3, segments: 64 }).subtract(jf.cylinder({ radius: 21, height: 5, segments: 64 }))')],
    ['lamp-shade', 'a round hole 40 to 44 mm across', false, model('jf.cylinder({ radius: 40, height: 3, segments: 64 }).subtract(jf.cylinder({ radius: 25, height: 5, segments: 64 }))')],
    ['planter', 'at least two bodies', true, model('[jf.cylinder({ radius: 40, height: 60 }).translateZ(35), jf.cylinder({ radius: 50, height: 5 }).translateZ(2.5)]')],
    ['planter', 'at least two bodies', false, model('jf.cylinder({ radius: 40, height: 60 })')],
    ['chess-pieces', 'exactly two groups', true, model('[jf.cylinder({ radius: 10, height: 30 }), jf.cylinder({ radius: 10, height: 40 }).translate([40, 0, 5])]')],
    ['chess-pieces', 'exactly two groups', false, model('jf.cylinder({ radius: 10, height: 30 })')],
    ['cable-clip', 'a slot 20 to 21.5 mm wide', true, clip(20.5)],
    ['cable-clip', 'a slot 20 to 21.5 mm wide', false, clip(25)],
    ['rocket-revised', 'tallest size 180 to 220 mm', true, model('jf.cylinder({ radius: 12, height: 200 })')],
    ['rocket-revised', 'tallest size 180 to 220 mm', false, model('jf.cylinder({ radius: 12, height: 250 })')],
  ])('%s: "%s" is %s', async (name, gate, pass, source) => {
    expect((await gatesOf(name, source))[gate]).toBe(pass)
  })
})
