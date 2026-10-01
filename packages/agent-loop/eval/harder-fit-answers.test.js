import { describe, expect, it } from 'vitest'
import { ORIGINAL as TURRET, fixture as turret } from './fixtures/turret-lower.js'
import { failing, grade, startingFiles } from './reference-grade.js'

const GEAR_FLUENT = `const jf = require('@jbroll/jscad-fluent')

const gear = (teeth, module, thickness) => {
  const pitch = (module * teeth) / 2
  const [tip, root] = [pitch + module, pitch - 1.25 * module]
  const w = Math.PI / teeth
  const at = (r, a) => [r * Math.cos(a), r * Math.sin(a)]
  const points = []
  for (let n = 0; n < teeth; n++) {
    const a = 2 * w * n
    points.push(at(root, a - 0.6 * w), at(tip, a - 0.3 * w), at(tip, a + 0.3 * w), at(root, a + 0.6 * w))
  }
  return jf.polygon(points).extrudeLinear({ height: thickness }).subtract(jf.cylinder({ radius: 2.5, height: 3 * thickness }))
}

const main = () => {
  const m = 2
  return [gear(20, m, 6), gear(40, m, 6).rotateZ(Math.PI / 40).translateX(30 * m)]
}

module.exports = { main }`

const GEAR_MODELING = `const { booleans, extrusions, primitives, transforms } = require('@jscad/modeling')

const gear = (teeth, module, thickness) => {
  const pitch = (module * teeth) / 2
  const [tip, root] = [pitch + module, pitch - 1.25 * module]
  const w = Math.PI / teeth
  const at = (r, a) => [r * Math.cos(a), r * Math.sin(a)]
  const points = []
  for (let n = 0; n < teeth; n++) {
    const a = 2 * w * n
    points.push(at(root, a - 0.55 * w), at(tip, a - 0.25 * w), at(tip, a + 0.25 * w), at(root, a + 0.55 * w))
  }
  const blank = extrusions.extrudeLinear({ height: thickness }, primitives.polygon({ points }))
  return booleans.subtract(blank, primitives.cylinder({ radius: 3, height: 3 * thickness }))
}

const main = () => [gear(20, 1.5, 8), transforms.translate([70, 0, 0], gear(40, 1.5, 8))]

module.exports = { main }`

const REFERENCES = {
  'twisted-vase': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const ring = jf.roundedRectangle({ size: [70, 50], roundRadius: 10 }).subtract(jf.roundedRectangle({ size: [66, 46], roundRadius: 8 }))
  const walls = ring.extrudeLinear({ height: 120, twistAngle: Math.PI / 2, twistSteps: 48 })
  const floor = jf.roundedRectangle({ size: [68, 48], roundRadius: 9 }).extrudeLinear({ height: 2 })
  return walls.union(floor)
}

module.exports = { main }`,
    modeling: `const { booleans, extrusions, primitives } = require('@jscad/modeling')

const flower = (offset) => {
  const points = []
  for (let n = 0; n < 100; n++) {
    const a = (2 * Math.PI * n) / 100
    const r = 36 + 4 * Math.cos(5 * a) + offset
    points.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return primitives.polygon({ points })
}

const main = () => {
  const walls = extrusions.extrudeLinear({ height: 120, twistAngle: Math.PI / 2, twistSteps: 60 }, booleans.subtract(flower(0), flower(-2)))
  const floor = extrusions.extrudeLinear({ height: 2 }, flower(-1))
  return booleans.union(walls, floor)
}

module.exports = { main }`,
  },
  'spur-gears': { fluent: GEAR_FLUENT, modeling: GEAR_MODELING },
  drawer: {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const [w, d, h] = [99, 79, 49]
  const wall = 2
  const box = jf.cuboid({ size: [w, d, h] }).translateZ(h / 2)
    .subtract(jf.cuboid({ size: [w - 2 * wall, d - 2 * wall, h] }).translateZ(h / 2 + wall))
  const pull = jf.cuboid({ size: [50, 10, 10] }).translate([0, -d / 2 - 4.5, h / 2])
  return box.union(pull)
}

module.exports = { main }`,
    modeling: `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract, union } = booleans
const { cuboid, roundedRectangle } = primitives
const { translate } = transforms

const main = () => {
  const [d, w, h] = [99, 79.5, 49.5]
  const box = subtract(translate([d / 2, 0, h / 2], cuboid({ size: [d, w, h] })), translate([d / 2, 0, h / 2 + 2], cuboid({ size: [d - 4, w - 4, h] })))
  const front = translate([-1.5, 0, 26], cuboid({ size: [3, 90, 56] }))
  const finger = translate([-1.5, 0, 40], cuboid({ size: [10, 30, 12] }))
  return subtract(union(box, front), finger)
}

module.exports = { main }`,
  },
  'stacking-trays': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const tray = () => {
  const body = jf.cuboid({ size: [120, 80, 27] }).translateZ(16.5)
  const foot = jf.cuboid({ size: [115.6, 75.6, 3] }).translateZ(1.5)
  return body.union(foot).subtract(jf.cuboid({ size: [116, 76, 30] }).translateZ(20))
}

