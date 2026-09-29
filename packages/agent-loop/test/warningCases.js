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

const hintOf = (message) => message.slice(message.indexOf('\n') + 1)

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
    expect(result.error.message).toContain('\n')
    for (const other of others) expect(hintOf(result.error.message)).not.toContain(other)
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
]
