import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { docsTool, lookupDocs, MAX_ANSWER } from '../src/docs.js'
import { editDistance } from '../src/editDistance.js'
import { createEvalBackend } from '../eval/backend.js'

const index = JSON.parse(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8'))
const text = (query, api) => {
  const res = lookupDocs(index, query, api ? { api } : undefined)
  expect(res.ok).toBe(true)
  return res.text
}
const fluent = (query) => text(query, 'fluent')
const modeling = (query) => text(query, 'modeling')

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('roundedcube', 'roundedcuboid')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('same', 'same')).toBe(0)
  })
})

describe('docs lookup, shared behavior', () => {
  it('defaults to the fluent API', () => {
    expect(text('roundedCuboid')).toBe(fluent('roundedCuboid'))
  })

  it('refuses an unknown API', () => {
    expect(() => lookupDocs(index, 'cube', { api: 'scad' })).toThrow(/unknown api scad/)
  })

  it('refuses an empty query', () => {
    expect(lookupDocs(index, '  ').error.name).toBe('QueryError')
    expect(lookupDocs(index, undefined).error.name).toBe('QueryError')
  })

  it('caps an answer at 3,000 characters with a note', () => {
    const big = [{
      name: 'big', pkg: '@jbroll/jscad-fluent', kind: 'namespace', description: '',
      members: Array.from({ length: 500 }, (_, i) => ({ name: `member${i}`, summary: 'a member' })),
    }]
    const res = lookupDocs(big, 'big')
    expect(res.text.length).toBe(MAX_ANSWER)
    expect(res.text.endsWith('\n[truncated: query a qualified name for less]')).toBe(true)
  })

  it.each(['fluent', 'modeling'])('%s: answers @jscadui/jscad-text entries', (api) => {
    expect(text('@jscadui/jscad-text', api).startsWith('jscadText (@jscadui/jscad-text) namespace')).toBe(true)
    expect(text('text2d', api).startsWith('jscadText.text2d (@jscadui/jscad-text)')).toBe(true)
  })
})