const main = () => [tray(), tray().translateX(140)]

module.exports = { main }`,
    modeling: `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract, union } = booleans
const { cuboid } = primitives
const { translateZ } = transforms

const tray = () => {
  const base = translateZ(13.5, cuboid({ size: [124, 84, 27] }))
  const rim = translateZ(28.5, cuboid({ size: [120, 80, 3] }))
  const recess = translateZ(1.5, cuboid({ size: [120.6, 80.6, 3] }))
  const cavity = translateZ(20, cuboid({ size: [116, 76, 30] }))
  return subtract(union(base, rim), recess, cavity)
}

const main = () => [tray(), translateZ(27, tray())]

module.exports = { main }`,
  },
  'bottle-cap': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const [outer, inner, height, top] = [16, 14.1, 16, 2]
  const shell = jf.cylinder({ radius: outer, height, segments: 64 }).translateZ(height / 2)
    .subtract(jf.cylinder({ radius: inner, height, segments: 64 }).translateZ(height / 2 + top))
  const profile = jf.polygon([[inner + 0.3, 0], [inner + 0.3, 2.2], [12.9, 1.3], [12.9, 0.9]])
  const thread = profile.extrudeHelical({ angle: 2 * Math.PI * 3.5, pitch: 2.7, segmentsPerRotation: 64 }).translateZ(top + 1.5)
  return shell.union(thread)
}

module.exports = { main }`,
    modeling: `const { booleans, extrusions, primitives, transforms } = require('@jscad/modeling')

const main = () => {
  const grip = extrusions.extrudeLinear({ height: 16 }, primitives.star({ vertices: 30, outerRadius: 16.6, innerRadius: 16 }))
  const bore = primitives.cylinder({ radius: 14, height: 14, center: [0, 0, 7], segments: 96 })
  const profile = primitives.polygon({ points: [[14.3, 0], [14.3, 2.2], [12.8, 1.3], [12.8, 0.9]] })
  const thread = extrusions.extrudeHelical({ angle: -2 * Math.PI * 3, pitch: 2.7, segmentsPerRotation: 64 }, profile)
  return booleans.union(booleans.subtract(grip, bore), transforms.translateZ(1, thread))
}

module.exports = { main }`,
  },
  'pi-enclosure': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const wall = 2
  const [ix, iy, h] = [88, 59, 28]
  const box = jf.cuboid({ size: [ix + 2 * wall, iy + 2 * wall, h] }).translateZ(h / 2)
    .subtract(jf.cuboid({ size: [ix, iy, h] }).translateZ(h / 2 + wall))
  const holes = [-39.5, 18.5].flatMap((x) => [-24.5, 24.5].map((y) => [x, y]))
  const posts = holes.map(([x, y]) => jf.cylinder({ radius: 3, height: 5 }).subtract(jf.cylinder({ radius: 1.25, height: 6 })).translate([x, y, wall + 2.5]))
  const ports = [[-19, 15, 16], [-1, 15, 16], [17.75, 17, 14]].map(([y, w, t]) => jf.cuboid({ size: [10, w, t] }).translate([ix / 2 + wall / 2, y, 8.5 + t / 2]))
  const lip = jf.cuboid({ size: [ix - 0.4, iy - 0.4, 3] }).subtract(jf.cuboid({ size: [ix - 4.4, iy - 4.4, 4] }))
  const bumps = [-1, 1].map((s) => jf.cuboid({ size: [20, 1, 1] }).translate([0, s * 29.6, 4]))
  const lid = jf.cuboid({ size: [ix + 2 * wall, iy + 2 * wall, 2] }).translateZ(1).union(lip.translateZ(3.5), ...bumps)
  return [box.union(...posts).subtract(...ports), lid.translateY(80)]
}

