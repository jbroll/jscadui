import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildIndex } from '../api/build-index.js'
import { buildSheet, estimateTokens, SHEET_NAMES } from '../api/sheet.js'
import { APIS } from '../src/api.js'
import { buildSystemPrompt } from '../src/prompt.js'

const entries = buildIndex()
const committed = (api) => readFileSync(new URL(`../prompt/sheet-${api}.md`, import.meta.url), 'utf8')
const line = (sheet, start) => sheet.split('\n').find((l) => l.startsWith(start))

describe('API reference sheet', () => {
  it.each(APIS)('%s: matches a fresh generation', (api) => {
    expect(committed(api)).toBe(buildSheet(entries, api))
  })

  it.each(APIS)('%s: fits the 5,000 token budget', (api) => {
    expect(estimateTokens(committed(api))).toBeLessThanOrEqual(5000)
  })

  it('counts each word and punctuation mark as a token', () => {
    expect(estimateTokens('jf.cube({ size = 2 })')).toBe(10)
  })

  it.each(APIS)('%s: names only functions the index has', (api) => {
    const names = new Set(entries.map((e) => e.name))
    for (const name of SHEET_NAMES[api]) expect(names.has(name), name).toBe(true)
  })

  it('fluent: never gives jf.cylinder outer the default radius, which a lone outer does not set', () => {
    expect(line(committed('fluent'), 'jf.cylinder(')).toContain('radius = 1, outer, inner, wall')
    const outer = entries.find((e) => e.name === 'jf.cylinder').options.find((o) => o.name === 'outer')
    expect(outer.description).toMatch(/only with inner or wall/)
  })

  it('fluent: gives jf factories and methods with option defaults', () => {
    const sheet = committed('fluent')
    expect(line(sheet, 'jf.cube(')).toBe('jf.cube({ center = [0,0,0], size = 2 })')
    expect(line(sheet, 'jf.cuboid(')).toBe('jf.cuboid({ center = [0,0,0], size = [2,2,2] })')
    expect(line(sheet, '.translate(')).toBe('.translate(offset: Vec3)')
    expect(line(sheet, '.subtract(')).toBe('.subtract(...others)')
    expect(line(sheet, '.extrudeLinear(')).toMatch(/^\.extrudeLinear\(\{ height = 1, twistAngle = 0, twistSteps = 1, repair = true \}\) \/\/ radians$/)
  })

  it('fluent: names no modeling form', () => {
    expect(committed('fluent')).not.toMatch(/@jscad\/modeling|\b(primitives|booleans|transforms|extrusions|expansions|hulls|colors|measurements)\./)
  })

  it('modeling: gives namespace.function forms with option defaults', () => {
    const sheet = committed('modeling')
    expect(line(sheet, 'primitives.cube(')).toBe('primitives.cube({ center = [0,0,0], size = 2 })')
    expect(line(sheet, 'transforms.translate(')).toBe('transforms.translate(offset: Array, ...objects)')
    expect(line(sheet, 'booleans.subtract(')).toBe('booleans.subtract(...geometries)')
    expect(line(sheet, 'extrusions.extrudeLinear(')).toMatch(/^extrusions\.extrudeLinear\(\{ height = 1, twistAngle = 0, twistSteps = 1, repair = true \}, \.\.\.objects\) \/\/ radians$/)
  })

  it('modeling: never mentions jscad-fluent', () => {
    expect(committed('modeling')).not.toMatch(/fluent|\bjf\b/i)
  })

  it.each([
    ['fluent', '.rotateX('],
    ['fluent', 'jf.circle('],
    ['fluent', 'jf.cylinder('],
    ['modeling', 'transforms.rotateX('],
    ['modeling', 'primitives.circle('],
    ['modeling', 'extrusions.extrudeRotate('],
  ])('%s: marks %s as taking radians', (api, start) => {
    expect(line(committed(api), start)).toMatch(/\/\/ radians$/)
  })

  it.each([
    ['fluent', '.translate('],
    ['fluent', 'jf.cube('],
    ['modeling', 'primitives.cuboid('],
  ])('%s: leaves the radians mark off %s', (api, start) => {
    expect(line(committed(api), start)).not.toMatch(/radians/)
  })

  it.each(APIS)('%s: the prompt carries the sheet after the style section and before the examples', (api) => {
    const prompt = buildSystemPrompt(api)
    const style = prompt.indexOf(api === 'fluent' ? '## jscad-fluent style' : '## @jscad/modeling style')
    const sheet = prompt.indexOf('## API reference')
    expect(style).toBeGreaterThan(0)
    expect(sheet).toBeGreaterThan(style)
    expect(prompt.indexOf('## Examples')).toBeGreaterThan(sheet)
    expect(prompt).toContain(committed(api).trim())
    expect(prompt.match(/`docs` gives full details for anything not listed/g)).toHaveLength(1)
  })
})
