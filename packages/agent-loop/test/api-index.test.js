import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildIndex, formatIndex, formatOptionTable, optionTables } from '../api/build-index.js'
import { declarationOf, parseParam } from '../api/jsdoc.js'
import { OPTION_TABLES } from '../api/optionTable.js'

const entries = buildIndex()
const entry = (name) => entries.find((e) => e.name === name)

describe('JSDoc parsing', () => {
  it('reads an optional option with a default', () => {
    expect(parseParam('{Number} [options.roundRadius=0.2] - radius of rounded edges')).toEqual({
      type: 'Number', name: 'options.roundRadius', default: '0.2', description: 'radius of rounded edges',
    })
  })

  it('keeps brackets inside a default and trims spaces around =', () => {
    expect(parseParam('{Array} [options.center=[0,0,0]] - center').default).toBe('[0,0,0]')
    expect(parseParam("{Array} [options.modes = ['center', 'min']] - modes").default).toBe("['center', 'min']")
  })

  it('reads a description without a dash and a rest parameter', () => {
    expect(parseParam('{Boolean} [options.snap=false] the geometries should be snapped').description).toBe('the geometries should be snapped')
    expect(parseParam('{...Object} objects - the objects to translate')).toEqual({
      type: '...Object', name: 'objects', default: null, description: 'the objects to translate',
    })
  })

  it('finds the block right above a declaration', () => {
    const source = 'const x = 1\n/** other */\nconst y = 2\n\n/**\n * Make a thing.\n * @param {Object} options - opts\n */\nconst make = (options) => options\n'
    const decl = declarationOf(source, 'make')
    expect(decl.kind).toBe('function')
    expect(decl.doc.description).toBe('Make a thing.')
    expect(declarationOf(source, 'x')).toEqual({ kind: 'value', doc: null })
  })
})

