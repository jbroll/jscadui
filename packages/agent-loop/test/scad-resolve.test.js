import { describe, it, expect } from 'vitest'
import { includeCandidates, isSpaFallback } from '../src/scadResolve.js'
import { PROJECT_BASE } from '../src/projectUrl.js'

const ENTRY = 'http://localhost:5121/examples/openscad/nopscadlib/NopSCADlib/tests/sheets.scad'

describe('includeCandidates', () => {
  it('resolves relative to the entry url when there is no fromFile', () => {
    expect(includeCandidates('../vitamins/sheets.scad', undefined, ENTRY)[0]).toBe(
      'http://localhost:5121/examples/openscad/nopscadlib/NopSCADlib/vitamins/sheets.scad',
    )
  })

  it('resolves a bare fromFile path against the entry origin', () => {
    const fromFile = '/examples/openscad/nopscadlib/NopSCADlib/vitamins/sheets.scad'
    expect(includeCandidates('../utils/core/core.scad', fromFile, ENTRY)[0]).toBe(
      'http://localhost:5121/examples/openscad/nopscadlib/NopSCADlib/utils/core/core.scad',
    )
  })

  it('falls back to the library root for a library-qualified include', () => {
    const fromFile = '/examples/openscad/bosl2/01-part1/cube.scad'
    expect(includeCandidates('BOSL2/std.scad', fromFile, ENTRY)).toEqual([
      'http://localhost:5121/examples/openscad/bosl2/01-part1/BOSL2/std.scad',
      'http://localhost:5121/examples/openscad/bosl2/BOSL2/std.scad',
    ])
  })

  it('drops a library-root candidate that walks out of its library', () => {
    const fromFile = '/examples/openscad/bosl2/01-part1/cube.scad'
    expect(includeCandidates('../../../secret.scad', fromFile, ENTRY)).toEqual([
      'http://localhost:5121/examples/secret.scad',
    ])
  })

  it('resolves project files against the synthetic project origin', () => {
    expect(includeCandidates('lib/a.scad', '/main.scad', `${PROJECT_BASE}main.scad`)[0]).toBe(
      'http://project.local/lib/a.scad',
    )
  })

  it('resolves a bare pathname entry url against the fallback origin', () => {
    const entry = '/examples/openscad/nopscadlib/NopSCADlib/tests/sheets.scad'
    const fromFile = '/examples/openscad/nopscadlib/NopSCADlib/vitamins/sheets.scad'
    expect(includeCandidates('../utils/core/core.scad', fromFile, entry, 'http://localhost:5120')[0]).toBe(
      'http://localhost:5120/examples/openscad/nopscadlib/NopSCADlib/utils/core/core.scad',
    )
  })

  it('resolves a blob entry url against the fallback origin', () => {
    const entry = 'blob:null/8f3c1b5e-0000-4000-8000-000000000000'
    const fromFile = '/examples/openscad/bosl2/01-part1/cube.scad'
    expect(includeCandidates('BOSL2/std.scad', fromFile, entry, 'http://localhost:5120')).toEqual([
      'http://localhost:5120/examples/openscad/bosl2/01-part1/BOSL2/std.scad',
      'http://localhost:5120/examples/openscad/bosl2/BOSL2/std.scad',
      'http://localhost:5120/libs/BOSL2/std.scad',
    ])
  })

  it('prefers the entry url origin over the fallback', () => {
    expect(includeCandidates('b.scad', undefined, 'https://example.com/a/a.scad', 'http://localhost:5120')[0]).toBe(
      'https://example.com/a/b.scad',
    )
  })

  it('gives up when neither the entry url nor a fallback carries an origin', () => {
    expect(includeCandidates('a.scad', '/b.scad', 'b.scad')).toEqual([])
  })

  it('falls back to the app libs tree for a library include from a project file', () => {
    expect(includeCandidates('NopSCADlib/vitamins/nuts.scad', 'http://project.local/main.scad', 'http://project.local/main.scad', 'http://localhost:5121')).toEqual([
      'http://project.local/NopSCADlib/vitamins/nuts.scad',
      'http://localhost:5121/libs/NopSCADlib/vitamins/nuts.scad',
    ])
  })

  it('falls back to the app libs tree after the suite fallback for an app file', () => {
    const fromFile = '/examples/openscad/bosl2/01-part1/cube.scad'
    expect(includeCandidates('BOSL2/std.scad', fromFile, ENTRY, 'http://localhost:5121').at(-1)).toBe('http://localhost:5121/libs/BOSL2/std.scad')
  })

  it('never offers a libs candidate that escapes the libs root', () => {
    const c = includeCandidates('../../secret.scad', 'http://project.local/main.scad', 'http://project.local/main.scad', 'http://localhost:5121')
    expect(c.some((u) => u.includes('/libs/'))).toBe(false)
    expect(c.some((u) => u === 'http://localhost:5121/secret.scad')).toBe(false)
  })

  it('keeps a file inside a library resolving relative to itself first', () => {
    const from = 'http://localhost:5121/libs/NopSCADlib/vitamins/nuts.scad'
    expect(includeCandidates('nut.scad', from, 'http://project.local/main.scad', 'http://localhost:5121')[0]).toBe('http://localhost:5121/libs/NopSCADlib/vitamins/nut.scad')
  })
})

describe('isSpaFallback', () => {
  it('detects an html document served for a missing file', () => {
    expect(isSpaFallback('<!DOCTYPE html>\n<html>')).toBe(true)
    expect(isSpaFallback('cube(1);')).toBe(false)
  })
})
