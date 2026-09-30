import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { check, measure } from '@jscadui/model-tools'
import { APIS } from '../src/api.js'
import { TOOLS } from '../src/tools.js'
import { loadFixtures } from './run-eval.js'

const names = new Set(TOOLS.map((t) => t.name))
const files = readdirSync(new URL('./fixtures/', import.meta.url)).filter((f) => f.endsWith('.js')).sort()
const fixtures = await loadFixtures()
const byName = Object.fromEntries(fixtures.map((f) => [f.name, f]))
const { primitives, booleans, transforms, geometries } = createRequire(import.meta.url)('@jscad/modeling')

// A fixture whose checks read `solid` needs it built the same way the eval backend
// builds it: `check()` on the single-entity geometry array.
const ctx = (shape, extra = {}) => ({ ...extra, solid: check([shape]) })

describe('eval fixtures', () => {
  it('loads one fixture per file, named after the file', () => {
    expect(fixtures.map((f) => `${f.name}.js`)).toEqual(files)
  })

  for (const fixture of fixtures) {
    it(`${fixture.name}: declares known tools, a prompt, and function checks`, () => {
      expect(fixture.prompt.trim().length).toBeGreaterThan(0)
      expect(fixture.requires.length).toBeGreaterThan(0)
      for (const tool of fixture.requires) expect(names.has(tool)).toBe(true)
      expect(fixture.requires).not.toContain('view')
      expect(fixture.requires).not.toContain('export')
      expect(typeof fixture.checks).toBe('function')
      expect(typeof fixture.maxTurns).toBe('number')
    })

    it(`${fixture.name}: leaves the API to the setting`, () => {
      if (fixture.api !== undefined) expect(APIS).toContain(fixture.api)
      expect(fixture.prompt).not.toMatch(/fluent|@jscad|modeling|\bjf\b/i)
    })
  }

  it('runs the fluent style checks only under the fluent api', () => {
    expect(byName['fluent-chain'].api).toBe('fluent')
    expect(fixtures.filter((f) => f.api).map((f) => f.name)).toEqual(['fluent-chain'])
  })

  it.each([
    ['single-sphere', () => primitives.sphere({ radius: 10 }), {}],
    ['rounded-box', () => primitives.roundedCuboid({ size: [30, 20, 10], roundRadius: 2 }), {}],
    ['cylinder-param', () => primitives.cylinder({ radius: 5, height: 20 }), { params: [{ name: 'height', type: 'slider' }] }],
    ['misspelled-option', () => primitives.roundedCuboid({ size: [30, 20, 10], roundRadius: 3 }), {}],
  ])('%s passes a matching model', (name, shape, context) => {
    expect(byName[name].checks(measure([shape()], {}), context).every((c) => c.pass)).toBe(true)
  })

  it('misspelled-option fails the default and a 2mm radius, passes 3mm at 16 segments', () => {
    const passes = (roundRadius, segments = 32) =>
      byName['misspelled-option'].checks(measure([primitives.roundedCuboid({ size: [30, 20, 10], roundRadius, segments })], {}), {}).every((c) => c.pass)
    expect(passes(0.2)).toBe(false)
    expect(passes(2)).toBe(false)
    expect(passes(3, 16)).toBe(true)
  })

  it('single-sphere fails a cube', () => {
    expect(byName['single-sphere'].checks(measure([primitives.cube({ size: 20 })], {}), {}).every((c) => c.pass)).toBe(false)
  })

  it('cylinder-param fails without a slider', () => {
    expect(byName['cylinder-param'].checks(measure([primitives.cylinder({ radius: 5, height: 20 })], {}), { params: [] }).every((c) => c.pass)).toBe(false)
  })

  it('fluent-chain passes a method-chained model with the right geometry', () => {
    const { booleans, transforms, primitives: p } = createRequire(import.meta.url)('@jscad/modeling')
    const cyl = () => p.cylinder({ radius: 5, height: 40 })
    const cube = booleans.subtract(
      booleans.subtract(booleans.subtract(p.cuboid({ size: [30, 30, 30] }), cyl()), transforms.rotateX(Math.PI / 2, cyl())),
      transforms.rotateY(Math.PI / 2, cyl()),
    )
    const source = `const jf = require('@jbroll/jscad-fluent')
let shape = jf.cube({ size: 30 })
shape = shape.subtract(jf.cylinder({ radius: 5, height: 40 }))
shape = shape.subtract(jf.cylinder({ radius: 5, height: 40 }).rotateX(Math.PI / 2))
shape = shape.subtract(jf.cylinder({ radius: 5, height: 40 }).rotateY(Math.PI / 2))
module.exports = { main: () => [shape] }`
    expect(byName['fluent-chain'].checks(measure([cube], {}), ctx(cube, { source })).every((c) => c.pass)).toBe(true)
  })

  it('fluent-chain fails a free jf.subtract(...) source with the right geometry', () => {
    const { booleans, transforms, primitives: p } = createRequire(import.meta.url)('@jscad/modeling')
    const cyl = () => p.cylinder({ radius: 5, height: 40 })
    const cube = booleans.subtract(p.cuboid({ size: [30, 30, 30] }), cyl(), transforms.rotateX(Math.PI / 2, cyl()), transforms.rotateY(Math.PI / 2, cyl()))
    const source = `const jf = require('@jbroll/jscad-fluent')
const cube = jf.cube({ size: 30 })
const cz = jf.cylinder({ radius: 5, height: 40 })
const cx = jf.cylinder({ radius: 5, height: 40 }).rotateX(Math.PI / 2)
const cy = jf.cylinder({ radius: 5, height: 40 }).rotateY(Math.PI / 2)
module.exports = { main: () => [jf.subtract(cube, cz, cx, cy)] }`
    const results = byName['fluent-chain'].checks(measure([cube], {}), ctx(cube, { source }))
    expect(results.every((c) => c.pass)).toBe(false)
    expect(results.find((c) => c.name === 'no free combine').pass).toBe(false)
    expect(results.find((c) => c.name === '30mm extents').pass).toBe(true)
    expect(results.find((c) => c.name === 'holes remove material but leave most of it').pass).toBe(true)
  })
})

