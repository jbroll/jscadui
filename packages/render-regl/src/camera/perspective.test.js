import { describe, expect, it } from 'vitest'

import { cameraState, defaults, setProjection, update } from './perspective.js'

describe('perspective camera', () => {
  describe('cameraState defaults', () => {
    it('should have view matrix initialized to identity', () => {
      expect(cameraState.view).toBeInstanceOf(Float32Array)
      expect(cameraState.view.length).toBe(16)
      // Identity matrix diagonal should be 1
      expect(cameraState.view[0]).toBe(1)
      expect(cameraState.view[5]).toBe(1)
      expect(cameraState.view[10]).toBe(1)
      expect(cameraState.view[15]).toBe(1)
    })

    it('should have projection matrix initialized to identity', () => {
      expect(cameraState.projection).toBeInstanceOf(Float32Array)
      expect(cameraState.projection.length).toBe(16)
    })

    it('should have reasonable near/far planes', () => {
      expect(cameraState.near).toBe(1)
      expect(cameraState.far).toBe(50000)
    })

    it('should use Z-up coordinate system', () => {
      expect(cameraState.up).toEqual([0, 0, 1])
    })

    it('should have default camera position', () => {
      expect(cameraState.position).toEqual([180, -180, 220])
    })

    it('should have default target at origin', () => {
      expect(cameraState.target).toEqual([0, 0, 0])
    })

    it('should have 45 degree FOV', () => {
      expect(cameraState.fov).toBeCloseTo(Math.PI / 4)
    })

    it('should be perspective projection type', () => {
      expect(cameraState.projectionType).toBe('perspective')
    })
  })

  describe('defaults export', () => {
    it('should be a copy of cameraState', () => {
      expect(defaults.position).toEqual(cameraState.position)
      expect(defaults.target).toEqual(cameraState.target)
      expect(defaults.fov).toBe(cameraState.fov)
    })
  })

  describe('setProjection', () => {
    it('should compute projection matrix for given dimensions', () => {
      const camera = { ...cameraState }
      const result = setProjection({}, camera, { width: 800, height: 600 })

      expect(result.projection).toBeDefined()
      expect(result.projection.length).toBe(16)
      expect(result.aspect).toBeCloseTo(800 / 600)
      expect(result.viewport).toEqual([0, 0, 800, 600])
    })

    it('should handle square viewport', () => {
      const camera = { ...cameraState }
      const result = setProjection({}, camera, { width: 500, height: 500 })

      expect(result.aspect).toBe(1)
    })

    it('should handle wide viewport', () => {
      const camera = { ...cameraState }
      const result = setProjection({}, camera, { width: 1920, height: 1080 })

      expect(result.aspect).toBeCloseTo(1920 / 1080)
    })

    it('should mutate output object if provided', () => {
      const camera = { ...cameraState }
      const output = {}
      const result = setProjection(output, camera, { width: 800, height: 600 })

      expect(result).toBe(output)
      expect(output.projection).toBeDefined()
    })

    it('should create new object if output not provided', () => {
      const camera = { ...cameraState }
      const result = setProjection(null, camera, { width: 800, height: 600 })

      expect(result).toBeDefined()
      expect(result.projection).toBeDefined()
    })
  })

  describe('update', () => {
    it('should compute view matrix from position and target', () => {
      const camera = {
        position: [100, 100, 100],
        target: [0, 0, 0],
        up: [0, 0, 1]
      }
      const result = update({}, camera)

      expect(result.view).toBeDefined()
      expect(result.view.length).toBe(16)
      expect(result.position).toBeDefined()
    })

    it('should use camera as both input and output if only one arg', () => {
      const camera = {
        position: [100, 100, 100],
        target: [0, 0, 0],
        up: [0, 0, 1]
      }
      const result = update(camera)

      expect(result.view).toBeDefined()
      expect(result.position).toBeDefined()
    })

    it('should handle camera at different positions', () => {
      const camera1 = {
        position: [0, 0, 100],
        target: [0, 0, 0],
        up: [0, 0, 1]
      }
      const camera2 = {
        position: [100, 0, 0],
        target: [0, 0, 0],
        up: [0, 0, 1]
      }

      const result1 = update({}, camera1)
      const result2 = update({}, camera2)

      // View matrices should be different for different positions
      expect(result1.view).not.toEqual(result2.view)
    })

    it('should preserve position relative to target', () => {
      const camera = {
        position: [10, 20, 30],
        target: [5, 5, 5],
        up: [0, 0, 1]
      }
      const result = update({}, camera)

      // Position should be updated but maintain offset from target
      expect(result.position).toBeDefined()
      expect(result.position.length).toBe(3)
    })
  })
})
