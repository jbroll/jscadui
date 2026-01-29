import { describe, expect, it } from 'vitest'

import { CommonToRegl, toCreasedNormals, createDefaultNormals, ensureRGBAColors } from './index.js'

describe('CommonToRegl', () => {
  describe('basic conversion', () => {
    it('should convert a simple mesh to regl format', () => {
      const converter = CommonToRegl()
      const mesh = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
      }
      const meshColor = [1, 0, 0, 1]

      const result = converter(mesh, {}, meshColor)

      expect(result).toBeDefined()
      expect(result.geometry).toBeDefined()
      expect(result.geometry.positions).toBe(mesh.vertices)
      expect(result.geometry.normals).toBe(mesh.normals)
      expect(result.geometry.indices).toBe(mesh.indices)
      expect(result.visuals.drawCmd).toBe('drawMesh')
    })

    it('should convert lines geometry', () => {
      const converter = CommonToRegl()
      const lines = {
        type: 'lines',
        vertices: new Float32Array([0, 0, 0, 1, 1, 1]),
        color: [1, 0, 0, 1]
      }

      const result = converter(lines, {}, [1, 1, 1, 1])

      expect(result.visuals.drawCmd).toBe('drawLines')
      expect(result.geometry.indices).toBeDefined()
      expect(result.geometry.indices.length).toBe(2) // 2 vertices
    })

    it('should create default normals when not provided', () => {
      const converter = CommonToRegl()
      const mesh = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2])
      }

      const result = converter(mesh, {}, [1, 1, 1, 1])

      expect(result.geometry.normals).toBeDefined()
      expect(result.geometry.normals.length).toBe(9) // 3 vertices * 3 components
    })

    it('should preserve mesh color', () => {
      const converter = CommonToRegl()
      const mesh = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        color: [0.5, 0.5, 0.5, 1]
      }

      const result = converter(mesh, {}, [1, 0, 0, 1])

      expect(result.visuals.color).toEqual([0.5, 0.5, 0.5, 1])
    })

    it('should use mesh color from parameter when not set on object', () => {
      const converter = CommonToRegl()
      const mesh = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2])
      }
      const meshColor = [1, 0, 0, 1]

      const result = converter(mesh, {}, meshColor)

      expect(result.visuals.color).toEqual(meshColor)
    })

    it('should detect transparency from alpha channel', () => {
      const converter = CommonToRegl()
      const mesh = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        color: [1, 0, 0, 0.5] // Alpha < 1
      }

      const result = converter(mesh, {}, [1, 1, 1, 1])

      expect(result.transparent).toBe(true)
      expect(result.visuals.transparent).toBe(true)
    })

    it('should handle isTransparent flag', () => {
      const converter = CommonToRegl()
      const mesh = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        color: [1, 0, 0, 1],
        isTransparent: true
      }

      const result = converter(mesh, {}, [1, 1, 1, 1])

      expect(result.transparent).toBe(true)
    })
  })

  describe('vertex colors', () => {
    it('should handle vertex colors', () => {
      const converter = CommonToRegl()
      const mesh = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        colors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) // RGB
      }

      const result = converter(mesh, {}, [1, 1, 1, 1])

      expect(result.visuals.useVertexColors).toBe(true)
      expect(result.geometry.colors).toBeDefined()
      // Should be converted to RGBA (4 components per vertex)
      expect(result.geometry.colors.length).toBe(12) // 3 vertices * 4 components
    })
  })

  describe('smooth shading', () => {
    it('should apply smooth shading when enabled', () => {
      const converter = CommonToRegl({ smooth: true })
      // Simple triangle
      const mesh = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
      }

      const result = converter(mesh, {}, [1, 1, 1, 1])

      // After smooth shading, geometry becomes non-indexed
      expect(result.geometry.indices).toBeUndefined()
      // Vertices are expanded (3 indices * 3 components = 9)
      expect(result.geometry.positions.length).toBe(9)
      expect(result.geometry.normals.length).toBe(9)
    })

    it('should not apply smooth shading when disabled', () => {
      const converter = CommonToRegl({ smooth: false })
      const mesh = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
      }

      const result = converter(mesh, {}, [1, 1, 1, 1])

      // Should preserve indices
      expect(result.geometry.indices).toBeDefined()
      expect(result.geometry.indices.length).toBe(3)
    })

    it('should not apply smooth shading to lines', () => {
      const converter = CommonToRegl({ smooth: true })
      const lines = {
        type: 'lines',
        vertices: new Float32Array([0, 0, 0, 1, 1, 1]),
        indices: new Uint16Array([0, 1])
      }

      const result = converter(lines, {}, [1, 1, 1, 1])

      // Lines should keep their indices
      expect(result.geometry.indices).toBeDefined()
    })
  })

  describe('transforms', () => {
    it('should preserve transforms', () => {
      const converter = CommonToRegl()
      const transforms = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]
      const mesh = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        transforms
      }

      const result = converter(mesh, {}, [1, 1, 1, 1])

      expect(result.geometry.transforms).toBe(transforms)
    })
  })
})

