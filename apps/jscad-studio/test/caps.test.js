import { describe, it, expect } from 'vitest'
import { capGeometry, DEFAULT_CAPS } from '../src/caps.js'

const smallEntity = () => ({
  type: 'mesh',
  vertices: new Float32Array(30), // 10 vertices
  indices: new Uint32Array(12),
})

describe('capGeometry', () => {
  it('passes entities under the limits through unchanged', () => {
    const entities = [smallEntity(), smallEntity()]
    const result = capGeometry(entities, DEFAULT_CAPS)
    expect(result).toBe(entities)
  })

  it('throws a model error when the vertex count is over the limit', () => {
    const limits = { ...DEFAULT_CAPS, vertices: 4 }
    const entities = [{ ...smallEntity(), vertices: new Float32Array(15) }] // 5 vertices
    expect(() => capGeometry(entities, limits)).toThrowError(/vertex cap/)
  })

  it('throws a model error when the total buffer size is over the limit', () => {
    const limits = { ...DEFAULT_CAPS, bytes: 1024 }
    const entities = [{ ...smallEntity(), vertices: new Float32Array(512) }] // 2048 bytes
    expect(() => capGeometry(entities, limits)).toThrowError(/buffer cap/)
  })

  it('throws a model error when the entity count is over the limit', () => {
    const limits = { ...DEFAULT_CAPS, entities: 2 }
    const entities = [smallEntity(), smallEntity(), smallEntity()]
    expect(() => capGeometry(entities, limits)).toThrowError(/entity cap/)
  })

  it('reads sizes from buffer metadata without copying', () => {
    const vertices = new Float32Array(30)
    const indices = new Uint32Array(12)
    const entities = [{ type: 'mesh', vertices, indices }]
    const result = capGeometry(entities, DEFAULT_CAPS)
    expect(result[0].vertices).toBe(vertices)
    expect(result[0].indices).toBe(indices)
  })
})