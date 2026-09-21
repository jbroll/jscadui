import { describe, it, expect } from 'vitest'
import { collectBuffers } from '../src_frame/collectBuffers.js'

describe('collectBuffers', () => {
  it('collects the buffer behind a typed array', () => {
    const vertices = new Float32Array(6)
    expect(collectBuffers({ entities: [{ vertices }] })).toEqual([vertices.buffer])
  })

  it('collects a bare ArrayBuffer, the shape jscadExportData returns', () => {
    const data = [new ArrayBuffer(8), new ArrayBuffer(4)]
    expect(collectBuffers({ method: '__RESPONSE__', params: { data } })).toEqual(data)
  })

  it('collects each buffer once', () => {
    const vertices = new Float32Array(6)
    const shared = new Uint8Array(vertices.buffer)
    expect(collectBuffers({ a: vertices, b: shared, c: vertices })).toEqual([vertices.buffer])
  })

  it('walks a cycle without recursing forever', () => {
    const node = { vertices: new Float32Array(3) }
    node.self = node
    expect(collectBuffers(node)).toEqual([node.vertices.buffer])
  })
})
