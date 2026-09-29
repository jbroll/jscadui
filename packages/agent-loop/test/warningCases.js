// Model runs whose warnings and errors the eval harness (eval/backend.test.js)
// and the app (apps/jscad-web/test/option-hints.test.js) must answer alike.
// `hints` and `error` list text each must contain; neither may name the other
// API's form after the model's own error text.

const modeling = (body) => `const { primitives, transforms, extrusions } = require('@jscad/modeling')\n${body}`
const fluent = (body) => `const jf = require('@jbroll/jscad-fluent')\n${body}`

export const OTHER_API = {
  fluent: ['primitives.', 'transforms.', 'measurements.', 'cylinderElliptic'],
  modeling: ['jf.', 'FluentGeom'],
}

// Most thrown errors get a hint appended on its own line; a few, like fluent's
// own { points, faces } TypeError, already name the fix and need none.
const hintOf = (message) => {
  const i = message.indexOf('\n')
  return i < 0 ? undefined : message.slice(i + 1)
}

/**
 * @param {Function} expect vitest's expect
 * @param {object} c a WARNING_CASES entry
 * @param {{ warnings?: object[], error?: { message: string } }} result the path's answer
 */
export const expectCase = (expect, c, result) => {
  const others = OTHER_API[c.api]
  if (c.error) {
    expect(result.error?.message).toBeDefined()
    for (const text of c.error) expect(result.error.message).toContain(text)
    const hint = hintOf(result.error.message)
    if (hint !== undefined) for (const other of others) expect(hint).not.toContain(other)
    return
  }
  expect(result.error).toBeUndefined()
  const warnings = result.warnings ?? []
  expect(warnings.map(({ fn, option }) => ({ fn, option }))).toEqual(c.warnings.map(({ fn, option }) => ({ fn, option })))
  c.warnings.forEach((want, i) => {
    const got = warnings[i]
    if (want.suggestions) expect(got.suggestions).toEqual(want.suggestions)
    for (const text of want.hints) expect(got.hint).toContain(text)
    for (const other of others) expect(got.hint).not.toContain(other)
  })
}

