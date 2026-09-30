import { describe, expect, it } from 'vitest'
import { createEvalBackend } from './backend.js'
import { ORIGINAL } from './fixtures/followup-edit.js'
import { fixtureForApi, loadFixtures } from './run-eval.js'

const byName = Object.fromEntries((await loadFixtures()).map((f) => [f.name, f]))
const backends = { fluent: createEvalBackend({ api: 'fluent' }), modeling: createEvalBackend({ api: 'modeling' }) }

// Grades a source as the eval does: the fixture's files with main.js written, then its checks.
const grade = async (name, source, api) => {
  const fixture = fixtureForApi(byName[name], api)
  const files = { ...fixture.files, 'main.js': source }
  const graded = await backends[api].gradeProject({ files, entry: 'main.js' }, { probe: fixture.probe })
  const context = { params: graded.params, solid: graded.solid, probe: graded.probe, source: Object.values(files).join('\n') }
  return { graded, results: fixture.checks(graded.measure, context) }
}
const failing = ({ results }) => results.filter((c) => !c.pass).map((c) => c.name)

const JF = "const jf = require('@jbroll/jscad-fluent')\n"
const JSCAD = "const { booleans, primitives, transforms } = require('@jscad/modeling')\nconst { subtract, union } = booleans\nconst { cuboid, cylinder } = primitives\nconst { rotateX, rotateZ, translate } = transforms\n"
const block = (size) => `${JF}module.exports = { main: () => jf.cuboid({ size: [${size}] }) }\n`

// Letter strokes as [x, y, width, height, angle], 16 x 24mm letters 30mm apart.
const LETTERS = `const bar = (x, y, w, h, a = 0) => ({ x, y, w, h, a })
const strokes = [
  ...[bar(6.5, 0, 3, 24), bar(0, -10.5, 16, 3), bar(-6.5, -7, 3, 10)].map((b) => ({ ...b, x: b.x - 45 })),
  ...[bar(-6.5, 0, 3, 24), bar(6.5, 0, 3, 24), bar(0, 10.5, 16, 3), bar(0, -10.5, 16, 3)].map((b) => ({ ...b, x: b.x - 15 })),
  ...[bar(-6.5, 0, 3, 24), bar(6.5, 0, 3, 24), bar(0, 0, 16, 3)].map((b) => ({ ...b, x: b.x + 15 })),
  ...[bar(-6.5, 0, 3, 24), bar(6.5, 0, 3, 24), bar(0, 0, 3, 26, Math.atan2(13, 24))].map((b) => ({ ...b, x: b.x + 45 })),
]
`

