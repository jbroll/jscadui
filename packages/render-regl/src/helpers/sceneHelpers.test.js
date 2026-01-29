import { describe, expect, it } from 'vitest'

import { makeGrid, makeAxes, createSceneHelpers, gridColors } from './sceneHelpers.js'

describe('sceneHelpers', () => {
  describe('makeGrid', () => {
    it('should return an array of two line objects', () => {
      const result = makeGrid()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
    })

    it('should return objects with vertices and color', () => {
      const result = makeGrid()

      result.forEach(obj => {
        expect(obj.vertices).toBeInstanceOf(Float32Array)
        expect(obj.color).toBeDefined()
        expect(obj.type).toBe('lines')
      })
    })

    it('should mark grid lines as transparent', () => {
      const result = makeGrid()

      result.forEach(obj => {
        expect(obj.isTransparent).toBe(true)
      })
    })

    it('should accept custom size', () => {
      const result = makeGrid({ size: 100 })

      expect(result.length).toBe(2)
      // Smaller grid should have fewer vertices
      const defaultResult = makeGrid({ size: 200 })
      expect(result[0].vertices.length).toBeLessThan(defaultResult[0].vertices.length)
    })

    it('should accept custom colors', () => {
      const color1 = [1, 0, 0, 0.5]
      const color2 = [0, 1, 0, 0.3]
      const result = makeGrid({ color1, color2 })

      expect(result[0].color).toEqual(color1)
      expect(result[1].color).toEqual(color2)
    })
  })

  describe('makeAxes', () => {
    it('should return a lines object', () => {
      const result = makeAxes()

      expect(result.type).toBe('lines')
      expect(result.vertices).toBeInstanceOf(Float32Array)
      expect(result.colors).toBeInstanceOf(Float32Array)
    })

    it('should have 3 axis lines (6 vertices)', () => {
      const result = makeAxes()

      // 3 axes * 2 vertices * 3 components = 18 floats
      expect(result.vertices.length).toBe(18)
    })

    it('should have RGBA colors (4 components per vertex)', () => {
      const result = makeAxes()

      // 6 vertices * 4 components = 24 floats
      expect(result.colors.length).toBe(24)
    })

    it('should accept custom length', () => {
      const result = makeAxes(50)

      // Check that axis extends to specified length
      // X axis: [0,0,0] to [50,0,0]
      expect(result.vertices[3]).toBe(50) // x1 of first axis
    })

    it('should have RGB colors for each axis', () => {
      const result = makeAxes(100)

      // X axis = red (1,0,0)
      expect(result.colors[0]).toBe(1)
      expect(result.colors[1]).toBe(0)
      expect(result.colors[2]).toBe(0)

      // Y axis = green (0,1,0)
      expect(result.colors[8]).toBe(0)
      expect(result.colors[9]).toBe(1)
      expect(result.colors[10]).toBe(0)

      // Z axis = blue (0,0,1)
      expect(result.colors[16]).toBe(0)
      expect(result.colors[17]).toBe(0)
      expect(result.colors[18]).toBe(1)
    })
  })

  describe('createSceneHelpers', () => {
    it('should return array with grid and axes by default', () => {
      const result = createSceneHelpers()

      // 2 grid objects + 1 axes object = 3
      expect(result.length).toBe(3)
    })

    it('should return only grid when showAxes is false', () => {
      const result = createSceneHelpers({ showAxes: false })

      expect(result.length).toBe(2) // Just grid objects
      result.forEach(obj => {
        expect(obj.isTransparent).toBe(true) // Grid is transparent
      })
    })

    it('should return only axes when showGrid is false', () => {
      const result = createSceneHelpers({ showGrid: false })

      expect(result.length).toBe(1)
      expect(result[0].colors).toBeDefined() // Axes have colors
    })

    it('should return empty array when both disabled', () => {
      const result = createSceneHelpers({ showGrid: false, showAxes: false })

      expect(result.length).toBe(0)
    })

    it('should pass custom grid size', () => {
      const result = createSceneHelpers({ gridSize: 100 })
      const defaultResult = createSceneHelpers({ gridSize: 200 })

      // Smaller grid should have fewer vertices
      expect(result[0].vertices.length).toBeLessThan(defaultResult[0].vertices.length)
    })

    it('should pass custom axis length', () => {
      const result = createSceneHelpers({ showGrid: false, axisLength: 50 })

      expect(result[0].vertices[3]).toBe(50)
    })

    it('should pass custom grid colors', () => {
      const color1 = [1, 0, 0, 0.5]
      const color2 = [0, 1, 0, 0.3]
      const result = createSceneHelpers({
        showAxes: false,
        gridColor1: color1,
        gridColor2: color2
      })

      expect(result[0].color).toEqual(color1)
      expect(result[1].color).toEqual(color2)
    })
  })

  describe('gridColors', () => {
    it('should have light theme colors', () => {
      expect(gridColors.light).toBeDefined()
      expect(gridColors.light.color1).toEqual([0, 0, 0, 0.2])
      expect(gridColors.light.color2).toEqual([0, 0, 0.6, 0.1])
    })

    it('should have dark theme colors', () => {
      expect(gridColors.dark).toBeDefined()
      expect(gridColors.dark.color1).toEqual([1, 1, 1, 0.2])
      expect(gridColors.dark.color2).toEqual([0.6, 0.6, 1, 0.1])
    })

    it('should have 4-component RGBA colors', () => {
      expect(gridColors.light.color1.length).toBe(4)
      expect(gridColors.light.color2.length).toBe(4)
      expect(gridColors.dark.color1.length).toBe(4)
      expect(gridColors.dark.color2.length).toBe(4)
    })
  })
})
