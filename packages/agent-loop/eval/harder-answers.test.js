import { describe, expect, it } from 'vitest'
import { ORIGINAL } from './fixtures/stand-bigger-slots.js'
import { failing, grade, startingFiles } from './reference-grade.js'

const REFERENCES = {
  'stand-bigger-slots': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = (params) => {
  params.height = { type: 'slider', default: 108, min: 60, max: 190, step: 5, label: 'Height' }
  const r = 2
  const base = jf.roundedCuboid({ size: [96, 84, 6], roundRadius: r, segments: 16 }).translateZ(3)
  const back = jf.roundedCuboid({ size: [96, 6, params.height], roundRadius: r, segments: 16 })
    .translateZ(params.height / 2)
    .rotateX((-15 * Math.PI) / 180)
    .translate([0, 36, 3.6])
  const lip = jf.roundedCuboid({ size: [96, 9.6, 14.4], roundRadius: r, segments: 16 }).translate([0, -37.2, 7.2])
  const slots = [-20, 20].map((x) => jf.cuboid({ size: [14.4, 36, 24] }).translate([x, -30, 6]))
  return base.union(back, lip).subtract(...slots)
}

module.exports = { main }`,
    modeling: `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract, union } = booleans
const { cuboid, roundedCuboid } = primitives
const { rotateX, scale, translate } = transforms

const main = () => {
  const rounded = (size) => roundedCuboid({ size, roundRadius: 1.5, segments: 12 })
  const base = translate([0, 0, 2.5], rounded([80, 70, 5]))
  const back = translate([0, 30, 3], rotateX((-15 * Math.PI) / 180, translate([0, 0, 45], rounded([80, 5, 90]))))
  const lip = translate([0, -31, 6], rounded([80, 8, 12]))
  const slots = [-18, 18].map((x) => translate([x, -25, 5], cuboid({ size: [12, 30, 20] })))
  return scale([1.2, 1.2, 1.2], subtract(union(base, back, lip), ...slots))
}

module.exports = { main }`,
  },
  'box-thicker-lid': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const wall = 3
  const size = [60, 40, 30]
  const inside = jf.cuboid({ size: [size[0] - 2 * wall, size[1] - 2 * wall, size[2]] }).translateZ(wall)
  const box = jf.cuboid({ size }).subtract(inside)
  const plug = jf.cuboid({ size: [size[0] - 2 * wall - 0.4, size[1] - 2 * wall - 0.4, 4] }).translateZ(3)
  const lid = jf.cuboid({ size: [size[0], size[1], 2] }).union(plug)
  return [box, lid.translate([75, 0, -14])]
}

module.exports = { main }`,
    modeling: `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract } = booleans
const { cuboid } = primitives
const { translate, translateZ } = transforms

const main = () => {
  const wall = 4
  const size = [68, 48, 30]
  const box = subtract(cuboid({ size }), translateZ(wall, cuboid({ size: [size[0] - 2 * wall, size[1] - 2 * wall, size[2]] })))
  const skirt = [size[0] + 2 * 2.3, size[1] + 2 * 2.3, 10]
  const lid = subtract(cuboid({ size: skirt }), translateZ(2, cuboid({ size: [size[0] + 0.6, size[1] + 0.6, 10] })))
  return [box, translate([0, 0, 12], transforms.rotateX(Math.PI, lid))]
}

module.exports = { main }`,
  },
  'holes-through-side': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const hole = jf.cylinder({ radius: 4, height: 50 }).rotateX(Math.PI / 2)
  return jf.cuboid({ size: [60, 40, 30] }).subtract(hole.translateX(-15), hole.translateX(15))
}

module.exports = { main }`,
    modeling: `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract } = booleans
const { cuboid, cylinder } = primitives
const { rotateY, translateY } = transforms

const main = () => {
  const hole = rotateY(Math.PI / 2, cylinder({ radius: 4, height: 70 }))
  return subtract(cuboid({ size: [60, 40, 30] }), translateY(-10, hole), translateY(10, hole))
}

