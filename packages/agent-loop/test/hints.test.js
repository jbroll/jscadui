import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { explainError, explainWarning, TAPER, withErrorHint } from '../src/hints.js'

const index = JSON.parse(readFileSync(new URL('../api/index.json', import.meta.url), 'utf8'))

const unknown = (fn, option, suggestions = []) => ({ fn, option, suggestions })

describe('explainWarning: unknown options', () => {
  it('points a cylinder taper option at the chosen API form, not at radius', () => {
    for (const option of ['radiusStart', 'radiusEnd', 'startRadius', 'radiusTop', 'r1', 'd2']) {
      expect(explainWarning(unknown('primitives.cylinder', option, ['radius']), 'modeling')).toEqual({
        fn: 'primitives.cylinder', option, suggestions: [], hint: TAPER.modeling,
      })
      expect(explainWarning(unknown('jf.cylinder', option, ['radius']), 'fluent').hint).toBe(TAPER.fluent)
    }
    expect(TAPER.modeling).toContain('primitives.cylinderElliptic({ startRadius')
    expect(TAPER.modeling).not.toContain('jf.')
    expect(TAPER.fluent).toContain('jf.cylinder({ radius: [start, end]')
    expect(TAPER.fluent).not.toContain('cylinderElliptic')
    for (const text of Object.values(TAPER)) expect(text).toContain('start is the -Z end')
  })

  it('names the chosen API even when the other one was called', () => {
    expect(explainWarning(unknown('primitives.cylinder', 'radiusStart'), 'fluent').hint).toBe(TAPER.fluent)
    expect(explainWarning(unknown('primitives.cube', 'roundRadius'), 'fluent').hint).toBe('jf.roundedCuboid takes roundRadius')
  })

  it('names a sibling function that takes the option', () => {
    expect(explainWarning(unknown('primitives.cube', 'roundRadius'), 'modeling')).toEqual({
      fn: 'primitives.cube', option: 'roundRadius', suggestions: [], hint: 'primitives.roundedCuboid takes roundRadius',
    })
    expect(explainWarning(unknown('jf.cube', 'roundRadius'), 'fluent').hint).toBe('jf.roundedCuboid takes roundRadius')
  })

  it('keeps a good suggestion and adds no hint when no sibling takes the option', () => {
    expect(explainWarning(unknown('primitives.roundedCuboid', 'radius', ['roundRadius']), 'modeling')).toEqual(
      unknown('primitives.roundedCuboid', 'radius', ['roundRadius']),
    )
    expect(explainWarning(unknown('jf.cube', 'sise', ['size']), 'fluent')).toEqual(unknown('jf.cube', 'sise', ['size']))
  })
})

describe('explainWarning: option types', () => {
  it('names the sibling that takes an array for the option', () => {
    expect(explainWarning({ fn: 'primitives.cube', option: 'size', expected: 'number', got: 'array' }, 'modeling')).toEqual({
      fn: 'primitives.cube', option: 'size', hint: 'primitives.cube takes size as a number; for an array size use primitives.cuboid',
    })
    expect(explainWarning({ fn: 'jf.cube', option: 'size', expected: 'number', got: 'array' }, 'fluent').hint).toBe(
      'jf.cube takes size as a number; for an array size use jf.cuboid',
    )
  })

  it('names the chosen API form of the called function, whichever package was called', () => {
    expect(explainWarning({ fn: 'primitives.cube', option: 'size', expected: 'number', got: 'array' }, 'fluent').hint).toBe(
      'jf.cube takes size as a number; for an array size use jf.cuboid',
    )
    expect(explainWarning({ fn: 'FluentGeom2.extrudeLinear', option: 'height', expected: 'number', got: 'array' }, 'modeling').hint).toBe(
      'extrusions.extrudeLinear takes height as a number',
    )
    expect(explainWarning({ fn: 'FluentGeom2.extrudeLinear', option: 'height', expected: 'number', got: 'array' }, 'fluent').hint).toBe(
      'FluentGeom2.extrudeLinear takes height as a number',
    )
    expect(explainWarning({ fn: 'primitives.cylinder', option: 'radius', expected: 'number', got: 'array' }, 'fluent').hint).toBe(TAPER.fluent)
  })

  it('says only the expected type when no sibling fits', () => {
    expect(explainWarning({ fn: 'primitives.sphere', option: 'radius', expected: 'number', got: 'array' }, 'modeling').hint).toBe(
      'primitives.sphere takes radius as a number',
    )
  })

  it('gives the taper form for an array cylinder radius', () => {
    const hint = explainWarning({ fn: 'primitives.cylinder', option: 'radius', expected: 'number', got: 'array' }, 'modeling').hint
    expect(hint).toBe(`primitives.cylinder takes radius as a number; ${TAPER.modeling}`)
  })
})

