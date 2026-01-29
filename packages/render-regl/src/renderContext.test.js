import { describe, expect, it, vi } from 'vitest'

import renderContext from './renderContext.js'
import renderDefaults from './renderDefaults.js'

describe('renderContext', () => {
  // Mock regl
  const createMockRegl = () => {
    const mockCommand = vi.fn()
    const regl = vi.fn((config) => {
      mockCommand._config = config
      return mockCommand
    })
    return { regl, mockCommand }
  }

  describe('command creation', () => {
    it('should create a regl command', () => {
      const { regl, mockCommand } = createMockRegl()

      const result = renderContext(regl)

      expect(regl).toHaveBeenCalled()
      expect(result).toBe(mockCommand)
    })

    it('should accept optional params', () => {
      const { regl, mockCommand } = createMockRegl()
      const fbo = { name: 'framebuffer' }

      renderContext(regl, { fbo })

      const config = mockCommand._config
      expect(config.framebuffer).toBe(fbo)
    })
  })

  describe('culling', () => {
    it('should enable backface culling by default', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      expect(config.cull.enable).toBe(true)
    })
  })

  describe('context', () => {
    it('should include lightDirection in context', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      expect(config.context.lightDirection).toEqual(renderDefaults.lightDirection)
    })
  })

  describe('uniforms', () => {
    const mockCamera = {
      view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      position: [0, 0, 10],
      near: 0.1,
      far: 1000
    }

    const mockContext = {
      lightDirection: [0.45, 0.0, 0.9] // Matches renderDefaults.lightDirection
    }

    const mockProps = {
      camera: mockCamera
    }

    it('should include camera matrix uniforms as functions', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      expect(typeof config.uniforms.view).toBe('function')
      expect(typeof config.uniforms.projection).toBe('function')
      expect(typeof config.uniforms.eye).toBe('function')
    })

    it('should return camera view from props', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      const view = config.uniforms.view(mockContext, mockProps)
      expect(view).toBe(mockCamera.view)
    })

    it('should return camera projection from props', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      const projection = config.uniforms.projection(mockContext, mockProps)
      expect(projection).toBe(mockCamera.projection)
    })

    it('should return camera position as eye', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      const eye = config.uniforms.eye(mockContext, mockProps)
      expect(eye).toBe(mockCamera.position)
    })

    it('should return camera near/far', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      expect(config.uniforms.camNear(mockContext, mockProps)).toBe(0.1)
      expect(config.uniforms.camFar(mockContext, mockProps)).toBe(1000)
    })

    it('should compute invertedView', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      const invertedView = config.uniforms.invertedView(mockContext, mockProps)
      expect(invertedView).toBeInstanceOf(Array)
      expect(invertedView.length).toBe(16)
    })

    describe('lighting uniforms', () => {
      it('should use default lightPosition', () => {
        const { regl, mockCommand } = createMockRegl()

        renderContext(regl)

        const config = mockCommand._config
        const lightPosition = config.uniforms.lightPosition(mockContext, mockProps)
        expect(lightPosition).toEqual(renderDefaults.lightPosition)
      })

      it('should use props lightPosition when provided', () => {
        const { regl, mockCommand } = createMockRegl()

        renderContext(regl)

        const config = mockCommand._config
        const customPosition = [50, 100, 50]
        const propsWithLight = {
          ...mockProps,
          rendering: { lightPosition: customPosition }
        }
        const lightPosition = config.uniforms.lightPosition(mockContext, propsWithLight)
        expect(lightPosition).toEqual(customPosition)
      })

      it('should transform lightDirection by inverse view matrix', () => {
        const { regl, mockCommand } = createMockRegl()

        renderContext(regl)

        const config = mockCommand._config
        const lightDirection = config.uniforms.lightDirection(mockContext, mockProps)
        // With identity view matrix, should return normalized default direction
        expect(lightDirection).toBeInstanceOf(Array)
        expect(lightDirection.length).toBe(3)
        // Direction should be roughly the same as default (identity transform)
        expect(lightDirection[2]).toBeGreaterThan(0) // Points toward camera
      })

      it('should use default lightColor', () => {
        const { regl, mockCommand } = createMockRegl()

        renderContext(regl)

        const config = mockCommand._config
        const lightColor = config.uniforms.lightColor(mockContext, mockProps)
        expect(lightColor).toEqual(renderDefaults.lightColor)
      })

      it('should use default ambientLightAmount', () => {
        const { regl, mockCommand } = createMockRegl()

        renderContext(regl)

        const config = mockCommand._config
        const ambient = config.uniforms.ambientLightAmount(mockContext, mockProps)
        expect(ambient).toBe(renderDefaults.ambientLightAmount)
      })

      it('should use default diffuseLightAmount', () => {
        const { regl, mockCommand } = createMockRegl()

        renderContext(regl)

        const config = mockCommand._config
        const diffuse = config.uniforms.diffuseLightAmount(mockContext, mockProps)
        expect(diffuse).toBe(renderDefaults.diffuseLightAmount)
      })

      it('should use default specularLightAmount', () => {
        const { regl, mockCommand } = createMockRegl()

        renderContext(regl)

        const config = mockCommand._config
        const specular = config.uniforms.specularLightAmount(mockContext, mockProps)
        expect(specular).toBe(renderDefaults.specularLightAmount)
      })

      it('should use default materialShininess', () => {
        const { regl, mockCommand } = createMockRegl()

        renderContext(regl)

        const config = mockCommand._config
        const shininess = config.uniforms.uMaterialShininess(mockContext, mockProps)
        expect(shininess).toBe(renderDefaults.materialShininess)
      })
    })

    it('should include material colors', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      expect(config.uniforms.materialAmbient).toBeDefined()
      expect(config.uniforms.materialDiffuse).toBeDefined()
      expect(config.uniforms.materialSpecular).toBeDefined()
    })

    it('should compute lightView matrix', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      const lightView = config.uniforms.lightView(mockContext)
      expect(lightView).toBeInstanceOf(Array)
      expect(lightView.length).toBe(16)
    })

    it('should have lightProjection as ortho matrix', () => {
      const { regl, mockCommand } = createMockRegl()

      renderContext(regl)

      const config = mockCommand._config
      expect(config.uniforms.lightProjection).toBeInstanceOf(Array)
      expect(config.uniforms.lightProjection.length).toBe(16)
    })
  })

  describe('extras', () => {
    it('should merge extra params into config', () => {
      const { regl, mockCommand } = createMockRegl()
      const extras = { depth: { enable: false } }

      renderContext(regl, { extras })

      const config = mockCommand._config
      expect(config.depth).toEqual({ enable: false })
    })
  })
})