describe('docs lookup, fluent API', () => {
  it('answers a bare name with the fluent entry and its options', () => {
    const answer = fluent('roundedCuboid')
    expect(answer.startsWith('jf.roundedCuboid (@jbroll/jscad-fluent)\nroundedCuboid(options: RoundedCuboidOptions) → FluentGeom3')).toBe(true)
    expect(answer).toContain('  roundRadius: Number = 0.2 - radius of rounded edges')
    expect(answer).not.toContain('@jscad/modeling')
    expect(answer).not.toContain('Same options as')
  })

  it('answers a fluent method with the options it shares', () => {
    const answer = fluent('FluentGeom2.extrudeLinear')
    expect(answer).toContain('  height: Number = 1')
    expect(answer).not.toMatch(/extrusions\.|Same options as/)
  })

  it('follows inherited class methods', () => {
    expect(fluent('FluentGeom3Array.translate').startsWith('FluentGeometryArray.translate (@jbroll/jscad-fluent)')).toBe(true)
    expect(fluent('FluentGeom3Array')).toContain('Inherited from FluentGeometryArray:')
  })

  it('prefers the jf factory, then the FluentGeom3 method, for a bare name', () => {
    expect(fluent('subtract')).toMatch(/^jf\.subtract \(@jbroll\/jscad-fluent\)[\s\S]*\nAlso: FluentGeom2\.subtract, FluentGeom3\.subtract, jf\.maths\.vec2\.subtract, /)
    expect(fluent('translate').startsWith('FluentGeom3.translate (@jbroll/jscad-fluent)')).toBe(true)
  })

  it('redirects a modeling name to its fluent form', () => {
    const answer = fluent('primitives.roundedCuboid')
    expect(answer.startsWith('primitives.roundedCuboid is not part of the fluent API; the fluent form is jf.roundedCuboid.\n\njf.roundedCuboid (@jbroll/jscad-fluent)')).toBe(true)
    expect(fluent('transforms.translate').startsWith('transforms.translate is not part of the fluent API; the fluent form is FluentGeom3.translate.')).toBe(true)
    expect(fluent('extrusions.extrudeLinear')).toMatch(/the fluent form is FluentGeom2\.extrudeLinear\./)
    expect(fluent('measureVolume')).toMatch(/^FluentGeom3\.measureVolume \(@jbroll\/jscad-fluent\)/)
    expect(fluent('minkowski.minkowskiSum')).toMatch(/the fluent form is FluentGeom3\.minkowski\./)
    expect(fluent('primitives')).toMatch(/^primitives is not part of the fluent API; the fluent form is jf\.\n\njf \(@jbroll\/jscad-fluent\) namespace/)
  })

  it.each([
    ['extrusions.extrudeHelical', 'FluentGeom2.extrudeHelical'],
    ['extrusions.extrudeRectangular', 'FluentGeom2.extrudeRectangular'],
    ['extrusions.extrudeFromSlices', 'jf.extrudeFromSlices'],
    ['extrusions.slice.fromPoints', 'jf.slice.fromPoints'],
    ['extrusions.project', 'FluentGeom3.project'],
    ['booleans.scission', 'FluentGeom3.scission'],
    ['modifiers.generalize', 'FluentGeom3.generalize'],
    ['modifiers.retessellate', 'FluentGeom3.retessellate'],
    ['curves.bezier.create', 'jf.curves.bezier.create'],
    ['hulls.hullPoints2', 'jf.hullPoints2'],
    ['hulls.hullPoints3', 'jf.hullPoints3'],
    ['measurements.measureAggregateVolume', 'jf.measureAggregateVolume'],
    ['measurements.measureCenterOfMass', 'FluentGeom3.measureCenterOfMass'],
    ['transforms.align', 'jf.align'],
    ['utils.degToRad', 'jf.utils.degToRad'],
    ['text.vectorText', 'jf.vectorText'],
    ['text.vectorChar', 'jf.vectorChar'],
  ])('answers %s, once a gap, with %s', (query, form) => {
    const answer = fluent(query)
    const head = answer.startsWith(`${form} `) ? '' : `${query} is not part of the fluent API; the fluent form is ${form}.\n\n`
    expect(answer.startsWith(`${head}${form} (@jbroll/jscad-fluent)\n`)).toBe(true)
    expect(answer).not.toContain('(@jscad/modeling)')
  })

  it('answers maths through jf.maths, in fluent names', () => {
    expect(fluent('maths.vec3.add').startsWith('jf.maths.vec3.add (@jbroll/jscad-fluent)\nadd(out, a, b) → vec3\n')).toBe(true)
    expect(fluent('jf.maths.vec3.add')).toBe(fluent('maths.vec3.add'))
    const listing = fluent('jf.maths.vec3')
    expect(listing.startsWith('jf.maths.vec3 (@jbroll/jscad-fluent) namespace')).toBe(true)
    expect(listing).toContain('\n  cross')
    expect(listing).not.toContain('@jscad/modeling')
    expect(fluent('jf.maths.constants')).toContain('  TAU')
    expect(fluent('maths').startsWith('jf.maths (@jbroll/jscad-fluent) namespace')).toBe(true)
  })

  it('keeps shape methods ahead of jf.maths helpers of the same name', () => {
    expect(fluent('scale').startsWith('FluentGeom3.scale (@jbroll/jscad-fluent)')).toBe(true)
    expect(fluent('rotateX').startsWith('FluentGeom3.rotateX (@jbroll/jscad-fluent)')).toBe(true)
    expect(modeling('scale').startsWith('transforms.scale (@jscad/modeling)')).toBe(true)
  })

  it('answers geometries with the fluent method or factory', () => {
    const cases = {
      'geometries.path2.appendArc': 'FluentPath2.appendArc',
      'geometries.path2.close': 'FluentPath2.close',
      'geometries.geom3.invert': 'FluentGeom3.invert',
      'geometries.geom2.reverse': 'FluentGeom2.invert',
      'geometries.geom2.toSides': 'FluentGeom2.toSides',
      'geometries.geom3.clone': 'FluentGeom3.clone',
      'geometries.path2.fromPoints': 'jf.path',
      'geometries.geom2.fromPoints': 'jf.polygon',
      'geometries.geom3.fromPoints': 'jf.polyhedron',
      'geometries.geom3.isA': 'jf.isGeom3',
      'geometries.geom2': 'FluentGeom2',
    }
    for (const [query, form] of Object.entries(cases)) {
      expect(fluent(query), query).toMatch(new RegExp(`^${query.replaceAll('.', '\\.')} is not part of the fluent API; the fluent form is ${form.replaceAll('.', '\\.')}\\.\n\n${form.replaceAll('.', '\\.')} \\(@jbroll/jscad-fluent\\)`))
    }
  })

  it('says what fluent still leaves out is not available', () => {
    expect(fluent('geometries.geom3.toCompactBinary')).toBe('geometries.geom3.toCompactBinary is not available in the fluent API.')
    expect(fluent('geometries.poly3.create')).toBe('geometries.poly3.create is not available in the fluent API.')
    expect(fluent('jf.maths.vec1')).toMatch(/^jf\.maths\.vec1 is not available in the fluent API: @jscad\/modeling has no vec1 functions/)
    expect(fluent('maths.vec1')).toMatch(/^maths\.vec1 is not available in the fluent API/)
  })

  it('answers jf.<method> with the method and how to call it', () => {
    const answer = fluent('jf.rotateX')
    expect(answer.startsWith('jf.rotateX is a method, not a jf function: call shape.rotateX(...).\n\nFluentGeom3.rotateX (@jbroll/jscad-fluent)')).toBe(true)
  })

  it('names the class that has a method the queried class lacks', () => {
    const answer = fluent('FluentGeom3.extrudeLinear')
    expect(answer.startsWith('FluentGeom3 has no extrudeLinear; it is a method of FluentGeom2, FluentGeom2Array.\n\nFluentGeom2.extrudeLinear (@jbroll/jscad-fluent)')).toBe(true)
  })

  it('lists the names a prefix starts', () => {
    expect(fluent('FluentGeom')).toMatch(/^FluentGeom matches several entries; query one of: FluentGeom2, FluentGeom3, FluentGeometryArray/)
  })

  it('looks up the first word of a query with several words', () => {
    expect(modeling('primitives.cylinderElliptic startRadius').startsWith('primitives.cylinderElliptic (@jscad/modeling)')).toBe(true)
  })

  it('answers jf.vectorText, and keeps jscadText.text2d for filled text', () => {
    expect(fluent('vectorText').startsWith('jf.vectorText (@jbroll/jscad-fluent)')).toBe(true)
    expect(fluent('text')).toMatch(/the fluent form is jscadText\./)
  })

  it('never shows the modeling entry for a redirect', () => {
    const answer = fluent('primitives.roundedCuboid')
    expect(answer).not.toContain('(@jscad/modeling)')
    expect(answer).not.toContain('let mycube = roundedCuboid(')
  })

  it('says a modeling-only function is not available', () => {
    expect(fluent('utils.insertSorted')).toBe('utils.insertSorted is not available in the fluent API.')
  })

  it('answers extrudeHelical with the fluent method, no modeling import', () => {
    const answer = fluent('extrudeHelical')
    expect(answer.startsWith('FluentGeom2.extrudeHelical (@jbroll/jscad-fluent)')).toBe(true)
    expect(answer).toContain('  pitch: ')
    expect(answer).not.toContain("require('@jscad/modeling')")
  })

  it('redirects the @jscad/modeling package to jf', () => {
    expect(fluent('@jscad/modeling')).toMatch(/^@jscad\/modeling is not part of the fluent API; the fluent form is jf\.\n\njf \(@jbroll\/jscad-fluent\) namespace/)
    expect(fluent('@jbroll/jscad-fluent').startsWith('jf (@jbroll/jscad-fluent) namespace')).toBe(true)
  })

  it('suggests the closest fluent names on a miss', () => {
    const res = lookupDocs(index, 'roundedCube', { api: 'fluent' })
    expect(res.ok).toBe(false)
    expect(res.error.name).toBe('NotFoundError')
    expect(res.error.message).toMatch(/^no entry roundedCube; closest: jf\.roundedCuboid, /)
    expect(res.error.message).not.toMatch(/primitives\./)
  })

  it('returns text for a hit and error JSON for a miss', () => {
    expect(docsTool(index, 'jf.polygon', { api: 'fluent' })).toContain('polygon(points: Point2[]) → FluentGeom2')
    expect(JSON.parse(docsTool(index, 'nope', { api: 'fluent' }))).toMatchObject({ ok: false, error: { name: 'NotFoundError' } })
  })

  it('documents a helical extrusion that evaluates with no warnings', async () => {
    const source = `const jf = require('@jbroll/jscad-fluent')
const main = () => jf.circle({ radius: 1, center: [5, 0] }).extrudeHelical({ angle: Math.PI * 4, pitch: 10 }).translateZ(2)
module.exports = { main }`
    const res = JSON.parse(await createEvalBackend().requestTool('eval', { source }))
    expect(res).toMatchObject({ ok: true })
    expect(res).not.toHaveProperty('warnings')
  })
})

