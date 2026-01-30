import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JscadToCommon } from './index.js'

// Constants for index buffer thresholds
// WebGL uses Uint16 for indices by default, which maxes at 65535
// When vertex count exceeds this, we switch to Uint32
const MAX_UINT16_VERTICES = 65535
const TRIANGLES_TO_EXCEED_UINT16 = Math.ceil(MAX_UINT16_VERTICES / 3) + 1 // ~21846 + 1

// Helper to create CSGPolygons geometry
const createPolygons = (polygons, options = {}) => ({
  polygons,
  ...options,
})

// Helper to create a triangle polygon (3 vertices)
const createTriangle = (v0, v1, v2, shared) => ({
  vertices: [v0, v1, v2],
  ...(shared && { shared }),
})

// Helper to create a quad polygon (4 vertices)
const createQuad = (v0, v1, v2, v3, shared) => ({
  vertices: [v0, v1, v2, v3],
  ...(shared && { shared }),
})

// Helper to create a pentagon polygon (5 vertices)
const createPentagon = (vertices, shared) => ({
  vertices,
  ...(shared && { shared }),
})

describe('JscadToCommon', () => {
  beforeEach(() => {
    JscadToCommon.clearCache()
  })

  describe('basic conversion', () => {
    it('should convert CSGPolygons to mesh', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('mesh')
      expect(result.vertices).toBeInstanceOf(Float32Array)
      expect(result.normals).toBeInstanceOf(Float32Array)
      expect(result.indices).toBeDefined()
      expect(result.id).toBe(1)
    })

    it('should throw error for non-object input', () => {
      expect(() => JscadToCommon('string', [], undefined)).toThrow(
        'invalid jscad geometry, not an object'
      )
      expect(() => JscadToCommon(123, [], undefined)).toThrow(
        'invalid jscad geometry, not an object'
      )
      expect(() => JscadToCommon(null, [], undefined)).toThrow()
    })

    it('should handle array input by mapping each element', () => {
      const csg1 = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])
      const csg2 = createPolygons([
        createTriangle([1, 1, 1], [2, 1, 1], [1, 2, 1]),
      ])

      const result = JscadToCommon([csg1, csg2], [], undefined)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
      expect(result[0].type).toBe('mesh')
      expect(result[1].type).toBe('mesh')
    })

    it('should handle unknown geometry type gracefully', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const csg = { someUnknownProperty: 'value' }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('unknown')
      expect(result.csg).toBe(csg)
      expect(consoleError).toHaveBeenCalledWith('invalid jscad geometry', csg)
      consoleError.mockRestore()
    })
  })

  describe('triangulation', () => {
    it('should produce 1 triangle from a 3-vertex polygon', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      // 3 vertices * 3 components = 9 floats
      expect(result.vertices.length).toBe(9)
      // 1 triangle * 3 indices = 3
      expect(result.indices.length).toBe(3)
      expect(Array.from(result.indices)).toEqual([0, 1, 2])
    })

    it('should produce 2 triangles from a 4-vertex polygon (quad)', () => {
      const csg = createPolygons([
        createQuad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      // 4 vertices * 3 components = 12 floats
      expect(result.vertices.length).toBe(12)
      // 2 triangles * 3 indices = 6
      expect(result.indices.length).toBe(6)
      // Fan triangulation: (0,1,2), (0,2,3)
      expect(Array.from(result.indices)).toEqual([0, 1, 2, 0, 2, 3])
    })

    it('should produce 3 triangles from a 5-vertex polygon (pentagon)', () => {
      const csg = createPolygons([
        createPentagon([
          [0, 0, 0],
          [1, 0, 0],
          [1.5, 0.5, 0],
          [0.5, 1, 0],
          [-0.5, 0.5, 0],
        ]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      // 5 vertices * 3 components = 15 floats
      expect(result.vertices.length).toBe(15)
      // 3 triangles * 3 indices = 9
      expect(result.indices.length).toBe(9)
      // Fan triangulation: (0,1,2), (0,2,3), (0,3,4)
      expect(Array.from(result.indices)).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4])
    })

    it('should handle multiple polygons', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
        createTriangle([2, 0, 0], [3, 0, 0], [2, 1, 0]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      // 6 vertices * 3 components = 18 floats
      expect(result.vertices.length).toBe(18)
      // 2 triangles * 3 indices = 6
      expect(result.indices.length).toBe(6)
    })
  })

  describe('normal calculation', () => {
    it('should calculate correct normal for a flat triangle on XY plane', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      // Normal should point in Z direction (0, 0, 1) for counter-clockwise vertices
      const normal = [result.normals[0], result.normals[1], result.normals[2]]
      expect(normal[0]).toBeCloseTo(0)
      expect(normal[1]).toBeCloseTo(0)
      expect(normal[2]).toBeCloseTo(1)
    })

    it('should calculate correct normal for triangle on XZ plane', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 0, 1]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      // Normal should point in -Y direction
      const normal = [result.normals[0], result.normals[1], result.normals[2]]
      expect(normal[0]).toBeCloseTo(0)
      expect(normal[1]).toBeCloseTo(-1)
      expect(normal[2]).toBeCloseTo(0)
    })

    it('should return fallback normal [0, 0, 1] for degenerate polygon (collinear vertices)', () => {
      // All three vertices are on the same line (collinear)
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [2, 0, 0]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      const normal = [result.normals[0], result.normals[1], result.normals[2]]
      expect(normal).toEqual([0, 0, 1])
    })

    it('should return fallback normal for coincident vertices', () => {
      const csg = createPolygons([
        createTriangle([1, 1, 1], [1, 1, 1], [1, 1, 1]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      const normal = [result.normals[0], result.normals[1], result.normals[2]]
      expect(normal).toEqual([0, 0, 1])
    })
  })

  describe('vertex format compatibility', () => {
    it('should handle v2 format: [x, y, z] arrays', () => {
      const csg = createPolygons([
        createTriangle([1, 2, 3], [4, 5, 6], [7, 8, 9]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      expect(result.vertices[0]).toBe(1)
      expect(result.vertices[1]).toBe(2)
      expect(result.vertices[2]).toBe(3)
      expect(result.vertices[3]).toBe(4)
      expect(result.vertices[4]).toBe(5)
      expect(result.vertices[5]).toBe(6)
    })

    it('should handle v1 format: {pos: {x, y, z}} objects', () => {
      const csg = createPolygons([
        {
          vertices: [
            { pos: { x: 1, y: 2, z: 3 } },
            { pos: { x: 4, y: 5, z: 6 } },
            { pos: { x: 7, y: 8, z: 9 } },
          ],
        },
      ])

      const result = JscadToCommon(csg, [], undefined)

      expect(result.vertices[0]).toBe(1)
      expect(result.vertices[1]).toBe(2)
      expect(result.vertices[2]).toBe(3)
      expect(result.vertices[3]).toBe(4)
      expect(result.vertices[4]).toBe(5)
      expect(result.vertices[5]).toBe(6)
    })

    it('should handle 2D vertices [x, y] defaulting z to 0', () => {
      // Testing via CSGLine which uses setPoints
      const csg = {
        points: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        isClosed: false,
      }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('line')
      expect(result.vertices[0]).toBe(1)
      expect(result.vertices[1]).toBe(2)
      expect(result.vertices[2]).toBe(0) // z defaults to 0
      expect(result.vertices[3]).toBe(3)
      expect(result.vertices[4]).toBe(4)
      expect(result.vertices[5]).toBe(0)
    })
  })

  describe('index buffer selection', () => {
    it('should use Uint16Array for small vertex count (<=65535)', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      expect(result.indices).toBeInstanceOf(Uint16Array)
    })

    it('should use Uint32Array for large vertex count (>65535)', () => {
      // Create enough polygons to exceed MAX_UINT16_VERTICES
      // Each triangle has 3 vertices
      const polygons = []
      for (let i = 0; i < TRIANGLES_TO_EXCEED_UINT16; i++) {
        polygons.push(createTriangle([i, 0, 0], [i + 1, 0, 0], [i, 1, 0]))
      }
      const csg = createPolygons(polygons)

      const result = JscadToCommon(csg, [], undefined)

      expect(result.indices).toBeInstanceOf(Uint32Array)
    })
  })

  describe('color handling', () => {
    it('should handle RGB colors (3 components) with alpha defaulting to 1', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0], {
          color: [1, 0, 0],
        }),
      ])

      const result = JscadToCommon(csg, [], undefined)

      expect(result.colors).toBeInstanceOf(Float32Array)
      // Each index gets RGBA, triangle has 3 indices
      expect(result.colors[0]).toBe(1) // R
      expect(result.colors[1]).toBe(0) // G
      expect(result.colors[2]).toBe(0) // B
      expect(result.colors[3]).toBe(1) // A (default)
    })

    it('should handle RGBA colors (4 components)', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0], {
          color: [0, 1, 0, 0.5],
        }),
      ])

      const result = JscadToCommon(csg, [], undefined)

      expect(result.colors[0]).toBe(0) // R
      expect(result.colors[1]).toBe(1) // G
      expect(result.colors[2]).toBe(0) // B
      expect(result.colors[3]).toBe(0.5) // A
    })

    it('should use default color [1, 0.5, 0.5, 1] when polygon has no color', () => {
      // First polygon has color, second doesn't - second uses lastColor default
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0], {
          color: [0, 0, 1, 1],
        }),
        createTriangle([2, 0, 0], [3, 0, 0], [2, 1, 0]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      // Second triangle uses default [1, 0.5, 0.5, 1]
      // First triangle has 3 indices * 4 color components = 12 floats
      expect(result.colors[12]).toBe(1)
      expect(result.colors[13]).toBe(0.5)
      expect(result.colors[14]).toBe(0.5)
      expect(result.colors[15]).toBe(1)
    })

    it('should set isTransparent flag when vertex colors are present', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0], {
          color: [1, 0, 0, 0.5],
        }),
      ])

      const result = JscadToCommon(csg, [], undefined)

      expect(result.isTransparent).toBe(true)
    })

    it('should preserve color from csg object level', () => {
      const csg = createPolygons(
        [createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0])],
        { color: [0.5, 0.5, 0.5, 1] }
      )

      const result = JscadToCommon(csg, [], undefined)

      expect(result.color).toEqual([0.5, 0.5, 0.5, 1])
    })
  })

  describe('geometry type detection', () => {
    it('should detect CSGPolygons (has polygons array) as mesh', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('mesh')
    })

    it('should detect CSGLine (has points array) as line', () => {
      const csg = {
        points: [
          [0, 0, 0],
          [1, 1, 1],
          [2, 2, 2],
        ],
        isClosed: false,
      }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('line')
    })

    it('should detect CSGLineSegments (has sides array without points) as lines', () => {
      const csg = {
        sides: [
          [
            [0, 0, 0],
            [1, 1, 1],
          ],
          [
            [2, 2, 2],
            [3, 3, 3],
          ],
        ],
      }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('lines')
    })

    it('should detect CSGOutlines (has outlines) as lines', () => {
      const csg = {
        outlines: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('lines')
    })

    it('should detect CSGContours (has contours) as lines', () => {
      const csg = {
        contours: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        ],
      }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('lines')
    })

    it('should pass through already converted geometry (has vertices)', () => {
      const alreadyConverted = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      }

      const result = JscadToCommon(alreadyConverted, [], undefined)

      expect(result.type).toBe('mesh')
      expect(result.vertices).toBe(alreadyConverted.vertices)
    })

    it('should prioritize vertices getter over polygons getter (optimization path)', () => {
      // Simulates ManifoldGeom3 which has both vertices and polygons getters
      let polygonsAccessed = false
      const mockManifoldGeom3 = {
        get type() { return 'mesh' },
        get vertices() { return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
        get indices() { return new Uint32Array([0, 1, 2]) },
        get normals() { return new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) },
        get polygons() {
          polygonsAccessed = true
          return [{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }]
        },
      }

      const result = JscadToCommon(mockManifoldGeom3, [], undefined)

      expect(result.type).toBe('mesh')
      expect(polygonsAccessed).toBe(false) // Should NOT access polygons getter
    })

    it('should extract data from getters into plain object for postMessage compatibility', () => {
      // Class instances with getters can't be serialized via postMessage
      // JscadToCommon should extract the data into a plain object
      const mockManifoldGeom3 = {
        get type() { return 'mesh' },
        get vertices() { return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
        get indices() { return new Uint32Array([0, 1, 2]) },
        get normals() { return new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) },
      }

      const result = JscadToCommon(mockManifoldGeom3, [], undefined)

      // Result should be a plain object, not the original
      expect(result).not.toBe(mockManifoldGeom3)
      expect(result.type).toBe('mesh')
      expect(result.vertices).toBeInstanceOf(Float32Array)
      expect(result.indices).toBeInstanceOf(Uint32Array)
      expect(result.normals).toBeInstanceOf(Float32Array)
      expect(result.id).toBeDefined() // Should have an id assigned
    })

    it('should prioritize points over sides when both present', () => {
      // This tests CSGLine detection when sides is also present
      const csg = {
        points: [
          [0, 0, 0],
          [1, 1, 1],
        ],
        sides: [
          [
            [0, 0, 0],
            [1, 1, 1],
          ],
        ],
        isClosed: false,
      }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('line')
    })
  })

  describe('line processing', () => {
    it('should duplicate first point for closed lines (isClosed=true)', () => {
      const csg = {
        points: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
        ],
        isClosed: true,
      }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('line')
      // 3 points + 1 duplicated first point = 4 points * 3 = 12 floats
      expect(result.vertices.length).toBe(12)
      // Last point should equal first point
      expect(result.vertices[9]).toBe(0)
      expect(result.vertices[10]).toBe(0)
      expect(result.vertices[11]).toBe(0)
    })

    it('should not duplicate first point for open lines (isClosed=false)', () => {
      const csg = {
        points: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
        ],
        isClosed: false,
      }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('line')
      // 3 points * 3 = 9 floats
      expect(result.vertices.length).toBe(9)
    })

    it('should convert line segments to pairs of vertices', () => {
      const csg = {
        sides: [
          [
            [0, 0, 0],
            [1, 1, 1],
          ],
          [
            [2, 2, 2],
            [3, 3, 3],
          ],
        ],
      }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('lines')
      // 2 sides * 2 vertices * 3 = 12 floats
      expect(result.vertices.length).toBe(12)
      expect(Array.from(result.vertices)).toEqual([
        0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3,
      ])
    })

    it('should convert outlines to closed line segments', () => {
      const csg = {
        outlines: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        ],
      }

      const result = JscadToCommon(csg, [], undefined)

      expect(result.type).toBe('lines')
      // 3 points in outline = 3 segments (closed)
      // 3 segments * 2 vertices * 3 = 18 floats
      expect(result.vertices.length).toBe(18)
    })

    it('should handle multiple outlines', () => {
      const csg = {
        outlines: [
          [
            [0, 0],
            [1, 0],
          ],
          [
            [2, 0],
            [3, 0],
          ],
        ],
      }

      const result = JscadToCommon(csg, [], undefined)

      // 2 outlines, each with 2 points = 2 segments each = 4 total segments
      // 4 segments * 2 vertices * 3 = 24 floats
      expect(result.vertices.length).toBe(24)
    })
  })

  describe('cache behavior', () => {
    it('should return cached result for same geometry', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      const result1 = JscadToCommon(csg, [], undefined)
      const result2 = JscadToCommon(csg, [], undefined)

      expect(result1.id).toBe(result2.id)
      expect(result1.vertices).toBe(result2.vertices)
    })

    it('should increment sequence for different geometries', () => {
      const csg1 = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])
      const csg2 = createPolygons([
        createTriangle([1, 1, 1], [2, 1, 1], [1, 2, 1]),
      ])

      const result1 = JscadToCommon(csg1, [], undefined)
      const result2 = JscadToCommon(csg2, [], undefined)

      expect(result1.id).toBe(1)
      expect(result2.id).toBe(2)
    })

    it('should reset cache and sequence with clearCache()', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      JscadToCommon(csg, [], undefined)
      JscadToCommon.clearCache()

      const result = JscadToCommon(csg, [], undefined)
      expect(result.id).toBe(1) // Reset to 1
    })

    it('should use polygons array as cache key for CSGPolygons', () => {
      const polygons = [createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0])]
      const csg1 = { polygons }
      const csg2 = { polygons } // Same polygons array reference

      const result1 = JscadToCommon(csg1, [], undefined)
      const result2 = JscadToCommon(csg2, [], undefined)

      expect(result1.id).toBe(result2.id)
    })

    it('should not cache already converted geometry multiple times', () => {
      const transferable1 = []
      const transferable2 = []
      const alreadyConverted = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      }

      JscadToCommon(alreadyConverted, transferable1, undefined)
      JscadToCommon(alreadyConverted, transferable2, undefined)

      // Should only add to transferable once
      expect(transferable1.length).toBe(3) // vertices, indices, and normals
      expect(transferable2.length).toBe(0) // second call shouldn't add again
    })
  })

  describe('transferable array', () => {
    it('should populate transferable with vertices, indices, and normals', () => {
      const transferable = []
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      const result = JscadToCommon(csg, transferable, undefined)

      expect(transferable).toContain(result.vertices)
      expect(transferable).toContain(result.indices)
      // Note: normals are not added to transferable in CSGCached path
    })

    it('should populate transferable with normals for pass-through geometry', () => {
      const transferable = []
      const mockManifoldGeom3 = {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      }

      JscadToCommon(mockManifoldGeom3, transferable, undefined)

      expect(transferable).toContain(mockManifoldGeom3.vertices)
      expect(transferable).toContain(mockManifoldGeom3.indices)
      expect(transferable).toContain(mockManifoldGeom3.normals)
    })

    it('should not populate transferable when null', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      // Should not throw
      const result = JscadToCommon(csg, null, undefined)
      expect(result.type).toBe('mesh')
    })
  })

  describe('unique map', () => {
    it('should populate unique map with geometry by id', () => {
      const unique = new Map()
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      const result = JscadToCommon(csg, [], unique)

      expect(unique.get(result.id)).toBe(result)
    })

    it('should not populate unique map when undefined or false', () => {
      const csg = createPolygons([
        createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ])

      // Should not throw
      JscadToCommon(csg, [], undefined)
      JscadToCommon(csg, [], false)
    })
  })

  describe('transforms handling', () => {
    it('should preserve transforms from csg object', () => {
      const transforms = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]
      const csg = createPolygons(
        [createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0])],
        { transforms }
      )

      const result = JscadToCommon(csg, [], undefined)

      expect(result.transforms).toEqual(transforms)
    })
  })
})

