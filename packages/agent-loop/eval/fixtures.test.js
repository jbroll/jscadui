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
const { primitives } = createRequire(import.meta.url)('@jscad/modeling')

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