module.exports = { main }`,
    modeling: `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract, union } = booleans
const { cuboid, cylinder } = primitives
const { translate } = transforms

const main = () => {
  const wall = 2.5
  const [ix, iy, h] = [60, 89, 30]
  const box = subtract(translate([0, 0, h / 2], cuboid({ size: [ix + 2 * wall, iy + 2 * wall, h] })), translate([0, 0, h / 2 + wall], cuboid({ size: [ix, iy, h] })))
  const holes = [-24.5, 24.5].flatMap((x) => [39.5, -18.5].map((y) => [x, y]))
  const posts = holes.map(([x, y]) => translate([x, y, wall + 3], subtract(cylinder({ radius: 3.2, height: 6 }), cylinder({ radius: 1.1, height: 7 }))))
  const ports = [[-19, 16], [-1, 16], [17.75, 18]].map(([x, w]) => translate([x, -iy / 2 - wall / 2, 10 + 8], cuboid({ size: [w, 10, 16] })))
  const plate = translate([0, 0, h + 1], cuboid({ size: [ix + 2 * wall, iy + 2 * wall, 2] }))
  const lip = translate([0, 0, h - 1.5], subtract(cuboid({ size: [ix - 0.4, iy - 0.4, 3] }), cuboid({ size: [ix - 4.4, iy - 4.4, 4] })))
  return [subtract(union(box, ...posts), ...ports), union(plate, lip)]
}