const REFERENCES = {
  'followup-edit': {
    fluent: `${JF}
const main = (params) => {
  params._type = 'Phone Stand'
  params.height = { type: 'slider', default: 130, min: 60, max: 200, step: 5, label: 'Height' }
  const width = 80
  const base = jf.cuboid({ size: [width, 70, 5] }).translateZ(2.5)
  const back = jf.cuboid({ size: [width, 5, params.height] })
    .translateZ(params.height / 2)
    .rotateX((-15 * Math.PI) / 180)
    .translate([0, 30, 3])
  const lip = jf.cuboid({ size: [width, 8, 12] }).translate([0, -31, 6])
  const slot = jf.cuboid({ size: [14, 20, 30] }).translate([0, 30, 10])
  return base.union(back, lip).subtract(slot)
}
module.exports = { main }`,
    modeling: `${JSCAD}
const main = (params) => {
  params.height = { type: 'slider', default: 120, min: 60, max: 200, step: 5, label: 'Height' }
  const base = translate([0, 0, 2.5], cuboid({ size: [80, 70, 5] }))
  const back = translate([0, 30, 3], rotateX((-15 * Math.PI) / 180, translate([0, 0, params.height / 2], cuboid({ size: [80, 5, params.height] }))))
  const lip = translate([0, -31, 6], cuboid({ size: [80, 8, 12] }))
  const slot = translate([0, -31, 8], cuboid({ size: [12, 10, 10] }))
  return subtract(union(base, back, lip), slot)
}
module.exports = { main }`,
  },
  nameplate: {
    fluent: `${JF}${LETTERS}
const main = () => {
  const plate = jf.cuboid({ size: [150, 40, 5] }).translateZ(2.5)
  const letters = strokes.map(({ x, y, w, h, a }) => jf.cuboid({ size: [w, h, 1.6] }).rotateZ(a).translate([x, y, 5.7]))
  return plate.union(...letters)
}
module.exports = { main }`,
    modeling: `${JSCAD}${LETTERS}
const main = () => {
  const plate = translate([0, 0, 2.5], cuboid({ size: [150, 40, 5] }))
  const cuts = strokes.map(({ x, y, w, h, a }) => translate([x, y, 4.75], rotateZ(a, cuboid({ size: [w, h, 1.5] }))))
  return subtract(plate, ...cuts)
}
module.exports = { main }`,
  },
  'hook-rack': {
    fluent: `${JF}
const main = () => {
  const hooks = [-80, -40, 0, 40, 80].map((x) =>
    jf.cuboid({ size: [8, 42, 8] }).translate([x, -19, -5]).union(jf.cuboid({ size: [8, 8, 14] }).translate([x, -36, 2])))
  return jf.cuboid({ size: [200, 5, 40] }).translate([0, 2.5, 0]).union(...hooks)
}
module.exports = { main }`,
    modeling: `${JSCAD}
const main = () => {
  const hooks = [-80, -40, 0, 40, 80].flatMap((x) => [
    translate([x, -19, -5], rotateX(Math.PI / 2, cylinder({ radius: 4, height: 42 }))),
    translate([x, -37, 2], cylinder({ radius: 4, height: 14 })),
  ])
  return union(translate([0, 2.5, 0], cuboid({ size: [200, 5, 40] })), ...hooks)
}
module.exports = { main }`,
  },
  'pencil-cup': {
    fluent: `${JF}
const main = () => jf.cuboid({ size: [60, 60, 90] }).subtract(jf.cuboid({ size: [56, 56, 90] }).translateZ(2))
module.exports = { main }`,
    modeling: `${JSCAD}
const main = () => subtract(cylinder({ radius: 35, height: 100 }), translate([0, 0, 2], cylinder({ radius: 33, height: 100 })))
module.exports = { main }`,
  },
  'inch-cube': {
    fluent: `${JF}
const main = () => jf.cuboid({ size: [50.8, 50.8, 50.8] }).subtract(jf.cylinder({ radius: 6.35, height: 60 }).rotateX(Math.PI / 2))
module.exports = { main }`,
    modeling: `${JSCAD}
const main = () => subtract(cuboid({ size: [50.8, 50.8, 50.8] }), cylinder({ radius: 25.4 / 4, height: 60 }))
module.exports = { main }`,
  },
  'box-with-lid': {
    // A cap whose skirt fits 0.3mm around the box, printed beside it in one solid.
    fluent: `${JF}
const main = () => {
  const box = jf.cuboid({ size: [60, 40, 30] }).subtract(jf.cuboid({ size: [56, 36, 30] }).translateZ(2))
  const lid = jf.cuboid({ size: [64.6, 44.6, 8] }).subtract(jf.cuboid({ size: [60.6, 40.6, 8] }).translateZ(2))
  return box.union(lid.translate([75, 0, -11]))
}
module.exports = { main }`,
    // A lid whose hollow plug fits 0.2mm inside the opening, as a second part.
    modeling: `${JSCAD}
const main = () => {
  const box = subtract(cuboid({ size: [60, 40, 30] }), translate([0, 0, 2], cuboid({ size: [56, 36, 30] })))
  const plug = subtract(cuboid({ size: [55.6, 35.6, 4] }), cuboid({ size: [51.6, 31.6, 4] }))
  const lid = union(translate([0, 0, -14], cuboid({ size: [60, 40, 2] })), translate([0, 0, -11], plug))
  return [box, translate([70, 0, 0], lid)]
}
module.exports = { main }`,
  },
}