module.exports = { main }`,
  },
  'sliding-lid-box': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const groove = jf.cuboid({ size: [80, 47, 2.4] }).translate([1.5, 0, 16])
  const entry = jf.cuboid({ size: [4, 47, 6] }).translate([39, 0, 19])
  const box = jf.cuboid({ size: [80, 50, 40] })
    .subtract(jf.cuboid({ size: [74, 44, 40] }).translateZ(3), groove, entry)
  const lid = jf.cuboid({ size: [78, 46.4, 2] })
  return [box, lid.translate([0, 70, -19])]
}

module.exports = { main }`,
    modeling: `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract } = booleans
const { cuboid } = primitives
const { translate } = transforms

const main = () => {
  const groove = translate([1.5, 0, 16], cuboid({ size: [80, 47, 2.4] }))
  const entry = translate([39, 0, 19], cuboid({ size: [4, 47, 6] }))
  const box = subtract(cuboid({ size: [80, 50, 40] }), translate([0, 0, 3], cuboid({ size: [74, 44, 40] })), groove, entry)
  const lid = translate([1, 0, 16], cuboid({ size: [78, 46.4, 2] }))
  return [box, lid]
}

module.exports = { main }`,
  },
  'hinge': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const knuckle = (x, length) => jf.cylinder({ radius: 5, height: length }).rotateY(Math.PI / 2).translateX(x)
  const bridge = (x, length, side) => jf.cuboid({ size: [length, 6, 3] }).translate([x, side * 3, 0])
  const leaf = (xs, length, side) =>
    jf.cuboid({ size: [40, 24.6, 3] }).translateY(side * 17.7)
      .union(...xs.map((x) => knuckle(x, length)), ...xs.map((x) => bridge(x, length, side)))
      .subtract(jf.cylinder({ radius: 2.3, height: 44 }).rotateY(Math.PI / 2))
  const pin = jf.cylinder({ radius: 2, height: 40 }).rotateY(Math.PI / 2)
  return [leaf([-16, 0, 16], 7.6, -1), leaf([-8, 8], 7.6, 1), pin]
}

module.exports = { main }`,
    modeling: `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract, union } = booleans
const { cuboid, cylinder } = primitives
const { rotateY, translate } = transforms

const main = () => {
  const alongX = (radius, height) => rotateY(Math.PI / 2, cylinder({ radius, height, segments: 24 }))
  const leaf = (xs, side) => {
    const plate = translate([0, side * 17.7, 0], cuboid({ size: [40, 24.6, 3] }))
    const knuckles = xs.map((x) => union(translate([x, 0, 0], alongX(5, 7.6)), translate([x, side * 3, 0], cuboid({ size: [7.6, 6, 3] }))))
    return subtract(union(plate, ...knuckles), alongX(2.25, 44))
  }
  const pin = translate([0, 0, 20], alongX(1.9, 40))
  return [leaf([-16, 0, 16], -1), translate([0, 50, 0], leaf([-8, 8], 1)), pin]
}

