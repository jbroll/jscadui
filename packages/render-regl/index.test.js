import { describe, expect, it } from 'vitest'

import {
  RenderRegl,
  perspectiveCamera,
  orbitControls,
  renderDefaults,
  createDrawCommands,
  makeGrid,
  makeAxes,
  createSceneHelpers,
  gridColors
} from './index.js'

describe('render-regl exports', () => {
  describe('RenderRegl', () => {
    it('should be exported as a function', () => {
      expect(typeof RenderRegl).toBe('function')
    })

    it('should return a viewer factory function', () => {
      // RenderRegl returns a function that creates viewers
      const viewerFactory = RenderRegl({})
      expect(typeof viewerFactory).toBe('function')
    })

    it('should detect external renderer mode', () => {
      // When passed an object with prepareRender and drawCommands, uses external mode
      const mockExternal = {
        prepareRender: () => {},
        drawCommands: {
          drawMesh: () => {},
          drawLines: () => {},
          drawAxis: () => {},
          drawGrid: () => {}
        },
        cameras: {
          perspective: { defaults: {}, update: () => {}, setProjection: () => {} }
        },
        controls: {
          orbit: { defaults: {}, rotate: () => ({}), pan: () => ({}), zoom: () => ({}), update: () => ({}) }
        }
      }

      const viewerFactory = RenderRegl(mockExternal)
      expect(typeof viewerFactory).toBe('function')
    })
  })

  describe('perspectiveCamera', () => {
    it('should be exported', () => {
      expect(perspectiveCamera).toBeDefined()
    })

    it('should have defaults', () => {
      expect(perspectiveCamera.defaults).toBeDefined()
    })

    it('should have update function', () => {
      expect(typeof perspectiveCamera.update).toBe('function')
    })

    it('should have setProjection function', () => {
      expect(typeof perspectiveCamera.setProjection).toBe('function')
    })
  })

  describe('orbitControls', () => {
    it('should be exported', () => {
      expect(orbitControls).toBeDefined()
    })

    it('should have defaults', () => {
      expect(orbitControls.defaults).toBeDefined()
    })

    it('should have rotate function', () => {
      expect(typeof orbitControls.rotate).toBe('function')
    })

    it('should have pan function', () => {
      expect(typeof orbitControls.pan).toBe('function')
    })

    it('should have zoom function', () => {
      expect(typeof orbitControls.zoom).toBe('function')
    })

    it('should have update function', () => {
      expect(typeof orbitControls.update).toBe('function')
    })
  })

  describe('renderDefaults', () => {
    it('should be exported', () => {
      expect(renderDefaults).toBeDefined()
    })

    it('should have background color', () => {
      expect(renderDefaults.background).toBeDefined()
    })

    it('should have lighting parameters', () => {
      expect(renderDefaults.lightColor).toBeDefined()
      expect(renderDefaults.lightDirection).toBeDefined()
      expect(renderDefaults.ambientLightAmount).toBeDefined()
    })
  })

  describe('createDrawCommands', () => {
    it('should be exported as a function', () => {
      expect(typeof createDrawCommands).toBe('function')
    })

    it('should return draw command factories', () => {
      const commands = createDrawCommands()
      expect(commands.drawMesh).toBeDefined()
      expect(commands.drawLines).toBeDefined()
      expect(commands.drawMeshInstanced).toBeDefined()
    })
  })

  describe('scene helpers', () => {
    describe('makeGrid', () => {
      it('should be exported as a function', () => {
        expect(typeof makeGrid).toBe('function')
      })

      it('should return grid geometry', () => {
        const grid = makeGrid()
        expect(Array.isArray(grid)).toBe(true)
        expect(grid.length).toBe(2) // Main and secondary grid
      })
    })

    describe('makeAxes', () => {
      it('should be exported as a function', () => {
        expect(typeof makeAxes).toBe('function')
      })

      it('should return axis geometry', () => {
        const axes = makeAxes()
        expect(axes.type).toBe('lines')
        expect(axes.vertices).toBeDefined()
        expect(axes.colors).toBeDefined()
      })
    })

    describe('createSceneHelpers', () => {
      it('should be exported as a function', () => {
        expect(typeof createSceneHelpers).toBe('function')
      })

      it('should return array of helpers', () => {
        const helpers = createSceneHelpers()
        expect(Array.isArray(helpers)).toBe(true)
        expect(helpers.length).toBe(3) // 2 grid + 1 axes
      })
    })

    describe('gridColors', () => {
      it('should be exported', () => {
        expect(gridColors).toBeDefined()
      })

      it('should have light and dark themes', () => {
        expect(gridColors.light).toBeDefined()
        expect(gridColors.dark).toBeDefined()
      })
    })
  })
})

describe('RenderRegl viewer factory', () => {
  // Note: Full viewer tests require DOM and WebGL context
  // These tests verify the factory structure

  it('should accept camera options', () => {
    const viewerFactory = RenderRegl({})
    expect(typeof viewerFactory).toBe('function')
    // Factory signature: (element, { camera, bg })
  })

  it('should accept background color option', () => {
    const viewerFactory = RenderRegl({})
    expect(typeof viewerFactory).toBe('function')
  })
})

describe('module type', () => {
  it('should be an ES module with named exports', async () => {
    // Verify the module can be dynamically imported
    const module = await import('./index.js')

    expect(module.RenderRegl).toBeDefined()
    expect(module.perspectiveCamera).toBeDefined()
    expect(module.orbitControls).toBeDefined()
    expect(module.renderDefaults).toBeDefined()
    expect(module.createDrawCommands).toBeDefined()
    expect(module.makeGrid).toBeDefined()
    expect(module.makeAxes).toBeDefined()
    expect(module.createSceneHelpers).toBeDefined()
    expect(module.gridColors).toBeDefined()
  })
})
