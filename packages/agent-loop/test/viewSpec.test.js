import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEW_SIZE,
  MAX_VIEW_SIZE,
  MAX_VIEWS,
  VIEW_PRESETS,
  normalizeViewRequest,
  viewInputSchema,
} from '../src/viewSpec.js'

// The error a call threw, or undefined when it did not throw: to assert the
// name without catching by hand at each call site.
const thrown = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

describe('normalizeViewRequest', () => {
  it('defaults to one iso-front at 640x480', () => {
    expect(normalizeViewRequest(undefined)).toEqual({ views: [{ kind: 'preset', preset: 'iso-front' }], size: DEFAULT_VIEW_SIZE })
  })

  it('defaults an omitted or empty view list to one iso-front, never a live pose', () => {
    const oneFront = { views: [{ kind: 'preset', preset: 'iso-front' }], size: DEFAULT_VIEW_SIZE }
    expect(normalizeViewRequest({})).toEqual(oneFront)
    expect(normalizeViewRequest({ views: [] })).toEqual(oneFront)
    expect(normalizeViewRequest({ size: { w: 320, h: 240 } })).toEqual({ ...oneFront, size: { w: 320, h: 240 } })
  })

  it('takes a single spec object as one view', () => {
    expect(normalizeViewRequest({ preset: 'top' })).toEqual({ views: [{ kind: 'preset', preset: 'top' }], size: DEFAULT_VIEW_SIZE })
  })

  it('normalizes every aim form', () => {
    expect(
      normalizeViewRequest({
        views: [
          { preset: 'left' },
          { lookAt: [1, 2, 3] },
          { lookAt: 'body.front.left' },
          { position: [10, 0, 0], offset: [0, 5, 0] },
        ],
      }).views,
    ).toEqual([
      { kind: 'preset', preset: 'left' },
      { kind: 'lookAt', point: [1, 2, 3] },
      { kind: 'lookAtPart', part: 'body.front.left' },
      { kind: 'position', position: [10, 0, 0], offset: [0, 5, 0] },
    ])
  })

  it('reads a whole-number lookAt as the part index check reports', () => {
    expect(normalizeViewRequest({ lookAt: 57 }).views).toEqual([{ kind: 'lookAtPart', part: '57' }])
    expect(normalizeViewRequest({ lookAt: ' 51-54 ' }).views).toEqual([{ kind: 'lookAtPart', part: '51-54' }])
    expect(thrown(() => normalizeViewRequest({ lookAt: 1.5 }))?.name).toBe('ArgumentsError')
    expect(thrown(() => normalizeViewRequest({ lookAt: -1 }))?.name).toBe('ArgumentsError')
  })

  it('defaults a missing offset to zero and copies the triples it returns', () => {
    const point = [1, 2, 3]
    const position = [4, 5, 6]
    const { views } = normalizeViewRequest({ views: [{ lookAt: point }, { position }] })
    expect(views[0].point).toEqual([1, 2, 3])
    expect(views[1]).toEqual({ kind: 'position', position: [4, 5, 6], offset: [0, 0, 0] })
    point[0] = 99
    position[0] = 99
    expect(views[0].point[0]).toBe(1)
    expect(views[1].position[0]).toBe(4)
  })

  it('accepts an explicit size within the cap', () => {
    expect(normalizeViewRequest({ size: { w: 768, h: 512 } }).size).toEqual({ w: 768, h: 512 })
  })

  it('rejects five views, oversize, and unknown preset', () => {
    expect(() => normalizeViewRequest({ views: [{}, {}, {}, {}, {}] })).toThrowError(/at most 4/)
    expect(() => normalizeViewRequest({ size: { w: 2000, h: 2000 } })).toThrowError(/768/)
    expect(() => normalizeViewRequest({ views: [{ preset: 'diagonal' }] })).toThrowError(/preset/)
  })

  it('rejects a longest side over the cap even when the other side is small', () => {
    expect(() => normalizeViewRequest({ size: { w: 900, h: 100 } })).toThrowError(/769|at most 768/)
    expect(MAX_VIEW_SIZE).toBe(768)
  })

  it('takes a lookAt beside a preset or a position as the point that direction aims at', () => {
    expect(normalizeViewRequest({ views: [{ preset: 'top', lookAt: [1, 2, 3] }, { position: [9, 0, 0], lookAt: 'lid' }] }).views).toEqual([
      { kind: 'preset', preset: 'top', target: { kind: 'lookAt', point: [1, 2, 3] } },
      { kind: 'position', position: [9, 0, 0], offset: [0, 0, 0], target: { kind: 'lookAtPart', part: 'lid' } },
    ])
  })

  it('rejects a spec that names no aim, or two directions', () => {
    expect(() => normalizeViewRequest({ views: [{}] })).toThrowError(/preset, lookAt/)
    expect(() => normalizeViewRequest({ views: [{ preset: 'top', position: [1, 2, 3] }] })).toThrowError(
      'views[0] names both preset and position, two camera directions; use one, and lookAt for the point it aims at',
    )
    expect(() => normalizeViewRequest({ views: [{ preset: 'top' }], lookAt: [1, 2, 3] })).toThrowError(/inside views/)
  })

  it('rejects triples that are not three finite numbers', () => {
    expect(() => normalizeViewRequest({ views: [{ lookAt: [1, 2] }] })).toThrowError(/three/)
    expect(() => normalizeViewRequest({ views: [{ lookAt: [1, 2, 'high'] }] })).toThrowError(/three/)
    expect(() => normalizeViewRequest({ views: [{ position: [1, 2, NaN] }] })).toThrowError(/three/)
    expect(() => normalizeViewRequest({ views: [{ lookAt: 'body' }, { lookAt: '   ' }] })).toThrowError(/part/)
  })

  it('rejects a views list that is not an array and a size that is not two positive sides', () => {
    expect(() => normalizeViewRequest({ views: 'top' })).toThrowError(/array/)
    expect(() => normalizeViewRequest({ size: 'big' })).toThrowError(/size/)
    expect(() => normalizeViewRequest({ size: { w: 0, h: 240 } })).toThrowError(/w/)
    expect(() => normalizeViewRequest({ size: { w: 320 } })).toThrowError(/h/)
  })

  it('names every violation ArgumentsError', () => {
    const cases = [
      { views: [{}, {}, {}, {}, {}] },
      { size: { w: 2000, h: 2000 } },
      { views: [{ preset: 'diagonal' }] },
      { views: [{}] },
      { views: [1] },
      { views: [{ lookAt: 'nope' }, { preset: 'top', position: [0, 0, 0] }] },
      { views: 'top' },
    ]
    for (const input of cases) {
      expect(thrown(() => normalizeViewRequest(input))?.name).toBe('ArgumentsError')
    }
  })
})

