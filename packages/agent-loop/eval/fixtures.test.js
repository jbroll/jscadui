import { describe, expect, it } from 'vitest'
import { TOOLS } from '../src/tools.js'
import { fixture as bracket } from './fixtures/bracket.js'
import { fixture as cubeHole } from './fixtures/cube-hole.js'
import { fixture as gear } from './fixtures/gear.js'

const names = new Set(TOOLS.map((t) => t.name))

describe('eval fixtures', () => {
  for (const fixture of [cubeHole, gear, bracket]) {
    it(`${fixture.name}: declares known tools, a prompt, and function checks`, () => {
      expect(fixture.prompt.trim().length).toBeGreaterThan(20)
      expect(fixture.requires.length).toBeGreaterThan(0)
      for (const tool of fixture.requires) expect(names.has(tool)).toBe(true)
      expect(fixture.requires).not.toContain('view')
      expect(fixture.requires).not.toContain('export')
      expect(typeof fixture.checks).toBe('function')
      expect(typeof fixture.maxTurns).toBe('number')
    })
  }
})