describe('instance support', () => {
  it('should handle instance geometry', () => {
    const converter = CommonToRegl()
    const instance = {
      type: 'instance',
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      list: [
        { transforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        { transforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1] }
      ]
    }

    const result = converter(instance, {}, [1, 1, 1, 1])

    expect(result).not.toBeNull()
    expect(result.visuals.drawCmd).toBe('drawMeshInstanced')
    expect(result.instanceCount).toBe(2)
    expect(result.instanceMatrices).toBeInstanceOf(Float32Array)
    expect(result.instanceMatrices.length).toBe(32) // 2 instances * 16 floats
  })

  it('should use identity matrix for instances without transforms', () => {
    const converter = CommonToRegl()
    const instance = {
      type: 'instance',
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
      list: [{}] // No transforms
    }

    const result = converter(instance, {}, [1, 1, 1, 1])

    // Check identity matrix values
    const m = result.instanceMatrices
    expect(m[0]).toBe(1)
    expect(m[5]).toBe(1)
    expect(m[10]).toBe(1)
    expect(m[15]).toBe(1)
    // Off-diagonal should be 0
    expect(m[1]).toBe(0)
    expect(m[4]).toBe(0)
  })

  it('should return null for instance without list', () => {
    const converter = CommonToRegl()
    const instance = {
      type: 'instance',
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
      // Missing list
    }

    const result = converter(instance, {}, [1, 1, 1, 1])

    expect(result).toBeNull()
  })
})

describe('toCreasedNormals', () => {
  it('should compute smooth normals for a simple triangle', () => {
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const indices = new Uint16Array([0, 1, 2])
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])

    const result = toCreasedNormals(vertices, indices, normals)

    expect(result.vertices).toBeInstanceOf(Float32Array)
    expect(result.normals).toBeInstanceOf(Float32Array)
    expect(result.vertices.length).toBe(9) // 3 vertices * 3 components
    expect(result.normals.length).toBe(9)
  })

  it('should expand indexed geometry to non-indexed', () => {
    // Square made of 2 triangles sharing 2 vertices
    const vertices = new Float32Array([
      0, 0, 0, // 0
      1, 0, 0, // 1
      1, 1, 0, // 2
      0, 1, 0  // 3
    ])
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3])

    const result = toCreasedNormals(vertices, indices, null)

    // Should expand to 6 vertices (2 triangles * 3 vertices)
    expect(result.vertices.length).toBe(18) // 6 vertices * 3 components
    expect(result.normals.length).toBe(18)
  })

  it('should produce normalized normals', () => {
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const indices = new Uint16Array([0, 1, 2])

    const result = toCreasedNormals(vertices, indices, null)

    // Check that each normal is unit length
    for (let i = 0; i < result.normals.length; i += 3) {
      const x = result.normals[i]
      const y = result.normals[i + 1]
      const z = result.normals[i + 2]
      const length = Math.sqrt(x * x + y * y + z * z)
      expect(length).toBeCloseTo(1, 5)
    }
  })
})

describe('createDefaultNormals', () => {
  it('should create up-facing normals', () => {
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])

    const normals = createDefaultNormals(vertices)

    expect(normals).toBeInstanceOf(Float32Array)
    expect(normals.length).toBe(9) // 3 vertices * 3 components

    // All normals should point up (0, 0, 1)
    for (let i = 0; i < normals.length; i += 3) {
      expect(normals[i]).toBe(0)
      expect(normals[i + 1]).toBe(0)
      expect(normals[i + 2]).toBe(1)
    }
  })
})

describe('ensureRGBAColors', () => {
  it('should pass through RGBA colors unchanged', () => {
    const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1])

    const result = ensureRGBAColors(colors, 3)

    expect(result).toBe(colors)
  })

  it('should convert RGB to RGBA', () => {
    const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])

    const result = ensureRGBAColors(colors, 3)

    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(12) // 3 vertices * 4 components

    // Check first vertex (red)
    expect(result[0]).toBe(1)
    expect(result[1]).toBe(0)
    expect(result[2]).toBe(0)
    expect(result[3]).toBe(1) // Alpha

    // Check second vertex (green)
    expect(result[4]).toBe(0)
    expect(result[5]).toBe(1)
    expect(result[6]).toBe(0)
    expect(result[7]).toBe(1) // Alpha
  })

  it('should fill missing colors with white', () => {
    const colors = new Float32Array([1, 0, 0]) // Only 1 vertex color

    const result = ensureRGBAColors(colors, 3) // 3 vertices needed

    expect(result.length).toBe(12)

    // First vertex - red from input
    expect(result[0]).toBe(1)
    expect(result[1]).toBe(0)
    expect(result[2]).toBe(0)
    expect(result[3]).toBe(1)

    // Second vertex - white (default)
    expect(result[4]).toBe(1)
    expect(result[5]).toBe(1)
    expect(result[6]).toBe(1)
    expect(result[7]).toBe(1)
  })
})