describe('viewInputSchema', () => {
  it('is derived from the same preset, view-count and size constants', () => {
    const views = viewInputSchema.properties.views
    expect(views.items.properties.preset.enum).toEqual(VIEW_PRESETS)
    expect(VIEW_PRESETS).toHaveLength(9)
    expect(VIEW_PRESETS).toContain('side')
    expect([views.minItems, views.maxItems]).toEqual([1, MAX_VIEWS])
    expect(views.items.additionalProperties).toBe(false)
    expect(viewInputSchema.properties.size.properties).toMatchObject({ w: { type: 'integer' }, h: { type: 'integer' } })
    expect(viewInputSchema.additionalProperties).toBe(false)
  })

  it('describes a lookAt as a point, a part index, or a part selector string', () => {
    expect(viewInputSchema.properties.views.items.properties.lookAt.anyOf).toEqual([
      expect.objectContaining({ type: 'array', minItems: 3, maxItems: 3 }),
      expect.objectContaining({ type: 'integer' }),
      expect.objectContaining({ type: 'string' }),
    ])
  })
})

// Kept so the constant shape the renderer consumes is pinned here too.
it('keeps the default size 640x480 with a 4-view cap', () => {
  expect(DEFAULT_VIEW_SIZE).toEqual({ w: 640, h: 480 })
  expect(MAX_VIEWS).toBe(4)
})
