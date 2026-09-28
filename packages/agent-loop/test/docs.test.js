import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { docsTool, lookupDocs, MAX_ANSWER } from '../src/docs.js'
import { editDistance } from '../src/editDistance.js'

const index = JSON.parse(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8'))
const text = (query) => {
  const res = lookupDocs(index, query)
  expect(res.ok).toBe(true)
  return res.text
}

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('roundedcube', 'roundedcuboid')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('same', 'same')).toBe(0)
  })
})

describe('docs lookup', () => {
  it('answers a bare name with the modeling entry and lists the others', () => {
    const answer = text('roundedCuboid')
    expect(answer.startsWith('primitives.roundedCuboid (@jscad/modeling)\nroundedCuboid(options) → geom3')).toBe(true)
    expect(answer).toContain('  roundRadius: Number = 0.2 - radius of rounded edges')
    expect(answer).toContain('Example:\n  let mycube = roundedCuboid(')
    expect(answer.endsWith('Also: jf.roundedCuboid')).toBe(true)
  })

  it('answers a qualified name alone', () => {
    expect(text('primitives.roundedCuboid')).not.toContain('Also:')
  })

  it('lists a namespace', () => {
    const answer = text('primitives')
    expect(answer.startsWith('primitives (@jscad/modeling) namespace')).toBe(true)
    expect(answer).toContain('Members:\n  arc - ')
    expect(answer).toContain('  roundedCuboid - Construct an axis-aligned solid cuboid')
  })

  it('gives a fluent factory the modeling options it shares', () => {
    const answer = text('jf.roundedCuboid')
    expect(answer).toContain('Same options as primitives.roundedCuboid.')
    expect(answer).toContain('  roundRadius: Number = 0.2')
  })

  it('answers a fluent method and follows inherited class methods', () => {
    expect(text('FluentGeom2.extrudeLinear')).toContain('Same options as extrusions.extrudeLinear.')
    expect(text('FluentGeom3Array.translate').startsWith('FluentGeometryArray.translate (@jbroll/jscad-fluent)')).toBe(true)
    expect(text('FluentGeom3Array')).toContain('Inherited from FluentGeometryArray:')
  })

  it('lists the candidates when no modeling entry settles a bare name', () => {
    expect(text('append')).toMatch(/^append matches several entries; query one of: FluentGeom2\.append, /)
  })

  it('suggests the closest names on a miss', () => {
    const res = lookupDocs(index, 'roundedCube')
    expect(res.ok).toBe(false)
    expect(res.error.name).toBe('NotFoundError')
    expect(res.error.message).toMatch(/^no entry roundedCube; closest: primitives\.roundedCuboid, /)
  })

  it('refuses an empty query', () => {
    expect(lookupDocs(index, '  ').error.name).toBe('QueryError')
    expect(lookupDocs(index, undefined).error.name).toBe('QueryError')
  })

  it('caps an answer at 3,000 characters with a note', () => {
    const big = [{
      name: 'big', pkg: 'x', kind: 'namespace', description: '',
      members: Array.from({ length: 500 }, (_, i) => ({ name: `member${i}`, summary: 'a member' })),
    }]
    const res = lookupDocs(big, 'big')
    expect(res.text.length).toBe(MAX_ANSWER)
    expect(res.text.endsWith('\n[truncated: query a qualified name for less]')).toBe(true)
  })

  it('returns text for a hit and error JSON for a miss', () => {
    expect(docsTool(index, 'jf.polygon')).toContain('polygon(points: Point2[]) → FluentGeom2')
    expect(JSON.parse(docsTool(index, 'nope'))).toMatchObject({ ok: false, error: { name: 'NotFoundError' } })
  })

  it('resolves a package name to its top entry', () => {
    expect(text('@jbroll/jscad-fluent').startsWith('jf (@jbroll/jscad-fluent) namespace')).toBe(true)
    expect(text('@jscadui/jscad-text').startsWith('jscadText (@jscadui/jscad-text) namespace')).toBe(true)
  })

  it('lists the @jscad/modeling namespaces for a package-name query', () => {
    const answer = text('@jscad/modeling')
    expect(answer.startsWith('@jscad/modeling namespaces:')).toBe(true)
    expect(answer).toContain('  primitives - ')
    expect(answer).toContain('  booleans - ')
    expect(answer).toContain('  transforms - ')
    expect(answer.length).toBeLessThanOrEqual(MAX_ANSWER)
  })
})