describe('explainWarning: angles', () => {
  it('says a large angle looks like degrees', () => {
    expect(explainWarning({ fn: 'FluentGeom3.rotateX', option: 'angle', value: 90 }, 'fluent')).toEqual({
      fn: 'FluentGeom3.rotateX', option: 'angle', hint: '90 looks like degrees; angles are radians, so use 90 * Math.PI / 180',
    })
  })
})

describe('explainWarning for a fixed option', () => {
  it('says what limit a clamped roundRadius met and what was used', () => {
    expect(explainWarning({ fn: 'jf.roundedCuboid', option: 'roundRadius', clamped: true, from: 2, to: 1.199, least: 2.4 }, 'fluent').hint).toBe(
      'roundRadius 2 is too big: it must be under half the smallest size, 2.4 / 2 = 1.2; used 1.199',
    )
    expect(explainWarning({ fn: 'primitives.roundedCylinder', option: 'roundRadius', clamped: true, from: 2, to: 1.499, height: 3 }).hint).toBe(
      'roundRadius 2 is too big: it must be under half the height, 3 / 2 = 1.5; used 1.499',
    )
    expect(explainWarning({ fn: 'primitives.roundedCylinder', option: 'roundRadius', clamped: true, from: 6, to: 4.999, radius: 5 }).hint).toBe(
      'roundRadius 6 is too big: it must be at most the radius, 5; used 4.999',
    )
  })

  it('says a number radius became a pair', () => {
    expect(explainWarning({ fn: 'jf.cylinderElliptic', option: 'endRadius', coerced: true, from: 2, to: [2, 2] }, 'fluent')).toEqual({
      fn: 'jf.cylinderElliptic', option: 'endRadius', hint: 'endRadius takes an [x, y] pair of radii; used [2, 2] for 2',
    })
  })
})

describe('explainError', () => {
  const fluent = (message) => explainError(message, { api: 'fluent', index })
  const modeling = (message) => explainError(message, { api: 'modeling', index })

  it('points a method used as a jf function at the method form', () => {
    expect(fluent('jf.measureVolume is not a function')).toBe('measureVolume is a method of FluentGeom3, FluentGeom3Array: use shape.measureVolume(...)')
  })

  it('points a method called on plain modeling geometry at jf shapes in fluent mode', () => {
    const hint = fluent('extrudeLinear(...).translate is not a function')
    expect(hint).toContain('plain @jscad/modeling shapes have no methods')
    expect(hint).toContain('make the shape with jf.*')
    expect(hint).toContain('shape.translate(...)')
  })

  it('points at the functional form in modeling mode', () => {
    expect(modeling('extrudeLinear(...).translate is not a function')).toBe(
      '@jscad/modeling shapes have no methods; use transforms.translate(offset, shape)',
    )
    expect(modeling('c.rotateY is not a function')).toContain('transforms.rotateY(angle, shape)')
    expect(modeling('jf.measureVolume is not a function')).toBe('use measurements.measureVolume(shape)')
    expect(modeling('translate is not a function')).toBe('use transforms.translate(offset, shape)')
  })

  it('points only at modeling operations, never maths or geometries helpers of the same name', () => {
    expect(modeling('shape.scale is not a function')).toBe('@jscad/modeling shapes have no methods; use transforms.scale(factors, shape)')
    expect(modeling('shape.transform is not a function')).toBe('@jscad/modeling shapes have no methods; use transforms.transform(matrix, shape)')
  })

  it('answers a cone with the taper form', () => {
    expect(modeling('cone is not a function')).toBe(TAPER.modeling)
    expect(fluent('jf.cone is not a function')).toBe(TAPER.fluent)
  })

  it('adds nothing to other errors', () => {
    expect(fluent('size must be positive')).toBeUndefined()
    expect(modeling('foo.bar is not a function')).toBeUndefined()
  })

  it('appends the hint to the message once', () => {
    const once = withErrorHint('cone is not a function', { api: 'modeling', index })
    expect(once).toBe(`cone is not a function\n${TAPER.modeling}`)
    expect(withErrorHint(once, { api: 'modeling', index })).toBe(once)
    expect(withErrorHint('boom', { api: 'modeling', index })).toBe('boom')
  })
})

