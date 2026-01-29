import { describe, expect, it, vi } from 'vitest'

import drawLines from './drawLines.js'

// Mock regl instance
const createMockRegl = () => {
  const mockCommand = vi.fn()
  const mockRegl = vi.fn(() => mockCommand)
  mockRegl.buffer = vi.fn((opts) => ({ type: 'buffer', data: opts.data }))
  mockRegl.elements = vi.fn((opts) => ({ type: 'elements', data: opts.data }))
  return { mockRegl, mockCommand }
}

describe('drawLines', () => {
  describe('command creation', () => {
    it('should create a regl command', () => {
      const { mockRegl, mockCommand } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0])
      }

      const result = drawLines(mockRegl, { geometry })

      expect(mockRegl).toHaveBeenCalled()
      expect(result).toBe(mockCommand)
    })

    it('should pass lines primitive', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0])
      }

      drawLines(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.primitive).toBe('lines')
    })

    it('should create position buffer', () => {
      const { mockRegl } = createMockRegl()
      const positions = new Float32Array([0, 0, 0, 1, 0, 0])
      const geometry = { positions }

      drawLines(mockRegl, { geometry })

      expect(mockRegl.buffer).toHaveBeenCalledWith({
        usage: 'static',
        type: 'float',
        data: positions
      })
    })
  })

  describe('color handling', () => {
    it('should use geometry color if provided', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        color: [1, 0, 0, 1]
      }

      drawLines(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      // The ucolor uniform should use the geometry color
      expect(commandParams.uniforms.ucolor).toBeDefined()
    })

    it('should create color buffer when vertex colors provided', () => {
      const { mockRegl } = createMockRegl()
      const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1])
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        colors
      }

      drawLines(mockRegl, { geometry })

      // buffer should be called twice: positions and colors
      expect(mockRegl.buffer).toHaveBeenCalledTimes(2)
    })
  })

  describe('index handling', () => {
    it('should create elements for indexed lines', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 1, 2])
      }

      drawLines(mockRegl, { geometry })

      expect(mockRegl.elements).toHaveBeenCalled()
    })

    it('should use count for non-indexed lines', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0]) // 2 vertices
      }

      drawLines(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.count).toBe(2) // 6 floats / 3 = 2 vertices
    })
  })

  describe('transparency handling', () => {
    it('should enable blending for transparent lines', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0])
      }

      drawLines(mockRegl, { geometry, transparent: true })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.blend).toBeDefined()
      expect(commandParams.blend.enable).toBe(true)
    })

    it('should use alpha blending function', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0])
      }

      drawLines(mockRegl, { geometry, transparent: true })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.blend.func.src).toBe('src alpha')
      expect(commandParams.blend.func.dst).toBe('one minus src alpha')
    })
  })

  describe('culling', () => {
    it('should disable culling for lines', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0])
      }

      drawLines(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.cull.enable).toBe(false)
    })
  })

  describe('depth', () => {
    it('should enable depth testing', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0])
      }

      drawLines(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.depth.enable).toBe(true)
    })

    it('should disable depth mask for transparent lines', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0])
      }

      drawLines(mockRegl, { geometry, transparent: true })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.depth.mask).toBe(false)
    })
  })

  describe('uniforms', () => {
    it('should define model uniform', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0])
      }

      drawLines(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.uniforms.model).toBeDefined()
    })

    it('should define ucolor uniform', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0])
      }

      drawLines(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      expect(commandParams.uniforms.ucolor).toBeDefined()
    })
  })

  describe('shader selection', () => {
    it('should use flat color shader for simple lines', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0])
      }

      drawLines(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      // Flat color shader should just output ucolor
      expect(commandParams.frag).toContain('ucolor')
    })

    it('should use vertex color shader when colors provided', () => {
      const { mockRegl } = createMockRegl()
      const geometry = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1])
      }

      drawLines(mockRegl, { geometry })

      const commandParams = mockRegl.mock.calls[0][0]
      // Vertex color shader should have vColor
      expect(commandParams.vert).toContain('vColor')
    })
  })
})
