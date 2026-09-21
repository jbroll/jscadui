import { describe, it, expect } from 'vitest'
import { capGeometry, DEFAULT_CAPS } from '../src/caps.js'
import { createEvaluate } from '../src/aiEvaluate.js'

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

describe('agent evaluate', () => {
  const apiReturning = (entities) => ({
    jscadSetFiles: async () => {},
    jscadScript: async () => ({ entities }),
  })

  it('reports an over-cap result as a failure to the agent', async () => {
    const drawn = []
    const entities = Array.from({ length: DEFAULT_CAPS.entities + 1 }, smallEntity)
    const evaluate = createEvaluate(apiReturning(entities), (result) => drawn.push(result))

    const result = await evaluate('module.exports = { main: () => [] }')

    expect(result.ok).toBe(false)
    expect(result.error.message).toMatch(/entity cap/)
    expect(result.entityCount).toBeUndefined()
    expect(drawn.length).toBe(1)
  })

  it('reports the entity count when the result is under the caps', async () => {
    const evaluate = createEvaluate(apiReturning([smallEntity()]), () => {})

    expect(await evaluate('module.exports = { main: () => [] }')).toEqual({ entityCount: 1 })
  })

  it('turns a frame rejection into a failure result', async () => {
    const error = Object.assign(new Error('boom'), { name: 'ModelError' })
    const evaluate = createEvaluate({
      jscadSetFiles: async () => {},
      jscadScript: async () => { throw error },
    }, () => {})

    expect(await evaluate('module.exports = {}')).toEqual({
      ok: false,
      error: { name: 'ModelError', message: 'boom' },
    })
  })
})