describe('JscadToCommon.ConvertMulti', () => {
  beforeEach(() => {
    JscadToCommon.clearCache()
  })

  it('should convert multiple geometries', () => {
    const csg1 = createPolygons([
      createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ])
    const csg2 = {
      points: [
        [0, 0, 0],
        [1, 1, 1],
      ],
      isClosed: false,
    }

    const results = JscadToCommon.ConvertMulti([csg1, csg2], [], undefined)

    expect(results.length).toBe(2)
    expect(results[0].type).toBe('mesh')
    expect(results[1].type).toBe('line')
  })
})

describe('JscadToCommon.prepare', () => {
  beforeEach(() => {
    JscadToCommon.clearCache()
  })

  it('should group geometries by type', () => {
    const mesh = createPolygons([
      createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ])
    const line = {
      points: [
        [0, 0, 0],
        [1, 1, 1],
      ],
      isClosed: false,
    }
    const lines = {
      sides: [
        [
          [0, 0, 0],
          [1, 1, 1],
        ],
      ],
    }

    const result = JscadToCommon.prepare([mesh, line, lines], [], false)

    expect(result.mesh.length).toBe(1)
    expect(result.line.length).toBe(1)
    expect(result.lines.length).toBe(1)
    expect(result.all.length).toBe(3)
  })

  it('should handle null values in list', () => {
    const mesh = createPolygons([
      createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ])

    const result = JscadToCommon.prepare([mesh, null, undefined], [], false)

    expect(result.mesh.length).toBe(1)
    expect(result.all.length).toBe(1)
  })

  it('should flatten nested arrays', () => {
    const mesh1 = createPolygons([
      createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ])
    const mesh2 = createPolygons([
      createTriangle([1, 1, 1], [2, 1, 1], [1, 2, 1]),
    ])

    const result = JscadToCommon.prepare([[mesh1, [mesh2]]], [], false)

    expect(result.mesh.length).toBe(2)
    expect(result.all.length).toBe(2)
  })

  it('should handle undefined list', () => {
    const result = JscadToCommon.prepare(undefined, [], false)

    expect(result.mesh.length).toBe(0)
    expect(result.all.length).toBe(0)
  })

  describe('instance deduplication', () => {
    it('should deduplicate identical geometries when useInstances=true', () => {
      // Same polygons array = same cache key = same geometry
      const polygons = [createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0])]
      const mesh1 = { polygons }
      const mesh2 = { polygons } // Same reference

      const result = JscadToCommon.prepare([mesh1, mesh2], [], true)

      expect(result.instance.length).toBe(1)
      expect(result.instance[0].list.length).toBe(2)
      expect(result.mesh.length).toBe(0)
    })

    it('should NOT instance transparent objects (alpha < 1)', () => {
      const polygons = [createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0])]
      const mesh1 = { polygons, color: [1, 0, 0, 0.5] }
      const mesh2 = { polygons, color: [1, 0, 0, 0.5] }

      const result = JscadToCommon.prepare([mesh1, mesh2], [], true)

      // Transparent objects should not be instanced
      expect(result.instance.length).toBe(0)
      expect(result.mesh.length).toBe(2)
    })

    it('should instance opaque RGB colors (3 components)', () => {
      const polygons = [createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0])]
      const mesh1 = { polygons, color: [1, 0, 0] }
      const mesh2 = { polygons, color: [1, 0, 0] }

      const result = JscadToCommon.prepare([mesh1, mesh2], [], true)

      expect(result.instance.length).toBe(1)
      expect(result.instance[0].list.length).toBe(2)
    })

    it('should instance when alpha = 1', () => {
      const polygons = [createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0])]
      const mesh1 = { polygons, color: [1, 0, 0, 1] }
      const mesh2 = { polygons, color: [1, 0, 0, 1] }

      const result = JscadToCommon.prepare([mesh1, mesh2], [], true)

      expect(result.instance.length).toBe(1)
    })

    it('should not instance single occurrences', () => {
      const polygons1 = [createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0])]
      const polygons2 = [createTriangle([1, 1, 1], [2, 1, 1], [1, 2, 1])]
      const mesh1 = { polygons: polygons1 }
      const mesh2 = { polygons: polygons2 }

      const result = JscadToCommon.prepare([mesh1, mesh2], [], true)

      // Different geometries should be in mesh, not instance
      expect(result.instance.length).toBe(0)
      expect(result.mesh.length).toBe(2)
    })

    it('should not deduplicate when useInstances=false', () => {
      const polygons = [createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0])]
      const mesh1 = { polygons }
      const mesh2 = { polygons }

      const result = JscadToCommon.prepare([mesh1, mesh2], [], false)

      expect(result.instance.length).toBe(0)
      expect(result.mesh.length).toBe(2)
    })
  })

  it('should populate unique map', () => {
    const mesh = createPolygons([
      createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ])

    const result = JscadToCommon.prepare([mesh], [], false)

    expect(result.unique.size).toBe(1)
  })

  it('should include csg reference in result objects', () => {
    const mesh = createPolygons([
      createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ])

    const result = JscadToCommon.prepare([mesh], [], false)

    expect(result.mesh[0].csg).toBe(mesh)
  })
})

