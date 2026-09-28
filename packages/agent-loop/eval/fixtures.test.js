import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { measure } from '@jscadui/model-tools'
import { TOOLS } from '../src/tools.js'
import { geometryError } from './grade.js'
import { loadFixtures } from './run-eval.js'

const names = new Set(TOOLS.map((t) => t.name))
const files = readdirSync(new URL('./fixtures/', import.meta.url)).filter((f) => f.endsWith('.js')).sort()
const fixtures = await loadFixtures()
const byName = Object.fromEntries(fixtures.map((f) => [f.name, f]))
const { primitives, booleans, transforms } = createRequire(import.meta.url)('@jscad/modeling')

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
  }

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

  it('bracket target matches its 60x40x40 bounding box, not the 8mm plate thickness', () => {
    const { booleans, transforms, primitives: p } = createRequire(import.meta.url)('@jscad/modeling')
    const upright = p.cuboid({ size: [60, 40, 8] })
    const foot = transforms.translate([0, -16, 16], p.cuboid({ size: [60, 8, 40] }))
    const bracket = booleans.union(upright, foot)
    const m = measure([bracket], {})
    expect([...m.dimensions].sort((a, b) => a - b)).toEqual([40, 40, 60])
    expect(geometryError(byName['bracket'].target, m)).toBeLessThan(0.01)
  })

  it('gear-module passes a 44mm/5mm-thick, Z-centered placeholder', () => {
    const { primitives: p } = createRequire(import.meta.url)('@jscad/modeling')
    const shape = p.cylinder({ radius: 22, height: 5, segments: 20 })
    expect(byName['gear-module'].checks(measure([shape], {}), {}).every((c) => c.pass)).toBe(true)
  })

  it('gear-module fails a tip diameter that is off by more than 1mm', () => {
    const { primitives: p } = createRequire(import.meta.url)('@jscad/modeling')
    const shape = p.cylinder({ radius: 20, height: 5, segments: 20 })
    expect(byName['gear-module'].checks(measure([shape], {}), {}).every((c) => c.pass)).toBe(false)
  })

  it('gear-module fails a gear not centered in Z', () => {
    const { primitives: p, transforms } = createRequire(import.meta.url)('@jscad/modeling')
    const shape = transforms.translateZ(3, p.cylinder({ radius: 22, height: 5, segments: 20 }))
    expect(byName['gear-module'].checks(measure([shape], {}), {}).every((c) => c.pass)).toBe(false)
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
    expect(byName['fluent-chain'].checks(measure([cube], {}), { source }).every((c) => c.pass)).toBe(true)
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
    const results = byName['fluent-chain'].checks(measure([cube], {}), { source })
    expect(results.every((c) => c.pass)).toBe(false)
    expect(results.find((c) => c.name === 'no free combine').pass).toBe(false)
    expect(results.find((c) => c.name === '30mm extents').pass).toBe(true)
    expect(results.find((c) => c.name === 'volume near 21365').pass).toBe(true)
  })
})