module.exports = { main }`,
  },
  'bracket-m5': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const width = 40
  const t = 5
  const upright = jf.cuboid({ size: [width, t, 55] }).translate([0, t / 2, 27.5])
  const base = jf.cuboid({ size: [width, 50, t] }).translate([0, 25, t / 2])
  const hole = jf.cylinder({ radius: 2.75, height: 20 })
  return upright
    .union(base)
    .subtract(hole.rotateX(Math.PI / 2).translate([0, t / 2, 40]), hole.translate([0, 32, t / 2]))
}

module.exports = { main }`,
    modeling: `const { booleans, primitives, transforms } = require('@jscad/modeling')
const { subtract, union } = booleans
const { cuboid, cylinder, cylinderElliptic } = primitives
const { rotateX, translate } = transforms

const main = () => {
  const width = 40
  const t = 6
  const upright = translate([0, t / 2, 29], cuboid({ size: [width, t, 58] }))
  const base = translate([0, 25, t / 2], cuboid({ size: [width, 50, t] }))
  const bore = cylinder({ radius: 2.9, height: 20 })
  const sink = cylinderElliptic({ height: 3, startRadius: [2.9, 2.9], endRadius: [5.5, 5.5] })
  const countersunk = union(bore, translate([0, 0, t / 2 - 1.5 + 0.01], sink))
  return subtract(union(upright, base), translate([0, t / 2, 42], rotateX(Math.PI / 2, bore)), translate([0, 32, t / 2], countersunk))
}

module.exports = { main }`,
  },
  // A 200T azimuth gear driven in one step by a 20T pinion on the Pelton shaft outside it, and the altitude pinion behind the 100T.
  'turret-lower': {
    fluent: `const jf = require('@jbroll/jscad-fluent')

const gear = (teeth, thickness) => {
  const [tip, root, w] = [teeth / 2 + 0.9, teeth / 2 - 1, Math.PI / teeth]
  const at = (r, a) => [r * Math.cos(a), r * Math.sin(a)]
  const points = []
  for (let n = 0; n < teeth; n++) {
    const a = 2 * w * n
    points.push(at(root, a - 0.6 * w), at(tip, a - 0.3 * w), at(tip, a + 0.3 * w), at(root, a + 0.6 * w))
  }
  return jf.polygon(points).extrudeLinear({ height: thickness }).translateZ(-thickness / 2)
}

const main = (params) => {
  params.azimuth = { type: 'slider', default: 25, min: -180, max: 180, step: 1, label: 'Azimuth deg' }
  params.altitude = { type: 'slider', default: 18, min: -10, max: 60, step: 1, label: 'Altitude deg' }
  const az = (params.azimuth * Math.PI) / 180
  const al = (params.altitude * Math.PI) / 180
  const pivZ = 90
  const base = jf.cuboid({ size: [300, 230, 8] }).translate([40, 0, 4])
  const pinion = gear(20, 10).translate([110.25, 0, 16])
  const pelton = jf.cylinder({ radius: 19, height: 7 }).translate([110.25, 0, 45])
  const gun = [gear(100, 8).rotateX(Math.PI / 2), jf.cylinder({ radius: 8, height: 110 }).rotateY(Math.PI / 2).translateX(70)]
  const turret = [
    gear(200, 8).translate([0, 0, 16]),
    jf.cuboid({ size: [150, 110, 8] }).translate([0, 0, 28]),
    ...[-32, 32].map((y) => jf.cuboid({ size: [26, 10, pivZ - 32] }).translate([0, y, (pivZ + 32) / 2])),
    gear(20, 10).rotateX(Math.PI / 2).translate([-60.25, 0, pivZ]),
    ...gun.map((g) => g.rotateY(-al).translateZ(pivZ)),
  ]
  return [base, pinion, pelton, ...turret.map((g) => g.rotateZ(az))]
}

module.exports = { main }`,
    modeling: `const { extrusions, primitives, transforms } = require('@jscad/modeling')
const { cuboid, cylinder, polygon } = primitives
const { rotateX, rotateY, rotateZ, translate, translateX, translateZ } = transforms

const gear = (teeth, thickness) => {
  const [tip, root, w] = [teeth / 2 + 0.9, teeth / 2 - 1, Math.PI / teeth]
  const at = (r, a) => [r * Math.cos(a), r * Math.sin(a)]
  const points = []
  for (let n = 0; n < teeth; n++) {
    const a = 2 * w * n
    points.push(at(root, a - 0.6 * w), at(tip, a - 0.3 * w), at(tip, a + 0.3 * w), at(root, a + 0.6 * w))
  }
  return translateZ(-thickness / 2, extrusions.extrudeLinear({ height: thickness }, polygon({ points })))
}

const main = (params) => {
  params.azimuth = { type: 'slider', default: 0, min: -180, max: 180, step: 1, label: 'Azimuth' }
  params.elevation = { type: 'slider', default: 10, min: -10, max: 60, step: 1, label: 'Elevation' }
  const az = (params.azimuth * Math.PI) / 180
  const al = (params.elevation * Math.PI) / 180
  const pivZ = 90
  const base = translate([40, 0, 4], cuboid({ size: [300, 230, 8] }))
  const pinion = translate([110.25, 0, 16], gear(20, 10))
  const pelton = translate([110.25, 0, 45], cylinder({ radius: 22, height: 8 }))
  const gun = [rotateX(Math.PI / 2, gear(100, 8)), translateX(70, rotateY(Math.PI / 2, cylinder({ radius: 8, height: 110 })))]
  const turret = [
    translate([0, 0, 16], gear(200, 8)),
    translate([0, 0, 28], cuboid({ size: [150, 110, 8] })),
    ...[-32, 32].map((y) => translate([0, y, (pivZ + 32) / 2], cuboid({ size: [26, 10, pivZ - 32] }))),
    translate([-60.25, 0, pivZ], rotateX(Math.PI / 2, gear(20, 10))),
    ...gun.map((g) => translateZ(pivZ, rotateY(-al, g))),
  ]
  return [base, pinion, pelton, ...turret.map((g) => rotateZ(az, g))]
}

module.exports = { main }`,
  },
}

const block = (size) => `const jf = require('@jbroll/jscad-fluent')\nmodule.exports = { main: () => jf.cuboid({ size: [${size}] }) }\n`

const BLOCKS = {
  'twisted-vase': block('60, 60, 120'),
  'spur-gears': block('44, 44, 6'),
  drawer: block('99, 79, 49'),
  'stacking-trays': block('120, 80, 30'),
  'bottle-cap': block('32, 32, 16'),
  'pi-enclosure': block('92, 63, 28'),
  'bracket-m5': block('40, 50, 55'),
  'turret-lower': block('190, 150, 150'),
}

