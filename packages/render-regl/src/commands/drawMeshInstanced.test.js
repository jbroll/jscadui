import { describe, expect, it, vi } from 'vitest'

import drawMeshInstanced from './drawMeshInstanced.js'

describe('drawMeshInstanced', () => {
  // Mock regl
  const createMockRegl = () => {
    const mockBuffer = { destroy: vi.fn() }
    const mockCommand = vi.fn()

    const regl = vi.fn((config) => {
      // Store config for inspection
      mockCommand._config = config
      return mockCommand
    })

    regl.buffer = vi.fn(() => mockBuffer)
    regl.prop = vi.fn((path) => `prop:${path}`)

    return { regl, mockCommand, mockBuffer }
  }

  const createBasicEntity = () => ({
    geometry: {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2])
    },
    visuals: {
      color: [1, 0, 0, 1],
      transparent: false,
      useVertexColors: false
    },
    instanceMatrices: new Float32Array(32), // 2 instances * 16 floats
    instanceCount: 2
  })

  describe('command creation', () => {
    it('should create a regl command', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()

      const result = drawMeshInstanced(regl, entity)

      expect(regl).toHaveBeenCalled()
      expect(result).toBe(mockCommand)
    })

    it('should create an instance buffer', () => {
      const { regl } = createMockRegl()
      const entity = createBasicEntity()

      drawMeshInstanced(regl, entity)

      expect(regl.buffer).toHaveBeenCalledWith({
        data: entity.instanceMatrices,
        usage: 'static'
      })
    })
  })

  describe('attributes', () => {
    it('should include position and normal attributes', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.attributes.position).toBe(entity.geometry.positions)
      expect(config.attributes.normal).toBe(entity.geometry.normals)
    })

    it('should include instance matrix attributes with correct divisor', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      const attrs = config.attributes

      // Check all 4 matrix column attributes
      expect(attrs.instanceMatrix0).toBeDefined()
      expect(attrs.instanceMatrix0.divisor).toBe(1)
      expect(attrs.instanceMatrix0.stride).toBe(64)
      expect(attrs.instanceMatrix0.offset).toBe(0)

      expect(attrs.instanceMatrix1).toBeDefined()
      expect(attrs.instanceMatrix1.divisor).toBe(1)
      expect(attrs.instanceMatrix1.stride).toBe(64)
      expect(attrs.instanceMatrix1.offset).toBe(16)

      expect(attrs.instanceMatrix2).toBeDefined()
      expect(attrs.instanceMatrix2.divisor).toBe(1)
      expect(attrs.instanceMatrix2.stride).toBe(64)
      expect(attrs.instanceMatrix2.offset).toBe(32)

      expect(attrs.instanceMatrix3).toBeDefined()
      expect(attrs.instanceMatrix3.divisor).toBe(1)
      expect(attrs.instanceMatrix3.stride).toBe(64)
      expect(attrs.instanceMatrix3.offset).toBe(48)
    })

    it('should include vcolor attribute when useVertexColors is true', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()
      entity.visuals.useVertexColors = true
      entity.geometry.colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1])

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.attributes.vcolor).toBe(entity.geometry.colors)
    })
  })

  describe('uniforms', () => {
    it('should include view and projection uniforms', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.uniforms.view).toBe('prop:camera.view')
      expect(config.uniforms.projection).toBe('prop:camera.projection')
    })

    it('should include lighting uniforms', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.uniforms.lightDirection).toBeDefined()
      expect(config.uniforms.lightColor).toBeDefined()
      expect(config.uniforms.ambientAmount).toBeDefined()
      expect(config.uniforms.diffuseAmount).toBeDefined()
      expect(config.uniforms.specularAmount).toBeDefined()
      expect(config.uniforms.shininess).toBeDefined()
    })

    it('should include color uniform for uniform-colored mesh', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.uniforms.color).toBe('prop:color')
    })

    it('should NOT include color uniform for vertex-colored mesh', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()
      entity.visuals.useVertexColors = true
      entity.geometry.colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1])

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.uniforms.color).toBeUndefined()
    })
  })

  describe('instancing', () => {
    it('should set instances count', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()
      entity.instanceCount = 5

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.instances).toBe(5)
    })
  })

  describe('geometry', () => {
    it('should use elements for indexed geometry', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.elements).toBe(entity.geometry.indices)
      expect(config.count).toBeUndefined()
    })

    it('should use count for non-indexed geometry', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()
      delete entity.geometry.indices

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.elements).toBeUndefined()
      expect(config.count).toBe(3) // 9 floats / 3 components
    })
  })

  describe('depth and culling', () => {
    it('should enable depth test', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.depth.enable).toBe(true)
      expect(config.depth.mask).toBe(true)
    })

    it('should enable back-face culling', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.cull.enable).toBe(true)
      expect(config.cull.face).toBe('back')
    })
  })

  describe('transparency', () => {
    it('should enable blending for transparent meshes', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()
      entity.visuals.transparent = true

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.blend.enable).toBe(true)
      expect(config.blend.func).toBeDefined()
    })

    it('should disable depth mask for transparent meshes', () => {
      const { regl, mockCommand } = createMockRegl()
      const entity = createBasicEntity()
      entity.visuals.transparent = true

      drawMeshInstanced(regl, entity)

      const config = mockCommand._config
      expect(config.depth.mask).toBe(false)
    })
  })
})
