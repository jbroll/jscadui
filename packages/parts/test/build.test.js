import { describe, it, expect } from 'vitest'
import { buildAgentDocs, buildCatalog } from '../bin/build.js'
import { shimSource } from '../src/shims.js'

const rec = (over) => ({ id: 'a/nut', family: 'nut', library: 'A', license: 'MIT', file: 'A/nuts.scad', call: 'nut', summary: '', sizes: { values: ['M3'] }, example: '', checks: [], ...over })
const derived = { 'a/nut': { signature: { params: [] }, sizes: ['M3'], measured: [], transpileMs: 1, buildMs: { max: 1, mean: 1 } }, 'b/nut': { signature: { params: [] }, sizes: [], measured: [], transpileMs: 1, buildMs: { max: 1, mean: 1 } } }

describe('buildCatalog', () => {
  it('puts the preferred entry of a family first', () => {
    const { entries } = buildCatalog([rec(), rec({ id: 'b/nut', library: 'B', preferred: true })], derived)
    expect(entries.map((e) => e.id)).toEqual(['b/nut', 'a/nut'])
  })

  it('leaves out an entry with no derived data', () => {
    const { entries } = buildCatalog([rec({ id: 'c/nut' })], derived)
    expect(entries).toEqual([])
  })

  it('leaves out an entry whose checks failed', () => {
    const { entries } = buildCatalog([rec()], { 'a/nut': { ...derived['a/nut'], ok: false } })
    expect(entries).toEqual([])
  })

  it('refuses a family with two preferred entries', () => {
    const records = [rec({ preferred: true }), rec({ id: 'b/nut', library: 'B', preferred: true })]
    expect(() => buildCatalog(records, derived)).toThrow(/family nut: both a\/nut and b\/nut are preferred/)
  })

  it('points JS at the shim when the record has a prelude', () => {
    const { entries } = buildCatalog([rec({ prelude: ['A/std.scad'] })], derived)
    expect(entries[0].require).toBe('_catalog/A/nuts.scad')
    expect(entries[0].scadIncludes).toEqual(['A/std.scad', 'A/nuts.scad'])
  })
})

describe('shimSource', () => {
  it('includes the prelude then the file', () => {
    expect(shimSource(rec({ prelude: ['A/std.scad'] }))).toBe('include <A/std.scad>\ninclude <A/nuts.scad>\n')
  })
})

describe('buildAgentDocs', () => {
  const listRecord = {
    id: 'a/nut', family: 'nut', library: 'A', license: 'MIT', file: 'A/nut.scad', prelude: ['A/nuts.scad'],
    call: 'nut', summary: 'Hex nut.', sizes: { list: 'nuts' }, options: { nyloc: 'add the nylon insert' },
    example: 'nut(M3_nut, {nyloc: true})', checks: [], preferred: true,
  }
  const valuesRecord = {
    id: 'b/nut', family: 'nut', library: 'B', license: 'BSD-2-Clause', file: 'B/nut.scad', prelude: ['B/std.scad'],
    call: 'nut', summary: '', sizes: { values: ['M2', 'M3'] }, options: {}, example: 'nut("M3")', checks: [],
  }
  const agentDerived = {
    'a/nut': {
      signature: { params: [{ name: 'type' }, { name: 'nyloc', default: 'false' }] },
      sizes: ['M2_nut', 'M3_nut'],
      measured: [{ args: ['M3_nut'], size: [6.35, 5.5, 2.4] }],
      transpileMs: 1, buildMs: { max: 1, mean: 1 },
    },
    'b/nut': {
      signature: { params: [{ name: 'spec' }] },
      sizes: ['M2', 'M3'],
      measured: [{ args: ['M3'], size: [5.5, 6.35, 2.4] }],
      transpileMs: 1, buildMs: { max: 1, mean: 1 },
    },
  }

  it('is empty json and an empty prompt block with no entries', () => {
    expect(buildAgentDocs([])).toEqual({ json: [], md: '' })
  })

  it('names the require destructuring with the size name for a sizes.list entry', () => {
    const { entries } = buildCatalog([listRecord], agentDerived)
    const { json } = buildAgentDocs(entries)
    expect(json[0]).toMatchObject({
      name: 'parts.a.nut', pkg: '@jscadui/parts', kind: 'part', family: 'nut', preferred: true,
      description: 'Hex nut.', require: "const { nut, M3_nut } = require('_catalog/A/nut.scad')",
      scad: 'include <A/nuts.scad>\ninclude <A/nut.scad>', signature: 'nut(type, nyloc = false)',
      sizes: ['M2_nut', 'M3_nut'], license: 'MIT',
    })
  })

  it('leaves the size name out for a sizes.values entry and quotes its sizes', () => {
    const { entries } = buildCatalog([valuesRecord], agentDerived)
    const { json } = buildAgentDocs(entries)
    expect(json[0]).toMatchObject({
      require: "const { nut } = require('_catalog/B/nut.scad')",
      sizes: ['"M2"', '"M3"'],
    })
    expect(json[0].preferred).toBeUndefined()
  })

  it('names the require destructuring with the size name for a sizes.names entry and leaves its sizes unquoted', () => {
    const namesRecord = { ...listRecord, id: 'c/screw', family: 'screw', call: 'screw', file: 'C/screw.scad', prelude: ['C/core.scad'], sizes: { names: ['M3_cap_screw'] }, insertArgs: [10], example: 'screw(M3_cap_screw, 10)' }
    const namesDerived = { 'c/screw': { ...agentDerived['a/nut'], sizes: ['M3_cap_screw'], measured: [{ args: ['M3_cap_screw', 10], size: [5.5, 5.5, 13] }] } }
    const { json } = buildAgentDocs(buildCatalog([namesRecord], namesDerived).entries)
    expect(json[0]).toMatchObject({
      require: "const { screw, M3_cap_screw } = require('_catalog/C/screw.scad')",
      sizes: ['M3_cap_screw'],
      example: 'screw(M3_cap_screw, 10)',
    })
  })

  it('lists one line per family from its preferred entry, then the three rules', () => {
    const { entries } = buildCatalog([listRecord, valuesRecord], agentDerived)
    const { md } = buildAgentDocs(entries)
    expect(md).toContain('## Parts')
    expect(md).toContain("- nut: `const { nut, M3_nut } = require('_catalog/A/nut.scad')` — nut(M3_nut, {nyloc: true})")
    expect(md).not.toContain('B/nut.scad')
    expect(md).toContain('Rules:\n- Use a catalog part for standard hardware instead of modeling it.\n- Prefer a permissive license when two parts are equivalent.\n- Never copy library files into the project.\n')
  })

  it('still prints the heading and rules when no family has a preferred entry', () => {
    const { entries } = buildCatalog([valuesRecord], agentDerived)
    const { md } = buildAgentDocs(entries)
    expect(md).toContain('## Parts')
    expect(md).toContain('Rules:')
    expect(md).not.toMatch(/^- nut:/m)
  })
})
