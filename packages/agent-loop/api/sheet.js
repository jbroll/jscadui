// Chosen from the functions the eval's saved models used, plus every primitive,
// boolean, transform, extrusion, expansion and hull.

const SECTIONS = {
  fluent: [
    ['3D shapes', ['jf.cube', 'jf.cuboid', 'jf.roundedCuboid', 'jf.cylinder', 'jf.cylinderElliptic', 'jf.roundedCylinder', 'jf.sphere', 'jf.ellipsoid', 'jf.geodesicSphere', 'jf.torus', 'jf.polyhedron']],
    ['2D shapes', ['jf.square', 'jf.rectangle', 'jf.roundedRectangle', 'jf.circle', 'jf.ellipse', 'jf.polygon', 'jf.star', 'jf.triangle', 'jf.arc', 'jf.line']],
    ['Booleans', ['jf.union', 'jf.subtract', 'jf.intersect', 'FluentGeom3.union', 'FluentGeom3.subtract', 'FluentGeom3.intersect']],
    [
      'Transforms',
      [
        'FluentGeom3.translate', 'FluentGeom3.translateX', 'FluentGeom3.translateY', 'FluentGeom3.translateZ',
        'FluentGeom3.rotate', 'FluentGeom3.rotateX', 'FluentGeom3.rotateY', 'FluentGeom3.rotateZ',
        'FluentGeom3.scale', 'FluentGeom3.scaleX', 'FluentGeom3.scaleY', 'FluentGeom3.scaleZ',
        'FluentGeom3.mirror', 'FluentGeom3.mirrorX', 'FluentGeom3.mirrorY', 'FluentGeom3.mirrorZ',
        'FluentGeom3.center', 'FluentGeom3.centerX', 'FluentGeom3.centerY', 'FluentGeom3.centerZ',
        'FluentGeom3.align', 'jf.align',
      ],
    ],
    ['Extrusions, of 2D shapes', ['FluentGeom2.extrudeLinear', 'FluentGeom2.extrudeRotate', 'FluentGeom2.extrudeRectangular', 'FluentGeom2.extrudeHelical']],
    ['Expansions', ['FluentGeom3.expand', 'FluentGeom2.offset']],
    ['Hulls, of one shape or of an array', ['jf.geom3Array', 'jf.geom2Array', 'FluentGeom3.hull', 'FluentGeom3.hullChain']],
    [
      'Color and measurement',
      ['FluentGeom3.colorize', 'FluentGeom3.measureDimensions', 'FluentGeom3.measureBoundingBox', 'FluentGeom3.measureCenter', 'FluentGeom3.measureVolume', 'FluentGeom2.measureArea'],
    ],
    ['Other', ['FluentGeom3.snap', 'FluentGeom3.clone']],
  ],
  modeling: [
    [
      '3D shapes',
      ['primitives.cube', 'primitives.cuboid', 'primitives.roundedCuboid', 'primitives.cylinder', 'primitives.cylinderElliptic', 'primitives.roundedCylinder', 'primitives.sphere', 'primitives.ellipsoid', 'primitives.geodesicSphere', 'primitives.torus', 'primitives.polyhedron'],
    ],
    ['2D shapes', ['primitives.square', 'primitives.rectangle', 'primitives.roundedRectangle', 'primitives.circle', 'primitives.ellipse', 'primitives.polygon', 'primitives.star', 'primitives.triangle', 'primitives.arc', 'primitives.line']],
    ['Booleans', ['booleans.union', 'booleans.subtract', 'booleans.intersect']],
    [
      'Transforms',
      [
        'transforms.translate', 'transforms.translateX', 'transforms.translateY', 'transforms.translateZ',
        'transforms.rotate', 'transforms.rotateX', 'transforms.rotateY', 'transforms.rotateZ',
        'transforms.scale', 'transforms.scaleX', 'transforms.scaleY', 'transforms.scaleZ',
        'transforms.mirror', 'transforms.mirrorX', 'transforms.mirrorY', 'transforms.mirrorZ',
        'transforms.center', 'transforms.centerX', 'transforms.centerY', 'transforms.centerZ',
        'transforms.align',
      ],
    ],
    ['Extrusions, of 2D shapes', ['extrusions.extrudeLinear', 'extrusions.extrudeRotate', 'extrusions.extrudeRectangular', 'extrusions.extrudeHelical']],
    ['Expansions', ['expansions.expand', 'expansions.offset']],
    ['Hulls', ['hulls.hull', 'hulls.hullChain']],
    [
      'Color and measurement',
      ['colors.colorize', 'measurements.measureDimensions', 'measurements.measureBoundingBox', 'measurements.measureCenter', 'measurements.measureVolume', 'measurements.measureArea'],
    ],
    ['Other', ['modifiers.snap']],
  ],
}