module.exports = { main }`,
  },
  'bracket-params': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = (params) => {
  params.width = { type: 'slider', default: 30, min: 15, max: 80, label: 'Width' }
  params.height = { type: 'slider', default: 80, min: 40, max: 200, label: 'Height' }
  params.depth = { type: 'slider', default: 100, min: 40, max: 250, label: 'Depth' }
  params.hole = { type: 'number', default: 4.5, min: 3, max: 8, step: 0.5, label: 'Screw hole size' }
  const t = 5
  const { width, height, depth, hole } = params
  const screw = jf.cylinder({ radius: hole / 2, height: t * 3 })
  const wall = jf.cuboid({ size: [width, t, height] }).translate([0, t / 2, height / 2])
    .subtract(screw.rotateX(Math.PI / 2).translate([0, t / 2, height * 0.7]))
  const shelf = jf.cuboid({ size: [width, depth, t] }).translate([0, depth / 2, t / 2])
    .subtract(screw.translate([0, depth * 0.7, t / 2]))
  return wall.union(shelf)
}

module.exports = { main }`,
    modeling: `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract, union } = booleans
const { cuboid, cylinder } = primitives
const { rotateX, translate } = transforms

const main = (params) => {
  params.bracket = {
    _type: 'Shelf Bracket',
    width: { type: 'slider', default: 25, min: 15, max: 60 },
    height: { type: 'slider', default: 120, min: 50, max: 250 },
    thickness: { type: 'slider', default: 6, min: 3, max: 12 },
    screwHole: { type: 'slider', default: 5, min: 3, max: 9 },
  }
  const { width, height, thickness, screwHole } = params.bracket
  const arm = height * 0.8
  const screw = cylinder({ radius: screwHole / 2, height: thickness * 3 })
  const upright = subtract(
    translate([0, thickness / 2, height / 2], cuboid({ size: [width, thickness, height] })),
    translate([0, thickness / 2, height * 0.75], rotateX(Math.PI / 2, screw)),
    translate([0, thickness / 2, height * 0.3], rotateX(Math.PI / 2, screw)),
  )
  const shelf = subtract(translate([0, arm / 2, thickness / 2], cuboid({ size: [width, arm, thickness] })), translate([0, arm * 0.7, thickness / 2], screw))
  return union(upright, shelf)
}

module.exports = { main }`,
  },
  'luggage-tag': {
    fluent: `const jf = require('@jbroll/jscad-fluent')
const jscadText = require('@jscadui/jscad-text')

const main = () => {
  const tag = jf.roundedRectangle({ size: [90, 50], roundRadius: 6 }).extrudeLinear({ height: 3 })
  const name = new jf.FluentGeom2(jscadText.text2d('SAM', { size: 18, font: 'Liberation Sans', halign: 'center', valign: 'center' }))
    .extrudeLinear({ height: 5 }).translate([8, 0, -1])
  const strap = jf.roundedRectangle({ size: [5, 16], roundRadius: 2.5 }).extrudeLinear({ height: 5 }).translate([-36, 0, -1])
  return tag.subtract(name, strap)
}

module.exports = { main }`,
    modeling: `const { booleans, extrusions, primitives, transforms } = require('@jscad/modeling')
const jscadText = require('@jscadui/jscad-text')
const { subtract } = booleans
const { extrudeLinear } = extrusions
const { cuboid, cylinder } = primitives
const { translate } = transforms

const main = () => {
  const tag = cuboid({ size: [80, 40, 3] })
  const name = translate([6, 0, -3], extrudeLinear({ height: 6 }, jscadText.text2d('SAM', { size: 14, halign: 'center', valign: 'center' })))
  const strap = translate([-32, 0, 0], cylinder({ radius: 3, height: 6 }))
  return subtract(tag, name, strap)
}

module.exports = { main }`,
  },
}

const block = (size) => `const jf = require('@jbroll/jscad-fluent')\nmodule.exports = { main: () => jf.cuboid({ size: [${size}] }) }\n`

const BLOCKS = {
  'stand-bigger-slots': block('96, 108, 108'),
  'box-thicker-lid': block('60, 40, 30'),
  'holes-through-side': block('60, 40, 30'),
  'sliding-lid-box': block('80, 50, 40'),
  hinge: block('40, 35, 10'),
  'bracket-params': block('30, 100, 80'),
  'luggage-tag': block('90, 50, 3'),
}

const cases = Object.entries(REFERENCES).flatMap(([name, sources]) => Object.entries(sources).map(([api, source]) => [name, api, source]))
const apis = ['fluent', 'modeling']

