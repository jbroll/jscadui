import { describe, it, expect } from 'vitest'
import modeling from '@jscad/modeling'
import { toRenderParts } from '../src/triangles.js'

describe('toRenderParts', () => {
  it('turns a cube into 12 triangles', () => {
    const [part] = toRenderParts(modeling.primitives.cube({ size: 2 }), { jscadModeling: modeling })
    expect(part.positions.length).toBe(12 * 9)
  })

  it('keeps one part per geometry with its colour', () => {
    const red = modeling.colors.colorize([1, 0, 0], modeling.primitives.cube())
    const parts = toRenderParts([red, modeling.primitives.cube()], { jscadModeling: modeling })
    expect(parts).toHaveLength(2)
    expect(parts[0].color.slice(0, 3)).toEqual([1, 0, 0])
  })

  it('flattens a nested array and drops previewOnly ghosts', () => {
    const cube = modeling.primitives.cube({ size: 2 })
    const sphere = modeling.primitives.sphere()
    const parts = toRenderParts([[cube, sphere], { previewOnly: true }], { jscadModeling: modeling })
    expect(parts).toHaveLength(2)
    expect(parts.every((p) => p.positions.length > 0)).toBe(true)
  })
})
