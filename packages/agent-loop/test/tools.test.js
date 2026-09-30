// packages/agent-loop/test/tools.test.js
import { describe, expect, it } from 'vitest'
import { buildTools, TOOLS } from '../src/tools.js'

const docsDescription = (api) => buildTools(api).find((t) => t.name === 'docs').description

describe('agent tools', () => {
  it('exposes the seven browser tools with input schemas', async () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toEqual(['eval', 'params', 'measure', 'check', 'export', 'writeModel', 'docs'])
    for (const tool of TOOLS) {
      expect(typeof tool.description).toBe('string')
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('does not offer view to the model', () => {
    expect(TOOLS.map((t) => t.name)).not.toContain('view')
  })

  it('offers the same tools under either API', () => {
    expect(buildTools('modeling').map((t) => t.name)).toEqual(buildTools('fluent').map((t) => t.name))
    expect(TOOLS).toEqual(buildTools('fluent'))
  })

  it('names only fluent entries in the fluent docs description', () => {
    expect(docsDescription('fluent')).toMatch(/jf\.cuboid/)
    expect(docsDescription('fluent')).not.toMatch(/primitives|booleans|@jscad\/modeling/)
  })

  it('names only modeling entries in the modeling docs description', () => {
    expect(docsDescription('modeling')).toMatch(/primitives\.roundedCuboid/)
    expect(docsDescription('modeling')).not.toMatch(/fluent|\bjf\b/i)
  })

  it('says the docs query takes several names', () => {
    for (const api of ['fluent', 'modeling']) {
      const docs = buildTools(api).find((t) => t.name === 'docs')
      expect(docs.inputSchema.properties.query.description).toMatch(/several names, separated by commas/)
    }
  })

  it('makes the check bed optional, for a printer the user names', () => {
    const check = TOOLS.find((t) => t.name === 'check')
    expect(check.inputSchema.required ?? []).not.toContain('bed')
    expect(check.description).toMatch(/Pass a bed only when the user names a printer/)
  })

  it('says export gives the size, not the file', () => {
    const exportTool = TOOLS.find((t) => t.name === 'export')
    expect(exportTool.description).toMatch(/gives its size, not the file/)
  })

  it('refuses an unknown API', () => {
    expect(() => buildTools('scad')).toThrow(/unknown api scad/)
  })
})