describe('harder fixtures against reference answers', () => {
  it.each(cases)('%s passes its %s reference answer', async (name, api, source) => {
    expect(failing(await grade(name, source, api))).toEqual([])
  })

  it.each(Object.entries(BLOCKS))('%s fails a plain block', async (name, source) => {
    expect(failing(await grade(name, source, 'fluent')).length).toBeGreaterThan(0)
  })

  it.each(apis)('stand-bigger-slots: the %s starting model matches ORIGINAL and fails all three changes', async (api) => {
    const { graded, results } = await grade('stand-bigger-slots', startingFiles('stand-bigger-slots', api), api)
    graded.measure.dimensions.forEach((d, k) => expect(d).toBeCloseTo(ORIGINAL.dimensions[k], 3))
    expect(graded.probe.bodies.map((b) => b.polygonCount)).toEqual([ORIGINAL.polygonCount])
    expect(failing({ results })).toEqual(['about 20% bigger', 'two cable slots', 'rounded edges'])
  })

  it('stand-bigger-slots fails a bigger stand with two slots and sharp edges, and a rounded one with one slot', async () => {
    const sharp = startingFiles('stand-bigger-slots', 'fluent').replace(
      'return base.union(back, lip).subtract(slot)',
      'return base.union(back, lip).subtract(slot.translateX(-18), slot.translateX(18)).scale([1.2, 1.2, 1.2])',
    )
    expect(failing(await grade('stand-bigger-slots', sharp, 'fluent'))).toEqual(['rounded edges'])
    const oneSlot = REFERENCES['stand-bigger-slots'].modeling.replace('[-18, 18]', '[0]')
    expect(failing(await grade('stand-bigger-slots', oneSlot, 'modeling'))).toEqual(['two cable slots'])
  })

  it.each(apis)('box-thicker-lid: the %s starting model fails the walls and the lid', async (api) => {
    const results = await grade('box-thicker-lid', startingFiles('box-thicker-lid', api), api)
    expect(failing(results)).toEqual(['box and lid are separate parts', 'walls thicker than 2mm', 'lid covers the opening'])
  })

  it('box-thicker-lid fails thicker walls with no lid', async () => {
    const noLid = startingFiles('box-thicker-lid', 'fluent').replace('const wall = 2', 'const wall = 3')
    expect(failing(await grade('box-thicker-lid', noLid, 'fluent'))).toEqual(['box and lid are separate parts', 'lid covers the opening'])
  })

  it.each(apis)('holes-through-side: the %s starting model, holes through the top, fails', async (api) => {
    const results = await grade('holes-through-side', startingFiles('holes-through-side', api), api)
    expect(failing(results)).toEqual(['no holes through the top', 'two 8mm holes through a side'])
  })

  it('holes-through-side fails side holes added beside the top ones', async () => {
    const both = REFERENCES['holes-through-side'].fluent.replace(
      'hole.translateX(-15), hole.translateX(15))',
      'hole.translateX(-15), hole.translateX(15), jf.cylinder({ radius: 4, height: 40 }))',
    )
    expect(failing(await grade('holes-through-side', both, 'fluent'))).toEqual(['no holes through the top'])
  })

  it('sliding-lid-box fails a lid that cuts into the walls, and one fused to the box', async () => {
    const overlapping = REFERENCES['sliding-lid-box'].modeling.replace('cuboid({ size: [78, 46.4, 2] })', 'cuboid({ size: [78, 50, 2] })')
    expect(failing(await grade('sliding-lid-box', overlapping, 'modeling'))).toEqual(['parts do not overlap'])
    const fused = REFERENCES['sliding-lid-box'].modeling.replace('return [box, lid]', 'return union(box, translate([0, 0, 1], lid))').replace('const { subtract }', 'const { subtract, union }')
    expect(failing(await grade('sliding-lid-box', fused, 'modeling'))).toContain('box and lid are separate parts')
  })

  it('hinge fails a pin as wide as the bore, and leaves with no pin', async () => {
    const tight = REFERENCES.hinge.fluent.replace('jf.cylinder({ radius: 2, height: 40 })', 'jf.cylinder({ radius: 2.3, height: 40 })')
    expect(failing(await grade('hinge', tight, 'fluent'))).toEqual(['pin turns in the knuckles with clearance'])
    const noPin = REFERENCES.hinge.fluent.replace(', pin]', ']')
    expect(failing(await grade('hinge', noPin, 'fluent'))).toEqual(['two leaves and a pin', 'pin turns in the knuckles with clearance'])
  })

  it('bracket-params fails a fixed hole size, and a hole size parameter the model never reads', async () => {
    const fixed = REFERENCES['bracket-params'].fluent
      .replace("  params.hole = { type: 'number', default: 4.5, min: 3, max: 8, step: 0.5, label: 'Screw hole size' }\n", '')
      .replace('const { width, height, depth, hole } = params', 'const { width, height, depth } = params\n  const hole = 4.5')
    expect(failing(await grade('bracket-params', fixed, 'fluent'))).toEqual(['width, height and hole size parameters', 'each one changes the model'])
    const unread = REFERENCES['bracket-params'].modeling.replace('radius: screwHole / 2', 'radius: 2.5')
    expect(failing(await grade('bracket-params', unread, 'modeling'))).toEqual(['each one changes the model'])
  })

  it('luggage-tag fails a raised name, and a name with no strap hole', async () => {
    const raised = REFERENCES['luggage-tag'].fluent.replace('.translate([8, 0, -1])', '.translate([8, 0, 2])').replace('tag.subtract(name, strap)', 'tag.union(name).subtract(strap)')
    expect(failing(await grade('luggage-tag', raised, 'fluent'))).toEqual(['the name is cut through', 'a strap hole beside the name'])
    const noStrap = REFERENCES['luggage-tag'].modeling.replace('subtract(tag, name, strap)', 'subtract(tag, name)')
    expect(failing(await grade('luggage-tag', noStrap, 'modeling'))).toEqual(['a strap hole beside the name'])
  })
})
