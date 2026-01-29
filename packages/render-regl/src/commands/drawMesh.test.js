import { describe, expect, it, vi } from 'vitest'

import drawMesh from './drawMesh.js'

// Mock regl instance
const createMockRegl = () => {
  const mockCommand = vi.fn()
  const mockRegl = vi.fn(() => mockCommand)
  mockRegl.buffer = vi.fn((opts) => ({ type: 'buffer', data: opts.data }))
  mockRegl.elements = vi.fn((opts) => ({ type: 'elements', data: opts.data }))
  return { mockRegl, mockCommand }
}

describe('drawMesh', () => {
  describe('command creation', () => {
    it('should create a regl command', () => {
      const { mockRegl, mockCommand } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint16Array([0, 1, 2])
      }

      const result = drawMesh(mockRegl, { geometry })

      expect(mockRegl).toHaveBeenCalled()
      expect(result).toBe(mockCommand)
    })

    it('should pass triangles primitive', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
      }

      drawMesh(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.primitive).toBe('triangles')
    })

    it('should create position buffer', () => {
      const { mockRegl } = createMockRegl()
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
      const geometry = { positions }

      drawMesh(mockRegl, { geometry })

      expect(mockRegl.buffer).toHaveBeenCalledWith({
        usage: 'static',
        type: 'float',
        data: positions
      })
    })

    it('should create normal buffer when normals provided', () => {
      const { mockRegl } = createMockRegl()
      const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals
      }

      drawMesh(mockRegl, { geometry })

      // buffer should be called twice: once for positions, once for normals
      expect(mockRegl.buffer).toHaveBeenCalledTimes(2)
    })

    it('should create color buffer when vertex colors provided', () => {
      const { mockRegl } = createMockRegl()
      const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1])
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        colors
      }

      drawMesh(mockRegl, { geometry, useVertexColors: true })

      // buffer should be called 3 times: positions, normals, colors
      expect(mockRegl.buffer).toHaveBeenCalledTimes(3)
    })
  })

  describe('index buffer handling', () => {
    it('should create Uint16 elements for small meshes', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2])
      }

      drawMesh(mockRegl, { geometry })

      expect(mockRegl.elements).toHaveBeenCalledWith({
        usage: 'static',
        type: 'uint16',
        data: geometry.indices
      })
    })

    it('should create Uint32 elements for large meshes', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2])
      }

      drawMesh(mockRegl, { geometry })

      expect(mockRegl.elements).toHaveBeenCalledWith({
        usage: 'static',
        type: 'uint32',
        data: geometry.indices
      })
    })

    it('should use count for non-indexed geometry', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) // 3 vertices
      }

      drawMesh(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.count).toBe(3) // 9 floats / 3 = 3 vertices
    })
  })

  describe('transparency handling', () => {
    it('should enable blending for transparent meshes', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
      }

      drawMesh(mockRegl, { geometry, visuals: { transparent: true } })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.blend).toBeDefined()
      expect(commandParams.blend.enable).toBe(true)
    })

    it('should not enable blending for opaque meshes', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
      }

      drawMesh(mockRegl, { geometry, visuals: { transparent: false } })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.blend).toBeUndefined()
    })

    it('should disable depth mask for transparent meshes', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
      }

      drawMesh(mockRegl, { geometry, visuals: { transparent: true } })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.depth.mask).toBe(false)
    })
  })

  describe('culling', () => {
    it('should enable backface culling by default', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
      }

      drawMesh(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.cull.enable).toBe(true)
      expect(commandParams.cull.face).toBe('back')
    })
  })

  describe('uniforms', () => {
    it('should define model uniform', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
      }

      drawMesh(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.uniforms.model).toBeDefined()
    })

    it('should define ucolor uniform', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
      }

      drawMesh(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.uniforms.ucolor).toBeDefined()
    })
  })

  describe('shader selection', () => {
    it('should use vertex color shaders when colors provided', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1])
      }

      drawMesh(mockRegl, { geometry, useVertexColors: true })

      const commandParams = mockRegl.mock.calls[0][0]
      // Vertex color shaders should have vColor varying
      expect(commandParams.vert).toContain('vColor')
      expect(commandParams.frag).toContain('vColor')
    })

    it('should use standard shaders when no colors', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
      }

      drawMesh(mockRegl, { geometry, useVertexColors: false })

      const commandParams = mockRegl.mock.calls[0][0]
      // Standard shaders should not have vColor
      expect(commandParams.vert).not.toContain('attribute vec4 color')
    })
  })
})