describe('edge cases', () => {
  beforeEach(() => {
    JscadToCommon.clearCache()
  })

  it('should handle empty polygons array', () => {
    const csg = createPolygons([])

    const result = JscadToCommon(csg, [], undefined)

    expect(result.type).toBe('mesh')
    expect(result.vertices.length).toBe(0)
    expect(result.indices.length).toBe(0)
  })

  it('should handle empty points array for line', () => {
    const csg = {
      points: [],
      isClosed: false,
    }

    const result = JscadToCommon(csg, [], undefined)

    expect(result.type).toBe('line')
    expect(result.vertices.length).toBe(0)
  })

  it('should handle empty sides array for line segments', () => {
    const csg = {
      sides: [],
    }

    const result = JscadToCommon(csg, [], undefined)

    expect(result.type).toBe('lines')
    expect(result.vertices.length).toBe(0)
  })

  it('should handle empty outlines array', () => {
    const csg = {
      outlines: [],
    }

    const result = JscadToCommon(csg, [], undefined)

    expect(result.type).toBe('lines')
    expect(result.vertices.length).toBe(0)
  })

  it('should handle outline with empty points', () => {
    const csg = {
      outlines: [[]],
    }

    const result = JscadToCommon(csg, [], undefined)

    expect(result.type).toBe('lines')
    expect(result.vertices.length).toBe(0)
  })

  it('should copy result object when color or transforms present', () => {
    const csg = createPolygons(
      [createTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0])],
      { color: [1, 0, 0, 1] }
    )

    const result1 = JscadToCommon(csg, [], undefined)

    // Different CSG with same polygons but different color
    const csg2 = { ...csg, color: [0, 1, 0, 1] }
    const result2 = JscadToCommon(csg2, [], undefined)

    // Should be different objects despite shared cached geometry
    expect(result1.color).toEqual([1, 0, 0, 1])
    expect(result2.color).toEqual([0, 1, 0, 1])
  })
})