export const SHEET_NAMES = Object.fromEntries(Object.entries(SECTIONS).map(([api, sections]) => [api, sections.flatMap(([, names]) => names)]))

const METHOD_NOTE = { fluent: ['A line starting with `.` is a method: `shape.translate([0, 0, 5])`.'], modeling: [] }

const intro = (api) => [
  '## API reference',
  '',
  'Common calls, with option defaults. Angles are radians; `TAU` is `2 * Math.PI`.',
  '`docs` gives full details for anything not listed.',
  ...METHOD_NOTE[api],
]

const METHOD = /^Fluent\w+\.([\w$]+)$/
const ANGLE_OPTION = /^angle$|Angle$|Rotation$/
const ANGLE_PARAM = /^angles?$/

// The text between a signature's outermost parentheses.
const paramsText = (signature) => {
  const open = signature.indexOf('(')
  let depth = 0
  for (let i = open; i < signature.length; i += 1) {
    if ('([{'.includes(signature[i])) depth += 1
    else if (')]}'.includes(signature[i]) && --depth === 0) return signature.slice(open + 1, i)
  }
  return ''
}

const splitTopLevel = (text) => {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    if ('([{'.includes(text[i])) depth += 1
    else if (')]}'.includes(text[i])) depth -= 1
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

// A type worth showing: not Object, and not a union over fluent classes or `this`.
const shownType = (type) => type && !/Object|Fluent|this|\(/.test(type)

// `offset: Vec3` from a fluent signature, `offset: Array` from a modeling one's params.
const positional = (entry) =>
  splitTopLevel(paramsText(entry.signature)).map((part) => {
    const colon = part.indexOf(':')
    const name = (colon === -1 ? part : part.slice(0, colon)).trim()
    const type = colon === -1 ? entry.params?.find((p) => p.name === name.replace(/^\.\.\./, ''))?.type : part.slice(colon + 1).trim()
    return { name, type: name.startsWith('...') ? null : type }
  })

const optionList = (options) =>
  `{ ${options.map((o) => (o.default != null && o.default !== '' ? `${o.name} = ${o.default}` : o.name)).join(', ')} }`

const renderLine = (entry, byName) => {
  const method = METHOD.exec(entry.name)
  const head = method ? `.${method[1]}` : entry.name
  const options = (entry.sameAs ? byName.get(entry.sameAs) : entry).options ?? []
  const params = positional(entry)
  const args = params.map((p, i) => (i === 0 && entry.optionsFirst && options.length ? optionList(options) : shownType(p.type) ? `${p.name}: ${p.type}` : p.name))
  const angled = options.some((o) => ANGLE_OPTION.test(o.name)) || ANGLE_PARAM.test(params[0]?.name ?? '')
  return `${head}(${args.join(', ')})${angled ? ' // radians' : ''}`
}

export const buildSheet = (entries, api) => {
  const byName = new Map(entries.map((e) => [e.name, e]))
  const entryOf = (name) => {
    const entry = byName.get(name)
    if (!entry?.signature) throw new Error(`sheet: ${name} is not a function in the API index`)
    return entry
  }
  const sections = SECTIONS[api].flatMap(([label, names]) => [`// ${label}`, ...names.map((name) => renderLine(entryOf(name), byName)), ''])
  return `${[...intro(api), '', '```', ...sections.slice(0, -1), '```'].join('\n')}\n`
}

// A rough token count for budgeting: each word and each punctuation mark.
export const estimateTokens = (text) => text.match(/\w+|[^\s\w]/g)?.length ?? 0