const cases = Object.entries(REFERENCES).flatMap(([name, sources]) => Object.entries(sources).map(([api, source]) => [name, api, source]))

// Each case builds and grades real geometry; under the full parallel suite a
// 1 s grade can take over 5 s.
describe('harder fit and profile fixtures against reference answers', { timeout: 30_000 }, () => {
  it.each(cases)('%s passes its %s reference answer', async (name, api, source) => {
    expect(failing(await grade(name, source, api))).toEqual([])
  })

  it.each(Object.entries(BLOCKS))('%s fails a plain block', async (name, source) => {
    expect(failing(await grade(name, source, 'fluent')).length).toBeGreaterThan(0)
  })

  it('twisted-vase fails half the twist, and a round vase whose twist cannot show', async () => {
    const half = REFERENCES['twisted-vase'].fluent.replace('twistAngle: Math.PI / 2', 'twistAngle: Math.PI / 4')
    expect(failing(await grade('twisted-vase', half, 'fluent'))).toEqual(['twists 90 degrees bottom to top'])
    const round = REFERENCES['twisted-vase'].modeling.replace('4 * Math.cos(5 * a)', '0')
    expect(failing(await grade('twisted-vase', round, 'modeling'))).toEqual(['twists 90 degrees bottom to top'])
  })

  it('twisted-vase fails 4mm walls', async () => {
    const thick = REFERENCES['twisted-vase'].modeling.replace('flower(-2)', 'flower(-4)')
    expect(failing(await grade('twisted-vase', thick, 'modeling'))).toEqual(['2mm walls'])
  })

  it('spur-gears fails 20 and 30 teeth, mixed modules, and gears meshed too far apart', async () => {
    const thirty = GEAR_FLUENT.replace('gear(40, m, 6).rotateZ(Math.PI / 40).translateX(30 * m)', 'gear(30, m, 6).translateX(100)')
    expect(failing(await grade('spur-gears', thirty, 'fluent'))).toEqual(['20 and 40 teeth', 'same module', 'meshed at the pitch distance, or laid out apart'])
    const mixed = GEAR_MODELING.replace('gear(40, 1.5, 8)', 'gear(40, 1.2, 8)')
    expect(failing(await grade('spur-gears', mixed, 'modeling'))).toEqual(['same module'])
    const far = GEAR_FLUENT.replace('translateX(30 * m)', 'translateX(30 * m + 3.5)')
    expect(failing(await grade('spur-gears', far, 'fluent'))).toEqual(['meshed at the pitch distance, or laid out apart'])
  })

  it('drawer fails the opening size with no clearance, and a drawer with no handle', async () => {
    const tight = REFERENCES.drawer.fluent.replace('[99, 79, 49]', '[100, 80, 50]')
    expect(failing(await grade('drawer', tight, 'fluent'))).toEqual(['fits the opening with 0.5mm clearance', 'a handle on the front', 'hollow with an open top'])
    const plain = REFERENCES.drawer.modeling.replace('return subtract(union(box, front), finger)', 'return union(box, front)')
    expect(failing(await grade('drawer', plain, 'modeling'))).toEqual(['a handle on the front'])
  })

  it('stacking-trays fails plain boxes, a foot too big for the rim, and a loose one', async () => {
    const plain = REFERENCES['stacking-trays'].fluent.replace('[115.6, 75.6, 3]', '[120, 80, 3]')
    expect(failing(await grade('stacking-trays', plain, 'fluent'))).toEqual(['one nests into the other', 'nested with under 1mm of play'])
    const tight = REFERENCES['stacking-trays'].fluent.replace('[115.6, 75.6, 3]', '[116.4, 76.4, 3]')
    expect(failing(await grade('stacking-trays', tight, 'fluent'))).toEqual(['one nests into the other', 'nested with under 1mm of play'])
    const loose = REFERENCES['stacking-trays'].fluent.replace('[115.6, 75.6, 3]', '[114, 74, 3]')
    expect(failing(await grade('stacking-trays', loose, 'fluent'))).toEqual(['nested with under 1mm of play'])
  })

  it('bottle-cap fails a plain cup, stacked rings instead of a helix, and a thread sized for a 30mm neck', async () => {
    const plain = REFERENCES['bottle-cap'].fluent.replace('return shell.union(thread)', 'return shell')
    expect(failing(await grade('bottle-cap', plain, 'fluent'))).toEqual(['thread fits a 28mm neck', 'helical thread'])
    const rings = REFERENCES['bottle-cap'].fluent.replace(
      "const thread = profile.extrudeHelical({ angle: 2 * Math.PI * 3.5, pitch: 2.7, segmentsPerRotation: 64 }).translateZ(top + 1.5)",
      'const ring = profile.extrudeRotate({ segments: 96 })\n  const thread = ring.translateZ(4).union(ring.translateZ(7), ring.translateZ(10))',
    )
    expect(failing(await grade('bottle-cap', rings, 'fluent'))).toEqual(['thread fits a 28mm neck', 'helical thread'])
    const wide = REFERENCES['bottle-cap'].modeling.replace('radius: 14,', 'radius: 15.2,').replace('[[14.3, 0], [14.3, 2.2], [12.8, 1.3], [12.8, 0.9]]', '[[15.5, 0], [15.5, 2.2], [14.3, 1.3], [14.3, 0.9]]')
    expect(failing(await grade('bottle-cap', wide, 'modeling'))).toEqual(['thread fits a 28mm neck'])
  })

  it('pi-enclosure fails ports in the wrong end wall, no lid, and posts on a square pattern', async () => {
    const wrongEnd = REFERENCES['pi-enclosure'].fluent.replace('translate([ix / 2 + wall / 2, y, 8.5 + t / 2])', 'translate([-ix / 2 - wall / 2, y, 8.5 + t / 2])')
    expect(failing(await grade('pi-enclosure', wrongEnd, 'fluent'))).toEqual(['USB and Ethernet openings in the port end'])
    const noLid = REFERENCES['pi-enclosure'].modeling.replace('return [subtract(union(box, ...posts), ...ports), union(plate, lip)]', 'return subtract(union(box, ...posts), ...ports)')
    expect(failing(await grade('pi-enclosure', noLid, 'modeling'))).toEqual(['a separate lid'])
    const square = REFERENCES['pi-enclosure'].fluent.replace('[-24.5, 24.5]', '[-29, 29]')
    expect(failing(await grade('pi-enclosure', square, 'fluent'))).toContain('standoffs on the 58 x 49 hole pattern')
  })

  it.each(['fluent', 'modeling'])('bracket-m5: the %s starting bracket fails the height and the holes', async (api) => {
    const results = await grade('bracket-m5', startingFiles('bracket-m5', api), api)
    expect(failing(results)).toEqual(['under 60mm tall', 'an M5 bolt passes every hole'])
  })

  it('bracket-m5 fails holes the size of the bolt, and a bracket left 70mm tall', async () => {
    const snug = REFERENCES['bracket-m5'].fluent.replace('radius: 2.75', 'radius: 2.5')
    expect(failing(await grade('bracket-m5', snug, 'fluent'))).toEqual(['an M5 bolt passes every hole'])
    const tall = startingFiles('bracket-m5', 'fluent').replace('jf.cylinder({ radius: 2, height: 20 })', 'jf.cylinder({ radius: 2.75, height: 20 })')
    expect(failing(await grade('bracket-m5', tall, 'fluent'))).toEqual(['under 60mm tall'])
  })

  it.each(['fluent', 'modeling'])('turret-lower: the %s starting turret from the log fails the height and the two-stage azimuth train', async (api) => {
    const { graded, results } = await grade('turret-lower', turret.apiFiles[api]['index.js'], api)
    expect(graded.measure.dimensions[2]).toBeCloseTo(TURRET.height, 3)
    expect(failing({ results })).toEqual(['at least 5% lower', 'azimuth driven by one gear pair'])
  }, 30000)

  it('turret-lower fails a lowered deck over the two-stage azimuth train, and a single reduction left as tall', async () => {
    const lowered = turret.apiFiles.fluent['index.js'].replace('deckZ = 68', 'deckZ = 40')
    expect(failing(await grade('turret-lower', lowered, 'fluent'))).toEqual(['azimuth driven by one gear pair'])
    const tall = REFERENCES['turret-lower'].modeling.replace('const pivZ = 90', 'const pivZ = 180')
    expect(failing(await grade('turret-lower', tall, 'modeling'))).toEqual(['at least 5% lower'])
  }, 30000)
})