describe('CSG fixture reference models', () => {
  const { primitives: p } = createRequire(import.meta.url)('@jscad/modeling')
  const passes = (name, solid) => byName[name].checks(measure([solid], {})).every((c) => c.pass)

  // 60x40x30 shell (2mm walls/floor, open top) with four cornered, drilled screw posts.
  function enclosure(segments, { holes = true, wall = 2 } = {}) {
    const outer = p.cuboid({ size: [60, 40, 30] })
    const cavity = transforms.translateZ(wall / 2, p.cuboid({ size: [60 - 2 * wall, 40 - 2 * wall, 30 - wall] }))
    const shell = booleans.subtract(outer, cavity)
    const postR = 3
    const postH = 8
    const floorTopZ = -15 + wall
    const positions = [[23, 13], [-23, 13], [23, -13], [-23, -13]]
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
    expect(passes('enclosure', enclosure(segments))).toBe(true)
  })

  it('enclosure fails a solid box (no cavity, no open top)', () => {
    expect(passes('enclosure', p.cuboid({ size: [60, 40, 30] }))).toBe(false)
  })

  // Two colinear 20mm-OD, 2mm-wall arms (the run) plus a perpendicular branch, each 30mm from center.
  function pipeTee(segments, { bored = true } = {}) {
    const outerR = 10
    const innerR = 8
    const armLen = 30
    const bore = (solid, height) => (bored ? booleans.subtract(solid, p.cylinder({ radius: innerR, height: height + 2, segments })) : solid)
    let run = bore(p.cylinder({ radius: outerR, height: armLen * 2, segments }), armLen * 2)
    run = transforms.rotateY(Math.PI / 2, run)
    let branch = bore(p.cylinder({ radius: outerR, height: armLen, segments }), armLen)
    branch = transforms.translateY(armLen / 2, transforms.rotateX(Math.PI / 2, branch))
    return booleans.union(run, branch)
  }

  it.each([32, 64])('pipe-tee passes its reference model at %i segments', (segments) => {
    expect(passes('pipe-tee', pipeTee(segments))).toBe(true)
  })

  it('pipe-tee fails an unbored (solid) tee', () => {
    expect(passes('pipe-tee', pipeTee(32, { bored: false }))).toBe(false)
  })

  // 100x60x4 plate with a grid of 5mm holes on 10mm centers, 5mm in from the edges.
  function pegboard(segments, { pitch = 10, inset = 5 } = {}) {
    const plate = p.cuboid({ size: [100, 60, 4] })
    const xs = []
    for (let x = -(50 - inset); x <= 50 - inset + 1e-6; x += pitch) xs.push(x)
    const ys = []
    for (let y = -(30 - inset); y <= 30 - inset + 1e-6; y += pitch) ys.push(y)
    let holes = null
    for (const x of xs) {
      for (const y of ys) {
        const hole = transforms.translate([x, y, 0], p.cylinder({ radius: 2.5, height: 6, segments }))
        holes = holes ? booleans.union(holes, hole) : hole
      }
    }
    return booleans.subtract(plate, holes)
  }

  it.each([32, 64])('pegboard passes its reference model at %i segments', (segments) => {
    expect(passes('pegboard', pegboard(segments))).toBe(true)
  })

  it('pegboard fails a wrong (20mm-pitch, 15-hole) grid', () => {
    expect(passes('pegboard', pegboard(32, { pitch: 20, inset: 10 }))).toBe(false)
  })

  // L bracket with two holes in the base, countersunk to 8mm at the top face.
  function countersunkBracket(segments, { thickness = 5 } = {}) {
    const w = 50, arm = 40, t = thickness
    const upright = p.cuboid({ size: [w, t, arm] })
    const foot = transforms.translate([0, -(arm - t) / 2, -(arm - t) / 2], p.cuboid({ size: [w, arm, t] }))
    const solid = booleans.union(upright, foot)
    const footTopZ = -(arm - t) / 2 + t / 2
    const holeR = 2
    const csR = 4
    const csDepth = 2
    let holes = null
    for (const x of [-w / 4, w / 4]) {
      const through = transforms.translate([x, 0, footTopZ - t / 2], p.cylinder({ radius: holeR, height: t + 2, segments }))
      const cone = transforms.translate(
        [x, 0, footTopZ - csDepth / 2],
        p.cylinderElliptic({ startRadius: [holeR, holeR], endRadius: [csR, csR], height: csDepth, segments }),
      )
      const hole = booleans.union(through, cone)
      holes = holes ? booleans.union(holes, hole) : hole
    }
    return booleans.subtract(solid, holes)
  }

  it.each([32, 64])('countersunk-bracket passes its reference model at %i segments', (segments) => {
    expect(passes('countersunk-bracket', countersunkBracket(segments))).toBe(true)
  })

  it('countersunk-bracket fails 8mm-thick walls (same bounding box, much more material)', () => {
    expect(passes('countersunk-bracket', countersunkBracket(32, { thickness: 8 }))).toBe(false)
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

  it('phone-stand fails a vertical (unleaned) back plate', () => {
    expect(passes('phone-stand', phoneStand(0))).toBe(false)
  })
})