const BLOCKS = {
  'followup-edit': block('80, 70, 120'),
  nameplate: block('150, 40, 5'),
  'hook-rack': block('200, 40, 40'),
  'pencil-cup': block('70, 70, 100'),
  'inch-cube': block('50.8, 50.8, 50.8'),
  'box-with-lid': block('60, 40, 30'),
}

const cases = Object.entries(REFERENCES).flatMap(([name, sources]) => Object.entries(sources).map(([api, source]) => [name, api, source]))

describe('new fixtures against reference answers', () => {
  it.each(cases)('%s passes its %s reference answer', async (name, api, source) => {
    expect(failing(await grade(name, source, api))).toEqual([])
  })

  it.each(Object.entries(BLOCKS))('%s fails a plain block', async (name, source) => {
    expect(failing(await grade(name, source, 'fluent')).length).toBeGreaterThan(0)
  })

  it.each(['fluent', 'modeling'])("followup-edit: the %s starting model matches ORIGINAL, failing the checks", async (api) => {
    const starting = fixtureForApi(byName['followup-edit'], api).files['main.js']
    expect(starting).toContain(api === 'fluent' ? '@jbroll/jscad-fluent' : '@jscad/modeling')
    expect(starting).not.toContain(api === 'fluent' ? '@jscad/modeling' : 'jscad-fluent')
    const { graded, results } = await grade('followup-edit', starting, api)
    expect(graded.measure.dimensions[2]).toBeCloseTo(ORIGINAL.height, 3)
    const areas = graded.probe.sections.map((s) => s.loops.reduce((sum, l) => sum + l.area, 0))
    areas.forEach((a, k) => expect(a).toBeCloseTo(ORIGINAL.areas[k], 2))
    expect(results.filter((c) => !c.pass).map((c) => c.name)).toEqual(['taller than before', 'a slot removes material', 'saved'])
  })

  it('followup-edit fails a taller model with no slot', async () => {
    const taller = fixtureForApi(byName['followup-edit'], 'fluent').files['main.js'].replace('default: 90', 'default: 130')
    expect(failing(await grade('followup-edit', taller, 'fluent'))).toEqual(['a slot removes material'])
  })

  it('hook-rack fails a rack with four hooks', async () => {
    const four = REFERENCES['hook-rack'].fluent.replace('[-80, -40, 0, 40, 80]', '[-60, -20, 20, 60]')
    expect(failing(await grade('hook-rack', four, 'fluent'))).toEqual(['five hooks'])
  })

  it('pencil-cup fails 4mm walls and a closed top', async () => {
    const thick = REFERENCES['pencil-cup'].fluent.replace('[56, 56, 90]', '[52, 52, 90]')
    expect(failing(await grade('pencil-cup', thick, 'fluent'))).toEqual(['2mm walls'])
    const closed = REFERENCES['pencil-cup'].fluent.replace('[56, 56, 90] }).translateZ(2)', '[56, 56, 86] })')
    expect(failing(await grade('pencil-cup', closed, 'fluent'))).toContain('open top')
  })

  it('box-with-lid fails a lid with no clearance', async () => {
    const tight = REFERENCES['box-with-lid'].modeling.replace('[55.6, 35.6, 4]', '[56, 36, 4]')
    expect(failing(await grade('box-with-lid', tight, 'modeling'))).toEqual(['fit clearance 0-1mm'])
  })

  it('inch-cube fails a square hole', async () => {
    const square = REFERENCES['inch-cube'].fluent.replace('jf.cylinder({ radius: 6.35, height: 60 })', 'jf.cuboid({ size: [12.7, 60, 12.7] })')
    expect(failing(await grade('inch-cube', square, 'fluent'))).toEqual(['a 1/2 inch hole removed'])
  })
})