export const WARNING_CASES = [
  {
    name: 'D: a taper option on a modeling cylinder names cylinderElliptic',
    api: 'modeling',
    source: modeling('module.exports = { main: () => primitives.cylinder({ radiusStart: 5, radiusEnd: 2, height: 10 }) }'),
    warnings: [
      { fn: 'primitives.cylinder', option: 'radiusStart', suggestions: [], hints: ['primitives.cylinderElliptic({ startRadius', 'endRadius', 'start is the -Z end'] },
      { fn: 'primitives.cylinder', option: 'radiusEnd', suggestions: [], hints: ['primitives.cylinderElliptic'] },
    ],
  },
  {
    name: 'D: a taper option on jf.cylinder names the radius pair',
    api: 'fluent',
    source: fluent('module.exports = { main: () => jf.cylinder({ startRadius: 5, endRadius: 2, height: 10 }) }'),
    warnings: [
      { fn: 'jf.cylinder', option: 'startRadius', suggestions: [], hints: ['jf.cylinder({ radius: [start, end]', 'start is the -Z end'] },
      { fn: 'jf.cylinder', option: 'endRadius', suggestions: [], hints: ['jf.cylinder({ radius: [start, end]'] },
    ],
  },
  {
    name: 'D: a sibling function that takes the option is named',
    api: 'fluent',
    source: fluent('module.exports = { main: () => jf.cube({ size: 10, roundRadius: 1 }) }'),
    warnings: [{ fn: 'jf.cube', option: 'roundRadius', suggestions: [], hints: ['jf.roundedCuboid takes roundRadius'] }],
  },
  {
    name: 'E: a degree angle to a modeling rotate',
    api: 'modeling',
    source: modeling('module.exports = { main: () => transforms.rotateX(90, primitives.cube({ size: 2 })) }'),
    warnings: [{ fn: 'transforms.rotateX', option: 'angle', hints: ['90 looks like degrees; angles are radians'] }],
  },
  {
    name: 'E: degree angles to fluent rotate methods',
    api: 'fluent',
    source: fluent('module.exports = { main: () => jf.cube({ size: 2 }).rotateX(90).rotate([0, 0, 45]).rotateY(Math.PI / 2) }'),
    warnings: [
      { fn: 'FluentGeom3.rotateX', option: 'angle', hints: ['90 * Math.PI / 180'] },
      { fn: 'FluentGeom3.rotate', option: 'angle', hints: ['45 looks like degrees'] },
    ],
  },
  {
    name: 'J: an array cube size names cuboid in the thrown error',
    api: 'modeling',
    source: modeling('module.exports = { main: () => primitives.cube({ size: [10, 20, 30] }) }'),
    error: ['size must be positive', 'primitives.cube takes size as a number; for an array size use primitives.cuboid'],
  },
  {
    name: 'J: an array jf.cube size names jf.cuboid',
    api: 'fluent',
    source: fluent('module.exports = { main: () => jf.cube({ size: [10, 20, 30] }) }'),
    error: ['jf.cube takes size as a number; for an array size use jf.cuboid'],
  },
  {
    name: 'J: an array cylinder radius gives the taper form',
    api: 'modeling',
    source: modeling('module.exports = { main: () => primitives.cylinder({ radius: [5, 3], height: 10 }) }'),
    error: ['radius must be positive', 'primitives.cylinderElliptic({ startRadius'],
  },
  {
    name: 'H: roundRadius too big for a thin side gives the limit',
    api: 'fluent',
    source: fluent('module.exports = { main: () => jf.roundedCuboid({ size: [40, 30, 2.4], roundRadius: 2 }) }'),
    error: ['roundRadius must be smaller', 'roundRadius 2 is too big: it must be under half the smallest size, 2.4 / 2 = 1.2'],
  },
  {
    name: 'I: a method on plain modeling geometry, fluent mode',
    api: 'fluent',
    source: `${modeling('')}const jf = require('@jbroll/jscad-fluent')
module.exports = { main: () => primitives.cube({ size: 2 }).translate([1, 0, 0]) }`,
    error: ['translate is not a function', 'plain @jscad/modeling shapes have no methods, so make the shape with jf.*', 'shape.translate(...)'],
  },
  {
    name: 'I: a method on plain modeling geometry, modeling mode',
    api: 'modeling',
    source: modeling('module.exports = { main: () => extrusions.extrudeLinear({ height: 2 }, primitives.square({ size: 2 })).translate([1, 0, 0]) }'),
    error: ['translate is not a function', 'use transforms.translate(offset, shape)'],
  },
  {
    name: 'I: a method used as a jf function',
    api: 'fluent',
    source: fluent('module.exports = { main: () => { jf.measureVolume(jf.cube({ size: 2 })); return jf.cube() } }'),
    error: ['jf.measureVolume is not a function', 'measureVolume is a method of FluentGeom3, FluentGeom3Array: use shape.measureVolume(...)'],
  },
  {
    name: 'W: clockwise jf.polygon points',
    api: 'fluent',
    source: fluent('module.exports = { main: () => jf.polygon([[0, 0], [0, 10], [10, 0]]).extrudeLinear({ height: 2 }) }'),
    warnings: [{ fn: 'jf.polygon', option: 'points', hints: ['points run clockwise (area -50)', 'inside out', 'jf.polygon([...points].reverse())'] }],
  },
  {
    name: 'W: clockwise primitives.polygon points',
    api: 'modeling',
    source: modeling('module.exports = { main: () => extrusions.extrudeLinear({ height: 2 }, primitives.polygon({ points: [[0, 0], [0, 10], [10, 0]] })) }'),
    warnings: [{ fn: 'primitives.polygon', option: 'points', hints: ['points run clockwise (area -50)', 'primitives.polygon({ points: [...points].reverse() })'] }],
  },
  {
    name: 'W: clockwise geom2.fromPoints points',
    api: 'modeling',
    source: `const { geometries } = require('@jscad/modeling')\nmodule.exports = { main: () => geometries.geom2.fromPoints([[0, 0], [0, 10], [10, 0]]) }`,
    warnings: [{ fn: 'geometries.geom2.fromPoints', option: 'points', hints: ['points run clockwise', 'geometries.geom2.fromPoints([...points].reverse())'] }],
  },
  {
    name: 'W: counter-clockwise points warn nothing',
    api: 'fluent',
    source: fluent('module.exports = { main: () => jf.polygon([[0, 0], [10, 0], [0, 10]]).extrudeLinear({ height: 2 }) }'),
    warnings: [],
  },
  {
    name: 'B: a fluent subtract that removes the whole part',
    api: 'fluent',
    source: fluent('module.exports = { main: () => [jf.cube({ size: 2 }).subtract(jf.cube({ size: 10 })), jf.cube()] }'),
    warnings: [{ fn: 'FluentGeom3.subtract', hints: ['subtract returned an empty shape', 'shape.measureBoundingBox()'] }],
  },
  {
    name: 'B: a modeling intersect with no overlap',
    api: 'modeling',
    source: `const { booleans, primitives, transforms } = require('@jscad/modeling')\nmodule.exports = { main: () => [booleans.intersect(primitives.cube({ size: 2 }), transforms.translate([10, 0, 0], primitives.cube({ size: 2 }))), primitives.cube()] }`,
    warnings: [{ fn: 'booleans.intersect', hints: ['intersect returned an empty shape: the shapes do not overlap', 'measurements.measureBoundingBox(shape)'] }],
  },
  {
    name: 'U: jf.hullPoints3 data given to union points at jf.polyhedron',
    api: 'fluent',
    source: fluent('module.exports = { main: () => jf.cube({ size: 2 }).union(jf.hullPoints3([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]])) }'),
    // Fluent's own TypeError already names the fix; no hint line is added.
    error: ['FluentGeom3.union got { points, faces } data, not a geom3', 'jf.polyhedron({ points, faces })'],
  },
  {
    name: 'U: { points, faces } given to a modeling union points at primitives.polyhedron',
    api: 'modeling',
    source: `const { booleans, primitives } = require('@jscad/modeling')\nmodule.exports = { main: () => booleans.union(primitives.cube(), { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] }) }`,
    error: ['only unions of the same type are supported', 'primitives.polyhedron({ points, faces })'],
  },
  {
    name: 'N: a modeling function used without its namespace, modeling mode',
    api: 'modeling',
    source: modeling('module.exports = { main: () => cuboid({ size: [1, 2, 3] }) }'),
    error: ['cuboid is not defined', "const { cuboid } = require('@jscad/modeling').primitives"],
  },
  {
    name: 'N: a modeling namespace never required, modeling mode',
    api: 'modeling',
    source: modeling('module.exports = { main: () => { measurements.measureVolume(primitives.cube()); return primitives.cube() } }'),
    error: ['measurements is not defined', "const { measurements } = require('@jscad/modeling')"],
  },
  {
    name: 'N: a modeling function name in fluent mode',
    api: 'fluent',
    source: fluent('module.exports = { main: () => cuboid({ size: [1, 2, 3] }) }'),
    error: ['cuboid is not defined', 'use jf.cuboid(...)'],
  },
  {
    name: 'N: a modeling transform name in fluent mode',
    api: 'fluent',
    source: fluent('module.exports = { main: () => translate([1, 0, 0], jf.cube()) }'),
    error: ['translate is not defined', 'use shape.translate(...)'],
  },
  // Code that calls the other API's package: hints still name the chosen API only.
  {
    name: 'cross D: a modeling taper option under fluent names the jf radius pair',
    api: 'fluent',
    source: modeling('module.exports = { main: () => primitives.cylinder({ radiusStart: 5, height: 10 }) }'),
    warnings: [{ fn: 'primitives.cylinder', option: 'radiusStart', suggestions: [], hints: ['jf.cylinder({ radius: [start, end]'] }],
  },
  {
    name: 'cross D: a jf taper option under modeling names cylinderElliptic',
    api: 'modeling',
    source: fluent('module.exports = { main: () => jf.cylinder({ startRadius: 5, height: 10 }) }'),
    warnings: [{ fn: 'jf.cylinder', option: 'startRadius', suggestions: [], hints: ['primitives.cylinderElliptic({ startRadius'] }],
  },
  {
    name: 'cross D: a modeling sibling option under fluent names the jf sibling',
    api: 'fluent',
    source: modeling('module.exports = { main: () => primitives.cube({ size: 10, roundRadius: 1 }) }'),
    warnings: [{ fn: 'primitives.cube', option: 'roundRadius', suggestions: [], hints: ['jf.roundedCuboid takes roundRadius'] }],
  },
  {
    name: 'cross D: a jf sibling option under modeling names the modeling sibling',
    api: 'modeling',
    source: fluent('module.exports = { main: () => jf.cube({ size: 10, roundRadius: 1 }) }'),
    warnings: [{ fn: 'jf.cube', option: 'roundRadius', suggestions: [], hints: ['primitives.roundedCuboid takes roundRadius'] }],
  },
  {
    name: 'cross E: a degree angle to a modeling rotate under fluent',
    api: 'fluent',
    source: modeling('module.exports = { main: () => transforms.rotateZ(45, primitives.cube({ size: 2 })) }'),
    warnings: [{ fn: 'transforms.rotateZ', option: 'angle', hints: ['45 looks like degrees'] }],
  },
  {
    name: 'cross E: a degree angle to a fluent method under modeling',
    api: 'modeling',
    source: fluent('module.exports = { main: () => jf.cube({ size: 2 }).rotateY(90) }'),
    warnings: [{ fn: 'FluentGeom3.rotateY', option: 'angle', hints: ['90 looks like degrees'] }],
  },
  {
    name: 'cross J: an array modeling cube size under fluent names jf forms only',
    api: 'fluent',
    source: modeling('module.exports = { main: () => primitives.cube({ size: [10, 20, 30] }) }'),
    error: ['size must be positive', 'jf.cube takes size as a number; for an array size use jf.cuboid'],
  },
  {
    name: 'cross J: an array jf.cube size under modeling names modeling forms only',
    api: 'modeling',
    source: fluent('module.exports = { main: () => jf.cube({ size: [10, 20, 30] }) }'),
    error: ['primitives.cube takes size as a number; for an array size use primitives.cuboid'],
  },
  {
    name: 'cross J: an array modeling cylinder radius under fluent gives the jf taper',
    api: 'fluent',
    source: modeling('module.exports = { main: () => primitives.cylinder({ radius: [5, 3], height: 10 }) }'),
    error: ['radius must be positive', 'jf.cylinder({ radius: [start, end]'],
  },
  {
    name: 'cross J: a number jf method option given an array under modeling',
    api: 'modeling',
    source: fluent('module.exports = { main: () => jf.circle({ radius: 2 }).extrudeLinear({ height: [1, 2] }) }'),
    error: ['extrusions.extrudeLinear takes height as a number'],
  },
  {
    name: 'cross H: roundRadius too big in modeling code under fluent',
    api: 'fluent',
    source: modeling('module.exports = { main: () => primitives.roundedCuboid({ size: [40, 30, 2.4], roundRadius: 2 }) }'),
    error: ['roundRadius 2 is too big: it must be under half the smallest size, 2.4 / 2 = 1.2'],
  },
  {
    name: 'cross W: clockwise modeling polygon points under fluent name jf.polygon',
    api: 'fluent',
    source: modeling('module.exports = { main: () => primitives.polygon({ points: [[0, 0], [0, 10], [10, 0]] }) }'),
    warnings: [{ fn: 'primitives.polygon', option: 'points', hints: ['jf.polygon([...points].reverse())'] }],
  },
  {
    name: 'cross I: a method used as a jf function under modeling',
    api: 'modeling',
    source: fluent('module.exports = { main: () => { jf.measureVolume(jf.cube({ size: 2 })); return jf.cube() } }'),
    error: ['jf.measureVolume is not a function', 'use measurements.measureVolume(shape)'],
  },
]