describe('API index', () => {
  it('documents roundedCuboid with its options and defaults', () => {
    const e = entry('primitives.roundedCuboid')
    expect(e).toMatchObject({ pkg: '@jscad/modeling', kind: 'function', signature: 'roundedCuboid(options) → geom3', optionsFirst: true })
    expect(e.options.find((o) => o.name === 'roundRadius')).toEqual({
      name: 'roundRadius', type: 'Number', default: '0.2', description: 'radius of rounded edges',
    })
    expect(e.example).toContain('roundRadius: 2')
  })

  it('lists a namespace with one-line member summaries', () => {
    const ns = entry('primitives')
    expect(ns.kind).toBe('namespace')
    expect(ns.members).toContainEqual({
      name: 'roundedCuboid', summary: 'Construct an axis-aligned solid cuboid in three dimensional space with rounded corners.',
    })
  })

  it('signs positional and rest parameters', () => {
    expect(entry('transforms.translate').signature).toBe('translate(offset, ...objects) → Object|Array')
  })

  it('leaves out maths and geometries', () => {
    expect(entries.some((e) => /^(maths|geometries)(\.|$)/.test(e.name))).toBe(false)
  })

  it('adds the options JSDoc omits', () => {
    expect(entry('extrusions.extrudeLinear').options.map((o) => o.name)).toContain('repair')
    expect(entry('extrusions.extrudeRectangular').options.map((o) => o.name)).toEqual(
      expect.arrayContaining(['size', 'height', 'corners', 'segments', 'twistAngle']),
    )
  })

  it('adds font, which the JSDoc omits, to the vector text options', () => {
    expect(entry('text.vectorText').options.map((o) => o.name)).toContain('font')
    expect(entry('text.vectorChar').options.map((o) => o.name)).toContain('font')
  })

  it('documents jscad-text', () => {
    expect(entry('jscadText.text2d').options.map((o) => o.name)).toContain('halign')
    expect(entry('jscadText').kind).toBe('namespace')
  })

  it('tables the option names of optionsFirst functions', () => {
    const modeling = OPTION_TABLES['@jscad/modeling']
    expect(modeling.prefix).toBe('')
    expect(modeling.options['primitives.roundedCuboid']).toEqual(['center', 'roundRadius', 'segments', 'size'])
    expect(Object.keys(modeling.options)).not.toContain('transforms.translate')
  })

  it('matches a fresh generation', () => {
    expect(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8')).toBe(formatIndex(entries))
    expect(readFileSync(new URL('../api/optionTable.js', import.meta.url), 'utf8')).toBe(formatOptionTable(optionTables(entries)))
  })
})

describe('fluent entries', () => {
  it('points a factory with modeling options at the modeling entry', () => {
    expect(entry('jf.roundedCuboid')).toMatchObject({ pkg: '@jbroll/jscad-fluent', sameAs: 'primitives.roundedCuboid', optionsFirst: true })
    expect(entry('jf.roundedCuboid').options).toBeUndefined()
    expect(entry('jf.arc').sameAs).toBe('primitives.arc')
  })

  it('keeps polygon as a points array, not options', () => {
    expect(entry('jf.polygon').signature).toBe('polygon(points: Point2[]) → FluentGeom2')
    expect(entry('jf.polygon').optionsFirst).toBeUndefined()
  })

  it('lists the options of fluent-only factories', () => {
    expect(entry('jf.cylinder').options.map((o) => o.name)).toEqual(['height', 'segments', 'center', 'angle', 'radius', 'outer', 'inner', 'wall'])
    expect(entry('jf.polyhedron').options.map((o) => o.name)).toEqual(['points', 'faces'])
  })

  it('documents class methods and maps option types to modeling', () => {
    expect(entry('FluentGeom2.extrudeLinear')).toMatchObject({
      sameAs: 'extrusions.extrudeLinear', signature: 'extrudeLinear(options: ExtrudeLinearOptions) → FluentGeom3',
    })
    expect(entry('FluentGeom3').members.map((m) => m.name)).toContain('translate')
    expect(entry('FluentGeom3Array')).toMatchObject({ kind: 'class', extends: 'FluentGeometryArray' })
  })

  it('marks the methods that take an options object', () => {
    expect(entry('FluentGeom3.center')).toMatchObject({ sameAs: 'transforms.center', optionsFirst: true })
    expect(entry('FluentGeometryArray.mirror')).toMatchObject({ sameAs: 'transforms.mirror', optionsFirst: true })
    expect(entry('FluentGeom2Array.extrudeRotate')).toMatchObject({ sameAs: 'extrusions.extrudeRotate', optionsFirst: true })
    expect(entry('FluentGeom2.translate').optionsFirst).toBeUndefined()
    expect(entry('FluentGeom2.union').optionsFirst).toBeUndefined()
  })

  it('tables the options of fluent methods by class', () => {
    const { methods } = OPTION_TABLES['@jbroll/jscad-fluent']
    expect(Object.keys(methods).sort()).toEqual(['FluentGeom2', 'FluentGeom2Array', 'FluentGeom3', 'FluentGeometryArray', 'FluentPath2'])
    expect(Object.keys(methods.FluentGeom2).sort()).toEqual(['center', 'expand', 'extrudeLinear', 'extrudeRotate', 'mirror', 'offset'])
    expect(Object.keys(methods.FluentGeom3).sort()).toEqual(['center', 'expand', 'mirror'])
    expect(Object.keys(methods.FluentPath2).sort()).toEqual(['center', 'expand', 'mirror', 'offset'])
    expect(methods.FluentGeometryArray).toEqual({ mirror: ['normal', 'origin'], center: ['axes', 'relativeTo'] })
    expect(Object.keys(methods.FluentGeom2Array).sort()).toEqual(['extrudeLinear', 'extrudeRotate'])
    expect(methods.FluentGeom2.extrudeLinear).toEqual(['height', 'repair', 'twistAngle', 'twistSteps'])
    expect(OPTION_TABLES['@jscad/modeling'].methods).toEqual({})
  })

  it('reads nested namespace JSDoc without comment markers', () => {
    expect(entry('jf.colors.hexToRgb').description).toBe('Convert hex color notation to RGB or RGBA.')
  })

  it('tables fluent factory options under names without jf.', () => {
    const fluent = OPTION_TABLES['@jbroll/jscad-fluent']
    expect(fluent.prefix).toBe('jf.')
    expect(fluent.options.roundedCuboid).toEqual(['center', 'roundRadius', 'segments', 'size'])
    expect(fluent.options.cylinder).toEqual(['angle', 'center', 'height', 'inner', 'outer', 'radius', 'segments', 'wall'])
    expect(Object.keys(fluent.options)).not.toContain('polygon')
  })

  it('stays under 150 KB', () => {
    expect(formatIndex(entries).length).toBeLessThan(150_000)
  })
})
