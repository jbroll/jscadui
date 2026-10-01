import { describe, it, expect } from 'vitest'
import { buildCatalog } from '../bin/build.js'
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
