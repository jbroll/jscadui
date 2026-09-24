import { describe, it, expect } from 'vitest'
import { meshHash } from '@jscadui/format-common'
import { toRefs } from './meshRefs.js'

const mesh = (seed = 0) => ({
  type: 'mesh',
  vertices: new Float32Array(9).fill(seed),
  indices: new Uint16Array([0, 1, 2]),
  normals: new Float32Array(9).fill(1),
  id: 4,
})

describe('toRefs', () => {
  it('turns a held mesh into a ref with no buffers and takes its buffers off the transfer list', () => {
    const entity = mesh()
    const other = new Float32Array(3)
    const transferable = [entity.vertices, entity.indices, entity.normals, other]

    const [ref] = toRefs([entity], new Set([meshHash(entity)]), transferable)

    expect(ref).toEqual({ type: 'mesh', hash: meshHash(entity), ref: true, id: 4 })
    expect(Object.values(ref).some(v => ArrayBuffer.isView(v))).toBe(false)
    expect(transferable).toEqual([other])
  })

  it('keeps the buffers of an unheld mesh and adds its hash', () => {
    const entity = mesh()
    const transferable = [entity.vertices, entity.indices, entity.normals]

    const [out] = toRefs([entity], new Set(['0000000000000000']), transferable)

    expect(out.hash).toBe(meshHash(entity))
    expect(out.ref).toBeUndefined()
    expect(out.vertices).toBe(entity.vertices)
    expect(transferable).toHaveLength(3)
  })

  it('passes lines entities through unchanged', () => {
    const lines = { type: 'lines', vertices: new Float32Array(6) }
    const transferable = [lines.vertices]

    const [out] = toRefs([lines], new Set([meshHash(lines)]), transferable)

    expect(out).toBe(lines)
    expect(transferable).toEqual([lines.vertices])
  })

  it('keeps color, transforms and transparency on the ref', () => {
    const entity = { ...mesh(), color: [1, 0, 0, 0.5], transforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1], isTransparent: true, opacity: 0.5 }

    const [ref] = toRefs([entity], new Set([meshHash(entity)]), [])

    expect(ref).toEqual({
      type: 'mesh', hash: meshHash(entity), ref: true,
      color: entity.color, transforms: entity.transforms, isTransparent: true, opacity: 0.5, id: 4,
    })
  })

  it('leaves a shared buffer on the transfer list while an unheld entity in the batch still carries it', () => {
    const held = mesh(1)
    const unheld = { ...mesh(2), normals: held.normals }
    const transferable = [held.vertices, held.indices, held.normals, unheld.vertices, unheld.indices]

    toRefs([held, unheld], new Set([meshHash(held)]), transferable)

    expect(transferable).toEqual([held.normals, unheld.vertices, unheld.indices])
  })
})
