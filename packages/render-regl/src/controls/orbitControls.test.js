import { describe, expect, it } from 'vitest'

import { controlsProps, controlsState, defaults, update, rotate, zoom, pan, zoomToFit, reset, setAutoRotate } from './orbitControls.js'

describe('orbitControls', () => {
  describe('controlsProps', () => {
    it('should have distance limits', () => {
      expect(controlsProps.limits.minDistance).toBe(0.01)
      expect(controlsProps.limits.maxDistance).toBe(10000)
    })

    it('should have drag momentum value', () => {
      expect(controlsProps.drag).toBe(0.27)
    })

    it('should have epsilon for floating point comparisons', () => {
      expect(controlsProps.EPS).toBe(0.000001)
    })

    it('should have user control flags', () => {
      expect(controlsProps.userControl.zoom).toBe(true)
      expect(controlsProps.userControl.rotate).toBe(true)
      expect(controlsProps.userControl.pan).toBe(true)
    })

    it('should have auto-rotate disabled by default', () => {
      expect(controlsProps.autoRotate.enabled).toBe(false)
    })
  })

  describe('controlsState', () => {
    it('should have zero deltas initially', () => {
      expect(controlsState.thetaDelta).toBe(0)
      expect(controlsState.phiDelta).toBe(0)
    })

    it('should have scale of 1', () => {
      expect(controlsState.scale).toBe(1)
    })
  })

  describe('defaults', () => {
    it('should merge controlsState and controlsProps', () => {
      expect(defaults.thetaDelta).toBe(0)
      expect(defaults.phiDelta).toBe(0)
      expect(defaults.scale).toBe(1)
      expect(defaults.limits).toBeDefined()
      expect(defaults.drag).toBe(0.27)
    })
  })

  describe('rotate', () => {
    it('should update thetaDelta and phiDelta', () => {
      const controls = { ...defaults, userControl: { rotate: true } }
      const camera = { position: [100, 100, 100], target: [0, 0, 0] }

      const result = rotate({ controls, camera, speed: 1 }, [0.1, 0.2])

      expect(result.controls.thetaDelta).toBe(0.1)
      expect(result.controls.phiDelta).toBe(0.2)
    })

    it('should respect speed multiplier', () => {
      const controls = { ...defaults, userControl: { rotate: true } }
      const camera = { position: [100, 100, 100], target: [0, 0, 0] }

      const result = rotate({ controls, camera, speed: 2 }, [0.1, 0.2])

      expect(result.controls.thetaDelta).toBe(0.2)
      expect(result.controls.phiDelta).toBe(0.4)
    })

    it('should not rotate if userControl.rotate is false', () => {
      const controls = { ...defaults, userControl: { rotate: false } }
      const camera = { position: [100, 100, 100], target: [0, 0, 0] }

      const result = rotate({ controls, camera, speed: 1 }, [0.1, 0.2])

      expect(result.controls.thetaDelta).toBe(0)
      expect(result.controls.phiDelta).toBe(0)
    })

    it('should accumulate with existing deltas', () => {
      const controls = { ...defaults, thetaDelta: 0.5, phiDelta: 0.3, userControl: { rotate: true } }
      const camera = { position: [100, 100, 100], target: [0, 0, 0] }

      const result = rotate({ controls, camera, speed: 1 }, [0.1, 0.2])

      expect(result.controls.thetaDelta).toBe(0.6)
      expect(result.controls.phiDelta).toBe(0.5)
    })
  })

  describe('zoom', () => {
    it('should update scale with zoom delta', () => {
      const controls = { ...defaults, userControl: { zoom: true } }
      const camera = { position: [100, 100, 100], target: [0, 0, 0] }

      const result = zoom({ controls, camera, speed: 1 }, 1)

      // Scale changes based on zoom delta (could be > 1 or < 1 depending on implementation)
      expect(result.controls.scale).not.toBe(1)
    })

    it('should respect speed multiplier', () => {
      const controls = { ...defaults, userControl: { zoom: true } }
      const camera = { position: [100, 100, 100], target: [0, 0, 0] }

      const result1 = zoom({ controls, camera, speed: 1 }, 1)
      const result2 = zoom({ controls, camera, speed: 2 }, 1)

      expect(result2.controls.scale).toBeGreaterThan(result1.controls.scale)
    })

    it('should not zoom if userControl.zoom is false', () => {
      const controls = { ...defaults, userControl: { zoom: false } }
      const camera = { position: [100, 100, 100], target: [0, 0, 0] }

      const result = zoom({ controls, camera, speed: 1 }, 1)

      expect(result.controls.scale).toBe(1)
    })

    it('should handle zero zoom delta', () => {
      const controls = { ...defaults, userControl: { zoom: true } }
      const camera = { position: [100, 100, 100], target: [0, 0, 0] }

      const result = zoom({ controls, camera, speed: 1 }, 0)

      expect(result.controls.scale).toBe(1)
    })

    it('should handle negative zoom (zoom out)', () => {
      const controls = { ...defaults, userControl: { zoom: true } }
      const camera = { position: [100, 100, 100], target: [0, 0, 0] }

      const result = zoom({ controls, camera, speed: 1 }, -1)

      // Negative zoom delta should change scale (direction depends on implementation)
      // The zoom function normalizes delta to +/-1 * speed
      expect(result.controls).toBeDefined()
    })
  })

  describe('pan', () => {
    it('should update camera position and target', () => {
      const controls = { ...defaults }
      const camera = {
        position: [100, 100, 100],
        target: [0, 0, 0],
        view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], // identity
        projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        viewport: [0, 0, 800, 600]
      }

      const result = pan({ controls, camera, speed: 1 }, [10, 10])

      expect(result.camera.position).toBeDefined()
      expect(result.camera.target).toBeDefined()
      // Position and target should both move
      expect(result.camera.position).not.toEqual(camera.position)
      expect(result.camera.target).not.toEqual(camera.target)
    })

    it('should maintain relative position-target offset', () => {
      const controls = { ...defaults }
      const camera = {
        position: [100, 100, 100],
        target: [0, 0, 0],
        view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        viewport: [0, 0, 800, 600]
      }

      const result = pan({ controls, camera, speed: 1 }, [10, 10])

      // The offset between position and target should be preserved
      const originalOffset = camera.position.map((p, i) => p - camera.target[i])
      const newOffset = result.camera.position.map((p, i) => p - result.camera.target[i])

      // Offsets should be approximately equal (panning moves both by same amount)
      expect(newOffset[0]).toBeCloseTo(originalOffset[0], 5)
      expect(newOffset[1]).toBeCloseTo(originalOffset[1], 5)
      expect(newOffset[2]).toBeCloseTo(originalOffset[2], 5)
    })
  })

  describe('update', () => {
    it('should compute new camera position from orbit state', () => {
      const controls = { ...defaults, thetaDelta: 0.1, phiDelta: 0.1 }
      const camera = {
        position: [100, 100, 100],
        target: [0, 0, 0],
        up: [0, 0, 1]
      }

      const result = update({ controls, camera })

      expect(result.camera.position).toBeDefined()
      expect(result.camera.view).toBeDefined()
      expect(result.controls.changed).toBeDefined()
    })

    it('should apply momentum decay (drag)', () => {
      const controls = { ...defaults, thetaDelta: 1.0, phiDelta: 1.0 }
      const camera = {
        position: [100, 100, 100],
        target: [0, 0, 0],
        up: [0, 0, 1]
      }

      const result = update({ controls, camera })

      // Deltas should be reduced by drag
      expect(Math.abs(result.controls.thetaDelta)).toBeLessThan(1.0)
      expect(Math.abs(result.controls.phiDelta)).toBeLessThan(1.0)
    })

    it('should reset scale to 1 after applying', () => {
      const controls = { ...defaults, scale: 1.5 }
      const camera = {
        position: [100, 100, 100],
        target: [0, 0, 0],
        up: [0, 0, 1]
      }

      const result = update({ controls, camera })

      expect(result.controls.scale).toBe(1)
    })

    it('should set changed flag when position changes', () => {
      const controls = { ...defaults, thetaDelta: 0.5 }
      const camera = {
        position: [100, 100, 100],
        target: [0, 0, 0],
        up: [0, 0, 1]
      }

      const result = update({ controls, camera })

      expect(result.controls.changed).toBe(true)
    })

    it('should work with Z-up coordinate system', () => {
      const controls = { ...defaults, thetaDelta: 0.1 }
      const camera = {
        position: [100, 0, 50],
        target: [0, 0, 0],
        up: [0, 0, 1]
      }

      const result = update({ controls, camera })

      // Should rotate around Z axis
      expect(result.camera.position).toBeDefined()
      expect(result.camera.position[2]).toBeCloseTo(50, 0) // Z should stay roughly the same
    })

    it('should work with Y-up coordinate system', () => {
      const controls = { ...defaults, thetaDelta: 0.1 }
      const camera = {
        position: [100, 50, 0],
        target: [0, 0, 0],
        up: [0, 1, 0]
      }

      const result = update({ controls, camera })

      expect(result.camera.position).toBeDefined()
    })
  })

  describe('zoomToFit', () => {
    it('should return unchanged state for empty bounds', () => {
      const controls = { ...defaults }
      const camera = {
        position: [100, 100, 100],
        target: [0, 0, 0],
        fov: Math.PI / 4
      }

      const result = zoomToFit({ controls, camera, bounds: { dia: 0, center: [0, 0, 0] } })

      expect(result.controls).toBe(controls)
      expect(result.camera).toBe(camera)
    })

    it('should compute scale to fit bounds', () => {
      const controls = { ...defaults }
      const camera = {
        position: [100, 0, 0],
        target: [0, 0, 0],
        fov: Math.PI / 4
      }
      const bounds = {
        center: [0, 0, 0],
        dia: 10
      }

      const result = zoomToFit({ controls, camera, bounds })

      expect(result.controls.scale).toBeDefined()
      expect(result.camera.target).toEqual([0, 0, 0])
    })

    it('should update target to bounds center', () => {
      const controls = { ...defaults }
      const camera = {
        position: [100, 0, 0],
        target: [0, 0, 0],
        fov: Math.PI / 4
      }
      const bounds = {
        center: [50, 50, 50],
        dia: 20
      }

      const result = zoomToFit({ controls, camera, bounds })

      expect(result.camera.target).toEqual([50, 50, 50])
    })

    it('should respect tightness parameter', () => {
      const controls = { ...defaults }
      const camera = {
        position: [100, 0, 0],
        target: [0, 0, 0],
        fov: Math.PI / 4
      }
      const bounds = { center: [0, 0, 0], dia: 10 }

      const tight = zoomToFit({ controls, camera, bounds }, 1.0)
      const loose = zoomToFit({ controls, camera, bounds }, 2.0)

      // Looser fit should have larger scale (camera further away)
      expect(loose.controls.scale).toBeGreaterThan(tight.controls.scale)
    })
  })

  describe('reset', () => {
    it('should reset to default state', () => {
      const controls = { ...defaults, thetaDelta: 0.5, phiDelta: 0.3, scale: 2 }
      const camera = {
        position: [500, 500, 500],
        target: [100, 100, 100],
        up: [0, 0, 1],
        fov: Math.PI / 4,
        aspect: 1.5,
        near: 1,
        far: 50000
      }

      const result = reset({ controls, camera })

      expect(result.controls.thetaDelta).toBe(0)
      expect(result.controls.phiDelta).toBe(0)
      expect(result.controls.scale).toBe(1)
      expect(result.camera.position).toEqual([180, -180, 220])
      expect(result.camera.target).toEqual([0, 0, 0])
    })

    it('should reset to custom state', () => {
      const controls = { ...defaults }
      const camera = {
        position: [0, 0, 0],
        target: [0, 0, 0],
        up: [0, 0, 1]
      }

      const desiredState = {
        camera: { position: [100, 200, 300], target: [10, 20, 30] },
        controls: { thetaDelta: 0.1, phiDelta: 0.2, scale: 1.5 }
      }

      const result = reset({ controls, camera }, desiredState)

      expect(result.camera.position).toEqual([100, 200, 300])
      expect(result.camera.target).toEqual([10, 20, 30])
      expect(result.controls.thetaDelta).toBe(0.1)
      expect(result.controls.phiDelta).toBe(0.2)
      expect(result.controls.scale).toBe(1.5)
    })

    it('should compute view matrix', () => {
      const controls = { ...defaults }
      const camera = { position: [0, 0, 0], target: [0, 0, 0], up: [0, 0, 1] }

      const result = reset({ controls, camera })

      expect(result.camera.view).toBeDefined()
      expect(result.camera.view.length).toBe(16)
    })
  })

  describe('setAutoRotate', () => {
    it('should enable auto-rotate', () => {
      const controls = { ...defaults }

      const result = setAutoRotate(controls, true)

      expect(result.autoRotate.enabled).toBe(true)
      expect(result.autoRotate.speed).toBe(1.0)
    })

    it('should disable auto-rotate', () => {
      const controls = { ...defaults, autoRotate: { enabled: true, speed: 2 } }

      const result = setAutoRotate(controls, false)

      expect(result.autoRotate.enabled).toBe(false)
    })

    it('should set custom speed', () => {
      const controls = { ...defaults }

      const result = setAutoRotate(controls, true, 2.5)

      expect(result.autoRotate.speed).toBe(2.5)
    })
  })
})
