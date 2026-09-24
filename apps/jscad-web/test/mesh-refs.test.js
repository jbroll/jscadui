import { describe, it, expect } from 'vitest'
import { createMeshRefs } from '../src/meshRefs.js'

const mesh = (hash, extra = {}) => ({
  type: 'mesh',
  hash,
  vertices: new Float32Array(9),
  indices: new Uint32Array([0, 1, 2]),
  color: [1, 0, 0, 1],
  transforms: new Float32Array(16).fill(1),
  ...extra,
})

const refTo = (entity, extra = {}) => ({
  type: 'mesh',
  hash: entity.hash,
  ref: true,
  color: [...entity.color],
  transforms: new Float32Array(entity.transforms),
  ...extra,
})

describe('mesh refs', () => {
  it('resolves a ref with the same attributes to the held entity itself', () => {
    const refs = createMeshRefs()
    const held = mesh('aaaaaaaaaaaaaaaa')
    refs.remember([held])
    const [resolved] = refs.resolve([refTo(held)])
    expect(resolved).toBe(held)
  })

  it('resolves a ref with a new color to a new entity sharing the held buffers', () => {
    const refs = createMeshRefs()
    const held = mesh('aaaaaaaaaaaaaaaa', { id: 1 })
    refs.remember([held])
    const [resolved] = refs.resolve([refTo(held, { color: [0, 1, 0, 1], id: 4 })])
    expect(resolved).not.toBe(held)
    expect(resolved.vertices).toBe(held.vertices)
    expect(resolved.indices).toBe(held.indices)
    expect(resolved.color).toEqual([0, 1, 0, 1])
    expect(resolved.hash).toBe(held.hash)
    expect(resolved.id).toBe(4)
    expect(resolved.ref).toBeUndefined()
  })

  it('treats a changed transform, transparency or opacity as a new entity', () => {
    const refs = createMeshRefs()
    const held = mesh('aaaaaaaaaaaaaaaa')
    refs.remember([held])
    const moved = new Float32Array(held.transforms)
    moved[12] = 5
    const [a, b, c] = refs.resolve([
      refTo(held, { transforms: moved }),
      refTo(held, { isTransparent: true }),
      refTo(held, { opacity: 0.5 }),
    ])
    expect(a).not.toBe(held)
    expect(a.transforms).toBe(moved)
    expect(b.isTransparent).toBe(true)
    expect(c.opacity).toBe(0.5)
  })

  it('passes entities that are not refs through', () => {
    const refs = createMeshRefs()
    const entity = mesh('bbbbbbbbbbbbbbbb')
    const line = { type: 'line', vertices: new Float32Array(6) }
    const resolved = refs.resolve([entity, line])
    expect(resolved[0]).toBe(entity)
    expect(resolved[1]).toBe(line)
  })

  it('throws a model error naming an unknown hash', () => {
    const refs = createMeshRefs()
    expect(() => refs.resolve([{ type: 'mesh', hash: 'cccccccccccccccc', ref: true }]))
      .toThrow(expect.objectContaining({ name: 'ModelError', message: expect.stringContaining('cccccccccccccccc') }))
  })

  it('replaces the remembered meshes rather than adding to them', () => {
    const refs = createMeshRefs()
    const first = mesh('aaaaaaaaaaaaaaaa')
    refs.remember([first])
    refs.remember([mesh('bbbbbbbbbbbbbbbb')])
    expect(() => refs.resolve([refTo(first)])).toThrow(/aaaaaaaaaaaaaaaa/)
  })

  it('lists the remembered hashes', () => {
    const refs = createMeshRefs()
    refs.remember([mesh('aaaaaaaaaaaaaaaa'), { type: 'line', vertices: new Float32Array(6) }, mesh('bbbbbbbbbbbbbbbb')])
    expect(refs.held()).toEqual(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'])
  })

  it('forgets everything', () => {
    const refs = createMeshRefs()
    refs.remember([mesh('aaaaaaaaaaaaaaaa')])
    refs.forget()
    expect(refs.held()).toEqual([])
  })
})
