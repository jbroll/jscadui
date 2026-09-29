import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { explainError, explainThrow, explainWarning, TAPER, withErrorHint } from '../src/hints.js'

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

describe('explainThrow', () => {
  it('gives the roundRadius limit from the smallest size', () => {
    const message = 'roundRadius must be smaller than the radius of all dimensions'
    expect(explainThrow(message, { size: [40, 30, 2.4], roundRadius: 2 })).toBe(
      'roundRadius 2 is too big: it must be under half the smallest size, 2.4 / 2 = 1.2',
    )
    expect(explainThrow(message, { size: [10, 2.5], roundRadius: 2 })).toContain('2.5 / 2 = 1.25')
  })

  it('gives the roundRadius limit from a rounded cylinder height', () => {
    expect(explainThrow('height must be larger than twice roundRadius', { height: 3, radius: 5, roundRadius: 2 })).toBe(
      'roundRadius 2 is too big: it must be under half the height, 3 / 2 = 1.5',
    )
  })

  it('adds nothing for other errors or options it cannot read', () => {
    expect(explainThrow('size must be positive', { size: 1 })).toBeUndefined()
    expect(explainThrow('roundRadius must be smaller than the radius of all dimensions', undefined)).toBeUndefined()
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
