import { describe, it, expect } from 'vitest'
import { meshHash } from './meshHash.js'

const tri = () => ({ type: 'mesh', vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) })

describe('meshHash', () => {
  it('is 16 hex characters', () => expect(meshHash(tri())).toMatch(/^[0-9a-f]{16}$/))
  it('is equal for equal content in different buffers', () => expect(meshHash(tri())).toBe(meshHash(tri())))
  it('changes when one coordinate changes', () => {
    const b = tri()
    b.vertices[4] = 0.5
    expect(meshHash(b)).not.toBe(meshHash(tri()))
  })
  it('tells apart the same bytes in different fields', () => {
    const a = { type: 'mesh', vertices: new Float32Array([1, 2, 3]) }
    const b = { type: 'mesh', vertices: new Float32Array(0), normals: new Float32Array([1, 2, 3]) }
    expect(meshHash(a)).not.toBe(meshHash(b))
  })
  it('depends on the type', () => expect(meshHash({ ...tri(), type: 'lines' })).not.toBe(meshHash(tri())))
})