describe('docs lookup, modeling API', () => {
  it('answers a bare name with the modeling entry alone', () => {
    const answer = modeling('roundedCuboid')
    expect(answer.startsWith('primitives.roundedCuboid (@jscad/modeling)\nroundedCuboid(options) → geom3')).toBe(true)
    expect(answer).toContain('  roundRadius: Number = 0.2 - radius of rounded edges')
    expect(answer).toContain('Example:\n  let mycube = roundedCuboid(')
    expect(answer).not.toMatch(/Also:|jf\./)
  })

  it('lists a namespace', () => {
    const answer = modeling('primitives')
    expect(answer.startsWith('primitives (@jscad/modeling) namespace')).toBe(true)
    expect(answer).toContain('Members:\n  arc - ')
    expect(answer).toContain('  roundedCuboid - Construct an axis-aligned solid cuboid')
  })

  it('lists the @jscad/modeling namespaces for a package-name query', () => {
    const answer = modeling('@jscad/modeling')
    expect(answer.startsWith('@jscad/modeling namespaces:')).toBe(true)
    expect(answer).toContain('  primitives - ')
    expect(answer).toContain('  booleans - ')
    expect(answer).toContain('  transforms - ')
    expect(answer.length).toBeLessThanOrEqual(MAX_ANSWER)
  })

  it('redirects a fluent name to its modeling form', () => {
    expect(modeling('jf.roundedCuboid').startsWith('jf.roundedCuboid is not part of the modeling API; the modeling form is primitives.roundedCuboid.\n\nprimitives.roundedCuboid (@jscad/modeling)')).toBe(true)
    expect(modeling('FluentGeom3.translate')).toMatch(/the modeling form is transforms\.translate\./)
    expect(modeling('FluentGeom2.extrudeLinear')).toMatch(/the modeling form is extrusions\.extrudeLinear\./)
    expect(modeling('jf')).toMatch(/^jf is not part of the modeling API; the modeling form is primitives\./)
    expect(modeling('@jbroll/jscad-fluent')).toMatch(/^@jbroll\/jscad-fluent is not part of the modeling API; the modeling form is @jscad\/modeling\.\n\n@jscad\/modeling namespaces:/)
  })

  it('never shows a fluent entry', () => {
    for (const query of ['jf.roundedCuboid', 'FluentGeom3.translate', 'attachTo', 'FluentGeom3']) {
      expect(modeling(query)).not.toContain('(@jbroll/jscad-fluent)')
    }
  })

  it('says a fluent-only function is not available', () => {
    expect(modeling('FluentGeom3.attachTo')).toBe('FluentGeom3.attachTo is not available in the modeling API.')
    expect(modeling('withAnchors')).toBe('withAnchors is not available in the modeling API.')
    expect(modeling('FluentGeom3')).toBe('FluentGeom3 is not available in the modeling API.')
  })

  it('answers maths and geometries', () => {
    expect(modeling('maths.vec3.add').startsWith('maths.vec3.add (@jscad/modeling)\nadd(out, a, b) → vec3')).toBe(true)
    expect(modeling('maths.constants')).toContain('  TAU - ')
    expect(modeling('geometries.geom2').startsWith('geometries.geom2 (@jscad/modeling) namespace')).toBe(true)
    expect(modeling('@jscad/modeling')).toContain('  maths - ')
  })

  it('redirects fluent forms that have a maths or geometries counterpart', () => {
    expect(modeling('jf.maths.vec3.add')).toMatch(/^jf\.maths\.vec3\.add is not part of the modeling API; the modeling form is maths\.vec3\.add\./)
    expect(modeling('jf.maths.vec3')).toMatch(/the modeling form is maths\.vec3\./)
    expect(modeling('FluentGeom3.invert')).toMatch(/the modeling form is geometries\.geom3\.invert\./)
    expect(modeling('FluentPath2.appendArc')).toMatch(/the modeling form is geometries\.path2\.appendArc\./)
    expect(modeling('jf.path')).toMatch(/the modeling form is geometries\.path2\.fromPoints\./)
  })

  it('lists the candidates when a bare name matches several entries', () => {
    expect(modeling('create')).toMatch(/^create matches several entries; query one of: extrusions\.slice\.create, curves\.bezier\.create, maths\.line2\.create, /)
  })

  it('suggests the closest modeling names on a miss', () => {
    const res = lookupDocs(index, 'roundedCube', { api: 'modeling' })
    expect(res.error.message).toMatch(/^no entry roundedCube; closest: primitives\.roundedCuboid, /)
    expect(res.error.message).not.toMatch(/jf\./)
  })
})