describe('CSG fixture reference models', () => {
  const { primitives: p } = createRequire(import.meta.url)('@jscad/modeling')
  const passes = (name, solid) => byName[name].checks(measure([solid], {}), ctx(solid)).every((c) => c.pass)

  // A 40mm-diameter, 5mm-thick disc stands in for a real gear profile: the checks
  // can't tell a tooth from a smooth rim, only the overall size.
  it('gear passes a 40mm disc placeholder', () => {
    expect(passes('gear', p.cylinder({ radius: 20, height: 5 }))).toBe(true)
  })

  it('gear fails a plate the wrong size entirely', () => {
    expect(passes('gear', p.cuboid({ size: [200, 200, 1] }))).toBe(false)
  })

  it('cube-hole passes a 20mm cube with a through-hole', () => {
    const shape = booleans.subtract(p.cuboid({ size: [20, 20, 20] }), p.cylinder({ radius: 5, height: 25 }))
    expect(passes('cube-hole', shape)).toBe(true)
  })

  it('cube-hole fails a solid cube (no hole)', () => {
    expect(passes('cube-hole', p.cuboid({ size: [20, 20, 20] }))).toBe(false)
  })

  // An L made from two overlapping arms, ~60mm wide.
  function lBracket({ w = 60, arm = 40, t = 8 } = {}) {
    const upright = p.cuboid({ size: [w, arm, t] })
    const foot = transforms.translate([0, -(arm - t) / 2, (arm - t) / 2], p.cuboid({ size: [w, t, arm] }))
    return booleans.union(upright, foot)
  }

  it('bracket passes an L-shaped reference model', () => {
    expect(passes('bracket', lBracket())).toBe(true)
  })

  it('bracket fails a flat plate (no L shape)', () => {
    expect(passes('bracket', p.cuboid({ size: [60, 40, 8] }))).toBe(false)
  })

  it('shelf-bracket passes an L-shaped reference model', () => {
    expect(passes('shelf-bracket', lBracket({ w: 50, arm: 40, t: 5 }))).toBe(true)
  })

  it('shelf-bracket fails a flat plate (no L shape)', () => {
    expect(passes('shelf-bracket', p.cuboid({ size: [50, 40, 5] }))).toBe(false)
  })

  // A 76x60x25mm open shell (2mm walls/floor) with four cornered, drilled screw posts,
  // big enough to hold an Arduino Uno (68.6 x 53.4mm).
  function enclosurePlaceholder(segments, { holes = true, wall = 2, w = 76, h = 60, height = 25 } = {}) {
    const outer = p.cuboid({ size: [w, h, height] })
    const cavity = transforms.translateZ(wall / 2, p.cuboid({ size: [w - 2 * wall, h - 2 * wall, height - wall] }))
    const shell = booleans.subtract(outer, cavity)
    const postR = 3
    const postH = height - wall - 2
    const floorTopZ = -height / 2 + wall
    const positions = [[w / 2 - 8, h / 2 - 8], [-(w / 2 - 8), h / 2 - 8], [w / 2 - 8, -(h / 2 - 8)], [-(w / 2 - 8), -(h / 2 - 8)]]
    let posts = null
    for (const [x, y] of positions) {
      const post = holes
        ? booleans.subtract(p.cylinder({ radius: postR, height: postH, segments }), p.cylinder({ radius: 1.25, height: postH + 1, segments }))
        : p.cylinder({ radius: postR, height: postH, segments })
      const placed = transforms.translate([x, y, floorTopZ + postH / 2], post)
      posts = posts ? booleans.union(posts, placed) : placed
    }
    return booleans.union(shell, posts)
  }

  it.each([32, 64])('enclosure passes its reference model at %i segments', (segments) => {
    expect(passes('enclosure', enclosurePlaceholder(segments))).toBe(true)
  })

  it('enclosure passes a base with its lid printed beside it', () => {
    const lid = transforms.translateX(126, p.cuboid({ size: [76, 60, 2] }))
    const layout = booleans.union(enclosurePlaceholder(32), lid)
    expect(Math.max(...measure([layout], {}).dimensions)).toBeCloseTo(202)
    expect(passes('enclosure', layout)).toBe(true)
  })

  it('enclosure fails a box too big for a desk', () => {
    expect(passes('enclosure', enclosurePlaceholder(32, { w: 300, h: 60 }))).toBe(false)
  })

  it('enclosure fails a solid box (no cavity)', () => {
    expect(passes('enclosure', p.cuboid({ size: [76, 60, 25] }))).toBe(false)
  })

  // Two colinear 20mm-OD, 2mm-wall arms (the run) plus a perpendicular branch, each 30mm from center.
  function pipeTee(segments, branchLen = 30) {
    const armLen = 30
    const run = (r) => transforms.rotateY(Math.PI / 2, p.cylinder({ radius: r, height: armLen * 2, segments }))
    const branch = (r) => transforms.translateY(branchLen / 2, transforms.rotateX(Math.PI / 2, p.cylinder({ radius: r, height: branchLen, segments })))
    const outer = booleans.union(run(10), branch(10))
    return booleans.subtract(outer, booleans.union(run(8), branch(8)))
  }

  it.each([32, 64])('pipe-tee passes its reference model at %i segments', (segments) => {
    expect(passes('pipe-tee', pipeTee(segments))).toBe(true)
  })

  // A standard 20mm tee is about 40mm to the branch end; 38 is still a tee.
  it('pipe-tee passes a branch 28mm from center, and not one 24mm', () => {
    expect(passes('pipe-tee', pipeTee(32, 28))).toBe(true)
    expect(passes('pipe-tee', pipeTee(32, 24))).toBe(false)
  })

  it('pipe-tee fails a solid block', () => {
    expect(passes('pipe-tee', p.cuboid({ size: [20, 40, 60] }))).toBe(false)
  })

  // A 300x200x5mm panel with a grid of holes on 30mm centers, 15mm in from the edges.
  function pegboardPanel(segments, { holes = true, w = 300, h = 200, t = 5, pitch = 30, inset = 15, holeR = 4 } = {}) {
    const plate = p.cuboid({ size: [w, h, t] })
    if (!holes) return plate
    const xs = []
    for (let x = -(w / 2 - inset); x <= w / 2 - inset + 1e-6; x += pitch) xs.push(x)
    const ys = []
    for (let y = -(h / 2 - inset); y <= h / 2 - inset + 1e-6; y += pitch) ys.push(y)
    let holeUnion = null
    for (const x of xs) {
      for (const y of ys) {
        const hole = transforms.translate([x, y, 0], p.cylinder({ radius: holeR, height: t + 2, segments }))
        holeUnion = holeUnion ? booleans.union(holeUnion, hole) : hole
      }
    }
    return booleans.subtract(plate, holeUnion)
  }

  it.each([32, 64])('pegboard passes its reference model at %i segments', (segments) => {
    expect(passes('pegboard', pegboardPanel(segments))).toBe(true)
  })

  it('pegboard fails a plate with no holes', () => {
    expect(passes('pegboard', pegboardPanel(32, { holes: false }))).toBe(false)
  })

  it('pegboard passes 5mm holes on a 1 inch pitch, which remove only about 3% of the plate', () => {
    const board = pegboardPanel(32, { w: 304.8, h: 203.2, pitch: 25.4, inset: 25.4, holeR: 2.5 })
    const { volume, dimensions } = measure([board], {})
    expect(volume / (dimensions[0] * dimensions[1] * dimensions[2])).toBeGreaterThan(0.97)
    expect(passes('pegboard', board)).toBe(true)
  })

  // Base plate, a back plate leaning off vertical hinged at the base's rear edge, and a front lip.
  function phoneStand(leanDeg) {
    const base = transforms.translateZ(2.5, p.cuboid({ size: [80, 70, 5] }))
    let back = transforms.translateZ(50, p.cuboid({ size: [80, 5, 100] }))
    back = transforms.rotateX((-leanDeg * Math.PI) / 180, back)
    back = transforms.translate([0, 35, 5], back)
    const lip = transforms.translate([0, -30, 10], p.cuboid({ size: [80, 10, 10] }))
    return booleans.union(base, back, lip)
  }

  it('phone-stand passes its reference model leaning 20 degrees', () => {
    expect(passes('phone-stand', phoneStand(20))).toBe(true)
  })

  it('phone-stand fails a solid block', () => {
    expect(passes('phone-stand', p.cuboid({ size: [80, 100, 100] }))).toBe(false)
  })

  // A clockwise 2D outline extrudes to an inside-out solid: negative volume.
  it.each([
    ['bracket', () => lBracket()],
    ['shelf-bracket', () => lBracket({ w: 50, arm: 40, t: 5 })],
    ['enclosure', () => enclosurePlaceholder(32)],
    ['pipe-tee', () => pipeTee(32)],
    ['pegboard', () => pegboardPanel(32)],
    ['phone-stand', () => phoneStand(20)],
    ['gear', () => p.cylinder({ radius: 20, height: 5 })],
  ])('%s fails its reference model turned inside out', (name, shape) => {
    const inverted = geometries.geom3.invert(shape())
    expect(measure([inverted], {}).volume).toBeLessThan(0)
    expect(check([inverted]).watertight).toBe(false)
    expect(check([inverted]).insideOut).toBe(true)
    expect(passes(name, inverted)).toBe(false)
  })
})
