import { describe, expect, it } from 'vitest'
import { loadScenarios } from './scenarios/index.js'

const API = /jscad|fluent|@jscad|modeling|cuboid|require\(/i
const scenarios = await loadScenarios()

describe('starting scenario set', () => {
  it('loads twelve scenarios with unique names, sorted', () => {
    const names = scenarios.map((s) => s.name)
    expect(names).toHaveLength(12)
    expect(new Set(names).size).toBe(12)
    expect(names).toEqual([...names].sort())
  })

  it('every scenario has a prompt, persona, category and at least one fact', () => {
    for (const s of scenarios) {
      expect(s.prompt, s.name).toMatch(/\S/)
      expect(s.persona, s.name).toMatch(/\S/)
      expect(s.category, s.name).toMatch(/\S/)
      expect(s.facts.length, s.name).toBeGreaterThan(0)
    }
  })

  it('no prompt or fact names an API', () => {
    for (const s of scenarios) {
      for (const text of [s.prompt, s.persona, ...s.facts]) expect(text, s.name).not.toMatch(API)
    }
  })

  it('checks run on an empty measure without throwing', () => {
    for (const s of scenarios) {
      for (const args of [[{}, {}], [undefined, undefined], [{ dimensions: ['x'] }, { watertight: 'no' }]]) {
        const results = s.checks(...args)
        expect(results.length, s.name).toBeGreaterThan(0)
        for (const r of results) {
          expect(typeof r.name, s.name).toBe('string')
          expect(typeof r.pass, `${s.name}: ${r.name}`).toBe('boolean')
        }
      }
    }
  })

  it('checks accept a plausible model for the scenarios that size one', () => {
    const jeep = scenarios.find((s) => s.name === 'jeep-1-10')
    const m = { dimensions: [340, 160, 150], volume: 1.2e6 }
    expect(jeep.checks(m, { watertight: true }).every((r) => r.pass)).toBe(true)
  })

  it('jeep-1-10 states the scale in millimetres', () => {
    const jeep = scenarios.find((s) => s.name === 'jeep-1-10')
    expect(jeep.prompt).toBe('create a 1:10 scale model of a WW2 Willys Jeep')
    expect(jeep.facts.join(' ')).toMatch(/340 mm/)
    expect(jeep.facts).toContain('display piece, not printed as one part')
  })

  it('jeep-inspect-fix carries the Jeep source', () => {
    const s = scenarios.find((x) => x.name === 'jeep-inspect-fix')
    const js = Object.entries(s.files ?? {}).filter(([name]) => name.endsWith('.js'))
    expect(js.length).toBeGreaterThan(0)
    expect(js[0][1].length).toBeGreaterThan(1000)
  })
})
