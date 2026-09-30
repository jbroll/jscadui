// packages/agent-loop/test/tools.test.js
import { describe, expect, it } from 'vitest'
import { buildTools, TOOLS } from '../src/tools.js'

const docsDescription = (api) => buildTools(api).find((t) => t.name === 'docs').description

describe('agent tools', () => {
  it('exposes the nine browser tools with input schemas', async () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toEqual(['list', 'read', 'write', 'edit', 'run', 'measure', 'check', 'export', 'docs'])
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

  it('makes the check bed optional, for a printer the user names, and takes nothing else', () => {
    const check = TOOLS.find((t) => t.name === 'check')
    expect(Object.keys(check.inputSchema.properties)).toEqual(['bed'])
    expect(check.inputSchema.required ?? []).not.toContain('bed')
    expect(check.description).toMatch(/Pass a bed only when the user names a printer/)
  })

  it('says measure and check sizes are millimetres', () => {
    for (const name of ['measure', 'check']) expect(TOOLS.find((t) => t.name === name).description).toMatch(/\bmm\b/)
  })

  it('describes the measure selector forms the code accepts', () => {
    const { parts, between } = TOOLS.find((t) => t.name === 'measure').inputSchema.properties
    expect(parts.description).toMatch(/"all"/)
    expect(parts.description).toMatch(/JSON array string/)
    expect(between.description).toMatch(/"all" works only in parts/)
  })

  it('gives every argument a JSON type', () => {
    for (const tool of TOOLS) {
      for (const [name, schema] of Object.entries(tool.inputSchema.properties)) {
        expect(schema.type ?? schema.anyOf?.map((s) => s.type), `${tool.name}.${name}`).toBeDefined()
      }
    }
    const { parts, section } = TOOLS.find((t) => t.name === 'measure').inputSchema.properties
    expect(parts.anyOf).toEqual([{ type: 'string' }, { type: 'array', items: { type: 'string' } }])
    expect(section.type).toBe('string')
  })

  it('says export gives the size, not the file', () => {
    const exportTool = TOOLS.find((t) => t.name === 'export')
    expect(exportTool.description).toMatch(/gives its size, not the file/)
  })

  it('takes the file tools\' arguments in the common coding-agent shapes', () => {
    const schema = (name) => TOOLS.find((t) => t.name === name).inputSchema
    expect(Object.keys(schema('list').properties)).toEqual([])
    expect(Object.keys(schema('read').properties)).toEqual(['path', 'offset', 'limit'])
    expect(schema('read').required).toEqual(['path'])
    expect(schema('write').required).toEqual(['path', 'content'])
    expect(Object.keys(schema('edit').properties)).toEqual(['path', 'oldString', 'newString', 'replaceAll'])
    expect(schema('edit').required).toEqual(['path', 'oldString', 'newString'])
    expect(schema('run').required).toEqual(['source'])
  })

  it('says write and edit save and build, and run saves nothing', () => {
    const description = (name) => TOOLS.find((t) => t.name === name).description
    for (const name of ['write', 'edit']) expect(description(name)).toMatch(/builds the project and returns the build report/)
    expect(description('edit')).toMatch(/exactly once, unless replaceAll/)
    expect(description('run')).toMatch(/never saved/)
  })

  it('refuses an unknown API', () => {
    expect(() => buildTools('scad')).toThrow(/unknown api scad/)
  })
})
