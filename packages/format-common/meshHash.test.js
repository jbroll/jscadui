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
  it('hashes an unaligned odd-length view by its bytes and tells a one-byte change', () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => i * 7)
    const view = (buffer) => new Uint8Array(buffer, 3, 29)
    const a = { type: 'mesh', vertices: view(bytes.slice().buffer) }
    const b = { type: 'mesh', vertices: new Uint8Array(view(bytes.slice().buffer)) }
    expect(meshHash(a)).toBe(meshHash(b))
    for (const at of [0, 27, 28]) {
      const changed = bytes.slice()
      changed[3 + at] ^= 1
      expect(meshHash({ type: 'mesh', vertices: view(changed.buffer) })).not.toBe(meshHash(a))
    }
  })
  it('hashes the same bytes the same whether or not the view is 4-aligned', () => {
    const aligned = new Uint8Array(12).fill(5)
    const unaligned = new Uint8Array(new ArrayBuffer(13), 1, 12).fill(5)
    expect(meshHash({ type: 'mesh', vertices: unaligned })).toBe(meshHash({ type: 'mesh', vertices: aligned }))
  })
  it('depends on the type', () => expect(meshHash({ ...tri(), type: 'lines' })).not.toBe(meshHash(tri())))
})
