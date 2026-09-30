import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildIndex, formatIndex, formatOptionTable, optionTables } from '../api/build-index.js'
import { declarationOf, firstSentence, parseParam } from '../api/jsdoc.js'
import { OPTION_TABLES } from '../api/optionTable.js'
import { fontList, STATIC_FONT_MAP } from '@jscadui/jscad-text'

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

  it('does not end a first sentence at e.g. or i.e.', () => {
    expect(firstSentence('Shapes can be measured, e.g. volume, i.e. size. More text.')).toBe('Shapes can be measured, e.g. volume, i.e. size.')
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

  it('indexes maths and geometries', () => {
    expect(entry('maths.vec3.add')).toMatchObject({ kind: 'function', signature: 'add(out, a, b) → vec3' })
    expect(entry('geometries.path2.appendArc')).toMatchObject({ optionsFirst: true })
    expect(entry('geometries.geom2').members.map((m) => m.name)).toContain('toSides')
  })

  it('lists the maths constants as values', () => {
    expect(entry('maths.constants')).toMatchObject({ kind: 'namespace' })
    expect(entry('maths.constants').members.map((m) => m.name).sort()).toEqual(['EPS', 'NEPS', 'TAU', 'spatialResolution'])
    expect(entry('maths.constants.TAU')).toMatchObject({ kind: 'value', signature: 'TAU' })
    expect(entry('maths.constants.TAU').description).toMatch(/circumference of a circle to its radius/)
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

  it('lists every font name of the static font map under text2d font', () => {
    const font = entry('jscadText.text2d').options.find((o) => o.name === 'font').description
    expect(font).toContain(`Font names: ${fontList(Object.keys(STATIC_FONT_MAP))}`)
    expect(font).toContain('Liberation Sans (Bold, Italic, Bold Italic)')
    expect(font).toContain('"Liberation Sans:style=Bold"')
  })

  it('tables the option names of optionsFirst functions', () => {
    const modeling = OPTION_TABLES['@jscad/modeling']
    expect(modeling.prefix).toBe('')
    expect(modeling.options['primitives.roundedCuboid']).toEqual(['center', 'roundRadius', 'segments', 'size'])
    expect(Object.keys(modeling.options)).not.toContain('transforms.translate')
  })

  it('tables number and array option types, the only ones checked', () => {
    const modeling = OPTION_TABLES['@jscad/modeling']
    expect(modeling.types['primitives.cube']).toEqual({ center: 'array', size: 'number' })
    expect(modeling.types['primitives.cylinder'].radius).toBe('number')
    expect(modeling.types['text.vectorText'].height).toBe('number')
    expect(modeling.types['text.vectorText']).not.toHaveProperty('input')
    const fluent = OPTION_TABLES['@jbroll/jscad-fluent']
    expect(fluent.types.cuboid).toEqual({ center: 'array', size: 'array' })
    expect(fluent.types.cylinder).toEqual({ angle: 'array', center: 'array', height: 'number', segments: 'number' })
    expect(fluent.methodTypes.FluentGeom2.extrudeLinear).toEqual({ height: 'number', twistAngle: 'number', twistSteps: 'number' })
  })

  it('tables the functions and methods whose first parameter is an angle', () => {
    expect(OPTION_TABLES['@jscad/modeling'].angles).toEqual(['transforms.rotate', 'transforms.rotateX', 'transforms.rotateY', 'transforms.rotateZ'])
    const fluent = OPTION_TABLES['@jbroll/jscad-fluent']
    expect(fluent.methodAngles.FluentGeom3).toEqual(['rotate', 'rotateX', 'rotateY', 'rotateZ'])
    expect(Object.keys(fluent.methodAngles).sort()).toEqual(['FluentGeom2', 'FluentGeom3', 'FluentGeometryArray', 'FluentPath2'])
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

  it('takes jf.cylinder option defaults from its JSDoc', () => {
    const defaults = Object.fromEntries(entry('jf.cylinder').options.map((o) => [o.name, o.default]))
    expect(defaults).toMatchObject({ height: '1', segments: '32', center: '[0,0,0]', angle: '[0,TAU]', radius: '1', outer: 'radius', inner: null, wall: null })
    expect(entry('jf.cylinder').options.find((o) => o.name === 'radius').description).toMatch(/start at the -Z end/)
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
    expect(Object.keys(methods).sort()).toEqual(['FluentGeom2', 'FluentGeom2Array', 'FluentGeom3', 'FluentGeometryArray', 'FluentPath2', 'FluentPath2Array'])
    expect(Object.keys(methods.FluentGeom2).sort()).toEqual([
      'align', 'center', 'expand', 'extrudeFromSlices', 'extrudeHelical', 'extrudeLinear', 'extrudeRectangular', 'extrudeRotate', 'generalize', 'mirror', 'offset',
    ])
    expect(Object.keys(methods.FluentGeom3).sort()).toEqual(['align', 'center', 'expand', 'generalize', 'mirror', 'project'])
    expect(Object.keys(methods.FluentPath2).sort()).toEqual([
      'align', 'appendArc', 'appendBezier', 'center', 'expand', 'extrudeRectangular', 'generalize', 'mirror', 'offset',
    ])
    expect(Object.keys(methods.FluentGeometryArray).sort()).toEqual(['align', 'center', 'mirror'])
    expect(Object.keys(methods.FluentGeom2Array).sort()).toEqual(['extrudeHelical', 'extrudeLinear', 'extrudeRectangular', 'extrudeRotate'])
    expect(Object.keys(methods.FluentPath2Array).sort()).toEqual(['expand', 'extrudeRectangular'])
    expect(methods.FluentGeom2.extrudeLinear).toEqual(['height', 'repair', 'twistAngle', 'twistSteps'])
    expect(methods.FluentGeom2.extrudeHelical).toEqual(expect.arrayContaining(['angle', 'pitch', 'height', 'segmentsPerRotation']))
    expect(methods.FluentPath2.appendArc).toEqual(['clockwise', 'endpoint', 'large', 'radius', 'segments', 'xaxisrotation'])
    expect(OPTION_TABLES['@jscad/modeling'].methods).toEqual({})
  })

  it('takes a class method description and example from its own JSDoc', () => {
    expect(entry('FluentPath2.appendArc').description).toMatch(/^Add an elliptical arc from the path's last point/)
    expect(entry('FluentPath2.appendArc').example).toContain('.appendArc({ endpoint: [10, 10]')
    for (const name of ['FluentPath2.close', 'FluentPath2.concat', 'FluentGeom2.toSides', 'FluentGeom3.retessellate', 'FluentGeom3.invert', 'FluentGeom2.invert']) {
      expect(entry(name).description, name).not.toBe('')
    }
    for (const name of ['FluentPath2.reverse', 'FluentGeom3.clone', 'FluentPath2.clone']) {
      expect(entry(name).description, name).not.toMatch(/slice/)
    }
    expect(entry('FluentGeometryArray.measureArea').description).toMatch(/^Each item's area, in order/)
  })

  it('gives an undocumented method the text of its own geometry type first', () => {
    expect(entry('FluentGeom3.toPolygons').description).toMatch(/polygons/)
    expect(entry('FluentGeom3.toPolygons').description).not.toMatch(/slice/)
    expect(entry('FluentGeom2.toOutlines').description).not.toBe('')
  })

  it('points jf.maths namespaces at the modeling namespace instead of copying it', () => {
    expect(entry('jf.maths.vec3')).toEqual({ name: 'jf.maths.vec3', pkg: '@jbroll/jscad-fluent', kind: 'namespace', description: expect.stringMatching(/^3D vector functions/), sameAs: 'maths.vec3' })
    expect(entry('jf.maths.constants').members.map((m) => m.name)).toEqual(['TAU', 'EPS', 'NEPS', 'spatialResolution'])
  })

  it('leaves maths and geometries out of the option checks', () => {
    const modeling = OPTION_TABLES['@jscad/modeling']
    const internal = (path) => /^(maths|geometries)\./.test(path)
    expect(Object.keys(modeling.options).filter(internal)).toEqual([])
    expect(Object.keys(modeling.types).filter(internal)).toEqual([])
    expect(modeling.angles.filter(internal)).toEqual([])
  })

  it('tables fluent factories added for modeling parity', () => {
    const { options } = OPTION_TABLES['@jbroll/jscad-fluent']
    expect(options.path).toEqual(['closed'])
    expect(options.align).toEqual(expect.arrayContaining(['modes', 'relativeTo', 'grouped']))
    expect(options.vectorText).toEqual(expect.arrayContaining(['height', 'align', 'font']))
    expect(options.extrudeFromSlices).toEqual(expect.arrayContaining(['numberOfSlices', 'callback']))
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

  it('stays under 280 KB', () => {
    expect(formatIndex(entries).length).toBeLessThan(280_000)
  })

  it('keeps positional parameter text, except for maths', () => {
    expect(entry('transforms.rotateX').params[0]).toEqual({ name: 'angle', type: 'Number', description: 'angle (RADIANS) of rotations about X' })
    expect(entry('maths.vec3.add').params).toBeUndefined()
  })
})