describe('explainWarning: winding, empty booleans and mesh data', () => {
  it('says clockwise points were reversed', () => {
    expect(explainWarning({ fn: 'jf.polygon', option: 'points', area: -50, reversed: true }, 'fluent')).toEqual({
      fn: 'jf.polygon',
      option: 'points',
      hint: 'points ran clockwise (area -50); reversed them so extrusions come out right side out',
    })
  })

  it('says clockwise points extrude inside out, in the chosen API form', () => {
    expect(explainWarning({ fn: 'jf.polygon', option: 'points', area: -50 }, 'fluent')).toEqual({
      fn: 'jf.polygon',
      option: 'points',
      hint: 'points run clockwise (area -50), so an extrusion of this outline comes out inside out: list them counter-clockwise, e.g. jf.polygon([...points].reverse())',
    })
    expect(explainWarning({ fn: 'jf.polygon', option: 'points', area: -50 }, 'modeling').hint).toMatch(/e\.g\. primitives\.polygon\(\{ points: \[\.\.\.points\]\.reverse\(\) \}\)$/)
    expect(explainWarning({ fn: 'geometries.geom2.fromPoints', option: 'points', area: -2.5 }, 'modeling').hint).toMatch(
      /^points run clockwise \(area -2\.5\).*e\.g\. geometries\.geom2\.fromPoints\(\[\.\.\.points\]\.reverse\(\)\)$/,
    )
    expect(explainWarning({ fn: 'geometries.geom2.fromPoints', option: 'points', area: -50 }, 'fluent').hint).toMatch(/jf\.polygon\(\[\.\.\.points\]\.reverse\(\)\)$/)
  })

  it('says why a subtract or intersect came back empty', () => {
    expect(explainWarning({ fn: 'FluentGeom3.subtract', empty: 'subtract' }, 'fluent')).toEqual({
      fn: 'FluentGeom3.subtract',
      hint: 'subtract returned an empty shape: what it removed covers all of the first shape; compare their bounding boxes with shape.measureBoundingBox()',
    })
    expect(explainWarning({ fn: 'booleans.intersect', empty: 'intersect' }, 'modeling').hint).toBe(
      'intersect returned an empty shape: the shapes do not overlap; compare their bounding boxes with measurements.measureBoundingBox(shape)',
    )
  })

  it('points { points, faces } data at the polyhedron factory, modeling only', () => {
    // Fluent's own constructor/boolean throws a TypeError naming jf.polyhedron already.
    expect(explainWarning({ fn: 'FluentGeom3.union', meshOperand: true }, 'fluent').hint).toBeUndefined()
    expect(explainWarning({ fn: 'booleans.union', meshOperand: true }, 'modeling').hint).toBe(
      'an operand is { points, faces } data, not a shape: make it one with primitives.polyhedron({ points, faces })',
    )
  })
})

describe('explainError: names that are not defined', () => {
  const fluent = (message) => explainError(message, { api: 'fluent', index })
  const modeling = (message) => explainError(message, { api: 'modeling', index })

  it('names the namespace a modeling function comes from', () => {
    expect(modeling('cuboid is not defined')).toBe("cuboid is in primitives: const { cuboid } = require('@jscad/modeling').primitives")
    expect(modeling('union is not defined')).toBe("union is in booleans: const { union } = require('@jscad/modeling').booleans")
    expect(modeling('colorize is not defined')).toBe("colorize is in colors: const { colorize } = require('@jscad/modeling').colors")
  })

  it('names a modeling namespace', () => {
    expect(modeling('measurements is not defined')).toBe("measurements is a namespace: const { measurements } = require('@jscad/modeling')")
  })

  it('gives the jf function or the method form in fluent mode', () => {
    expect(fluent('cuboid is not defined')).toBe('use jf.cuboid(...)')
    expect(fluent('union is not defined')).toBe('use jf.union(...), or shape.union(...) on a jf shape')
    expect(fluent('translate is not defined')).toBe('translate is a method of FluentGeom2, FluentGeom3, FluentPath2, FluentGeometryArray: use shape.translate(...)')
  })

  it('adds nothing for a name neither API has', () => {
    expect(fluent('wibble is not defined')).toBeUndefined()
    expect(modeling('wibble is not defined')).toBeUndefined()
  })
})
