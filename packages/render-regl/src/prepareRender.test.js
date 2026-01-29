import { describe, expect, it, vi } from 'vitest'

import prepareRender from './prepareRender.js'

describe('prepareRender', () => {
  // Create a mock regl instance
  const createMockRegl = () => {
    const mockContextCommand = vi.fn((_props, callback) => {
      callback({})
    })

    const regl = vi.fn((config) => {
      const cmd = vi.fn()
      cmd._config = config
      return cmd
    })

    regl.clear = vi.fn()
    regl.poll = vi.fn()
    regl.buffer = vi.fn(() => ({ destroy: vi.fn() }))
    regl.prop = vi.fn((name) => `prop:${name}`)

    // First call returns context wrapper
    regl.mockImplementationOnce((config) => {
      mockContextCommand._config = config
      return mockContextCommand
    })

    return { regl, mockContextCommand }
  }

  describe('initialization', () => {
    it('should throw error if no regl or createRegl provided', () => {
      expect(() => prepareRender({})).toThrow('prepareRender requires either params.regl or params.createRegl')
    })

    it('should accept provided regl instance', () => {
      const { regl } = createMockRegl()

      const render = prepareRender({ regl })

      expect(render).toBeDefined()
      expect(typeof render).toBe('function')
    })

    it('should use createRegl when provided', () => {
      const { regl } = createMockRegl()
      const createRegl = vi.fn(() => regl)

      const render = prepareRender({ createRegl, glOptions: { gl: {} } })

      expect(createRegl).toHaveBeenCalled()
      expect(render).toBeDefined()
    })

    it('should pass glOptions to createRegl', () => {
      const { regl } = createMockRegl()
      const createRegl = vi.fn(() => regl)
      const glOptions = { canvas: 'test-canvas' }

      prepareRender({ createRegl, glOptions })

      const callArg = createRegl.mock.calls[0][0]
      expect(callArg.canvas).toBe('test-canvas')
    })
  })

  describe('render function', () => {
    it('should return a render function', () => {
      const { regl } = createMockRegl()

      const render = prepareRender({ regl })

      expect(typeof render).toBe('function')
    })

    it('should call regl.poll on render', () => {
      const { regl } = createMockRegl()
      const render = prepareRender({ regl })

      render({
        camera: { view: [], projection: [], position: [] },
        rendering: { background: [1, 1, 1, 1] }
      })

      expect(regl.poll).toHaveBeenCalled()
    })

    it('should call regl.clear with background color', () => {
      const { regl } = createMockRegl()
      const render = prepareRender({ regl })
      const background = [0.5, 0.5, 0.5, 1]

      render({
        camera: { view: [], projection: [], position: [] },
        rendering: { background }
      })

      expect(regl.clear).toHaveBeenCalledWith({
        color: expect.any(Array),
        depth: 1
      })
    })
  })

  describe('entity rendering', () => {
    it('should process entities array', () => {
      const { regl, mockContextCommand } = createMockRegl()
      const mockDrawCmd = vi.fn()

      // Mock draw command creation
      let drawCmdCreated = false
      regl.mockImplementation((_config) => {
        if (!drawCmdCreated) {
          drawCmdCreated = true
          return mockDrawCmd
        }
        return vi.fn()
      })

      // Verify context wrapper is used
      void mockContextCommand

      const render = prepareRender({ regl })

      const entity = {
        geometry: { positions: new Float32Array([0, 0, 0]) },
        visuals: {
          show: true,
          drawCmd: 'drawMesh',
          color: [1, 0, 0, 1]
        }
      }

      render({
        camera: { view: [], projection: [], position: [] },
        rendering: { background: [1, 1, 1, 1] },
        entities: [entity]
      })

      // Context wrapper should be called
      expect(mockContextCommand).toHaveBeenCalled()
    })

    it('should skip entities with show: false', () => {
      const { regl } = createMockRegl()
      const mockDrawCmd = vi.fn()

      regl.mockImplementation(() => mockDrawCmd)

      const render = prepareRender({ regl })

      const entity = {
        geometry: { positions: new Float32Array([0, 0, 0]) },
        visuals: {
          show: false,
          drawCmd: 'drawMesh'
        }
      }

      render({
        camera: { view: [], projection: [], position: [] },
        entities: [entity]
      })

      // Draw command should not be called for hidden entities
      expect(mockDrawCmd).not.toHaveBeenCalled()
    })

    it('should skip entities without drawCmd', () => {
      const { regl } = createMockRegl()
      const mockDrawCmd = vi.fn()

      regl.mockImplementation(() => mockDrawCmd)

      const render = prepareRender({ regl })

      const entity = {
        geometry: { positions: new Float32Array([0, 0, 0]) },
        visuals: {
          show: true
          // No drawCmd
        }
      }

      render({
        camera: { view: [], projection: [], position: [] },
        entities: [entity]
      })

      expect(mockDrawCmd).not.toHaveBeenCalled()
    })
  })

  describe('draw command caching', () => {
    it('should cache draw commands', () => {
      const { regl } = createMockRegl()
      const mockDrawCmd = vi.fn()

      // After context wrapper, create draw commands
      regl.mockImplementation((_config) => {
        return mockDrawCmd
      })

      const render = prepareRender({ regl })

      const entity = {
        geometry: { positions: new Float32Array([0, 0, 0]) },
        visuals: {
          show: true,
          drawCmd: 'drawMesh',
          color: [1, 0, 0, 1]
        }
      }

      // Render twice with same entity
      render({
        camera: { view: [], projection: [], position: [] },
        entities: [entity]
      })

      render({
        camera: { view: [], projection: [], position: [] },
        entities: [entity]
      })

      // The entity should have a cacheId assigned
      expect(entity.visuals.cacheId).toBeDefined()
    })
  })

  describe('transparency sorting', () => {
    it('should sort opaque entities before transparent', () => {
      const { regl } = createMockRegl()
      const renderOrder = []

      // Track which entities get rendered
      regl.mockImplementation((_config) => {
        const cmd = vi.fn((props) => {
          renderOrder.push(props.transparent ? 'transparent' : 'opaque')
        })
        return cmd
      })

      const render = prepareRender({ regl })

      const transparentEntity = {
        geometry: { positions: new Float32Array([0, 0, 0]) },
        visuals: {
          show: true,
          drawCmd: 'drawMesh',
          transparent: true
        }
      }

      const opaqueEntity = {
        geometry: { positions: new Float32Array([0, 0, 0]) },
        visuals: {
          show: true,
          drawCmd: 'drawMesh',
          transparent: false
        }
      }

      // Add transparent first, opaque second
      render({
        camera: { view: [], projection: [], position: [] },
        entities: [transparentEntity, opaqueEntity]
      })

      // Opaque should render before transparent
      expect(renderOrder[0]).toBe('opaque')
      expect(renderOrder[1]).toBe('transparent')
    })
  })
})
