import { describe, it, expect } from 'vitest'
import { CommonToThree } from './index.js'

class Material { constructor(params = {}) { Object.assign(this, params) } }
class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null }
  setAttribute(name, attr) { this.attributes[name] = attr }
  setIndex(attr) { this.index = attr }
}
class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize } }
class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material } applyMatrix4() {} }
class Color { constructor(r, g, b) { Object.assign(this, { r, g, b }) } }

const convert = CommonToThree({
  MeshPhongMaterial: Material, LineBasicMaterial: Material, BufferGeometry, BufferAttribute,
  Mesh, InstancedMesh: Mesh, Line: Mesh, LineSegments: Mesh, Color, Vector3: class {}, Matrix4: class { fromArray() {} },
})

const tri = { type: 'mesh', vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) }

describe('CommonToThree mesh shading', () => {
  it('shades a mesh with no normals flat on the GPU', () => {
    const mesh = convert(tri, {})
    expect(mesh.material.flatShading).toBe(true)
    expect(mesh.geometry.attributes.normal).toBeUndefined()
  })

  it('keeps the smooth-capable material when normals are given', () => {
    const mesh = convert({ ...tri, normals: new Float32Array(9) }, {})
    expect(mesh.material.flatShading).toBe(false)
  })

  it('shades a colored mesh with no normals flat too', () => {
    expect(convert({ ...tri, color: [1, 0, 0, 1] }, {}).material.flatShading).toBe(true)
  })

  it('keeps flat shading after the default color changes', () => {
    convert.setDefColor([0, 1, 0])
    expect(convert(tri, {}).material.flatShading).toBe(true)
  })
})
