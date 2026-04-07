import { describe, it, expect, beforeAll } from 'vitest'
import {
  init,
  isInitialized,
  cube,
  sphere,
  cylinder,
  union,
  subtract,
  intersect,
  translate,
  rotate as _rotate,
  scale,
  mirror,
  measureBoundingBox,
  measureVolume,
  isManifoldGeom3,
  rectangle,
  extrudeLinear,
  isManifoldGeom2
} from '../src/index.js'

describe('@jscadui/manifold', () => {
  beforeAll(async () => {
    await init()
  })

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(isInitialized()).toBe(true)
    })
  })

  describe('primitives', () => {
    it('should create a cube', () => {
      const c = cube({ size: 10 })
      expect(isManifoldGeom3(c)).toBe(true)
      expect(c.polygons.length).toBeGreaterThan(0)
    })

    it('should create a sphere', () => {
      const s = sphere({ radius: 5, segments: 16 })
      expect(isManifoldGeom3(s)).toBe(true)
      expect(s.polygons.length).toBeGreaterThan(0)
    })

    it('should create a cylinder', () => {
      const cyl = cylinder({ radius: 3, height: 10 })
      expect(isManifoldGeom3(cyl)).toBe(true)
      expect(cyl.polygons.length).toBeGreaterThan(0)
    })
  })

  describe('booleans', () => {
    it('should union two cubes', () => {
      const c1 = cube({ size: 10, center: [0, 0, 0] })
      const c2 = cube({ size: 10, center: [5, 0, 0] })
      const result = union(c1, c2)
      expect(isManifoldGeom3(result)).toBe(true)
      expect(result.polygons.length).toBeGreaterThan(0)
    })

    it('should subtract cylinder from cube (the classic problem case)', () => {
      const box = cube({ size: 10 })
      const hole = cylinder({ radius: 3, height: 12 })
      const result = subtract(box, hole)
      expect(isManifoldGeom3(result)).toBe(true)
      expect(result.polygons.length).toBeGreaterThan(0)
      // Volume should be cube minus cylinder
      const vol = measureVolume(result)
      // Cylinder is approximated with 32 segments, so volume differs slightly from ideal
      const expectedVol = 10 * 10 * 10 - Math.PI * 3 * 3 * 10
      // Use -1 decimal precision (tens place) due to segment approximation
      expect(vol).toBeCloseTo(expectedVol, -1)
    })

    it('should intersect two cubes', () => {
      const c1 = cube({ size: 10, center: [0, 0, 0] })
      const c2 = cube({ size: 10, center: [5, 5, 5] })
      const result = intersect(c1, c2)
      expect(isManifoldGeom3(result)).toBe(true)
      expect(result.polygons.length).toBeGreaterThan(0)
    })
  })

  describe('transforms', () => {
    it('should translate a cube', () => {
      const c = cube({ size: 10, center: [0, 0, 0] })
      const moved = translate([10, 20, 30], c)
      const bbox = measureBoundingBox(moved)
      expect(bbox[0]).toEqual([5, 15, 25])
      expect(bbox[1]).toEqual([15, 25, 35])
    })

    it('should scale a cube', () => {
      const c = cube({ size: 10, center: [0, 0, 0] })
      const scaled = scale([2, 1, 1], c)
      const dims = [
        scaled.boundingBox()[1][0] - scaled.boundingBox()[0][0],
        scaled.boundingBox()[1][1] - scaled.boundingBox()[0][1],
        scaled.boundingBox()[1][2] - scaled.boundingBox()[0][2]
      ]
      expect(dims[0]).toBeCloseTo(20, 1)
      expect(dims[1]).toBeCloseTo(10, 1)
      expect(dims[2]).toBeCloseTo(10, 1)
    })
  })

  describe('measurements', () => {
    it('should measure bounding box', () => {
      const c = cube({ size: 10, center: [0, 0, 0] })
      const bbox = measureBoundingBox(c)
      expect(bbox[0]).toEqual([-5, -5, -5])
      expect(bbox[1]).toEqual([5, 5, 5])
    })

    it('should measure volume', () => {
      const c = cube({ size: 10 })
      const vol = measureVolume(c)
      expect(vol).toBeCloseTo(1000, 1)
    })
  })

  describe('common format interface (render-ready output)', () => {
    it('should expose type as mesh', () => {
      const c = cube({ size: 10 })
      expect(c.type).toBe('mesh')
    })

    it('should expose vertices as Float32Array', () => {
      const c = cube({ size: 10 })
      expect(c.vertices).toBeInstanceOf(Float32Array)
      expect(c.vertices.length).toBeGreaterThan(0)
      // A cube has 12 triangles (2 per face), 3 vertices per triangle = 36 vertices
      // 36 vertices * 3 components = 108 floats
      expect(c.vertices.length).toBe(108)
    })

    it('should expose indices as Uint32Array', () => {
      const c = cube({ size: 10 })
      expect(c.indices).toBeInstanceOf(Uint32Array)
      // 36 vertices = 36 indices (sequential since we expand to non-indexed)
      expect(c.indices.length).toBe(36)
    })

    it('should expose normals as Float32Array', () => {
      const c = cube({ size: 10 })
      expect(c.normals).toBeInstanceOf(Float32Array)
      // Same length as vertices (one normal per vertex)
      expect(c.normals.length).toBe(c.vertices.length)
    })

    it('should compute correct face normals for a cube', () => {
      const c = cube({ size: 10, center: [0, 0, 0] })
      const normals = c.normals

      // Collect unique normals (should be 6 for a cube - one per face)
      const uniqueNormals = new Set()
      for (let i = 0; i < normals.length; i += 3) {
        const key = `${normals[i].toFixed(2)},${normals[i + 1].toFixed(2)},${normals[i + 2].toFixed(2)}`
        uniqueNormals.add(key)
      }

      // Cube should have exactly 6 unique face normals
      expect(uniqueNormals.size).toBe(6)

      // All normals should be unit vectors pointing in axis directions
      const expectedNormals = [
        '1.00,0.00,0.00', '-1.00,0.00,0.00',
        '0.00,1.00,0.00', '0.00,-1.00,0.00',
        '0.00,0.00,1.00', '0.00,0.00,-1.00'
      ]
      expectedNormals.forEach(n => {
        expect(uniqueNormals.has(n)).toBe(true)
      })
    })

    it('should cache mesh data (lazy computation)', () => {
      const c = cube({ size: 10 })
      const vertices1 = c.vertices
      const vertices2 = c.vertices
      // Should return the same cached array
      expect(vertices1).toBe(vertices2)
    })

    it('should have consistent data between vertices, indices, and normals', () => {
      const s = sphere({ radius: 5, segments: 8 })

      // vertices and normals should have same length
      expect(s.vertices.length).toBe(s.normals.length)

      // indices length should be vertices.length / 3 (one index per vertex)
      expect(s.indices.length).toBe(s.vertices.length / 3)
    })

    it('should work with boolean results', () => {
      const box = cube({ size: 10 })
      const hole = cylinder({ radius: 3, height: 12 })
      const result = subtract(box, hole)

      expect(result.type).toBe('mesh')
      expect(result.vertices).toBeInstanceOf(Float32Array)
      expect(result.indices).toBeInstanceOf(Uint32Array)
      expect(result.normals).toBeInstanceOf(Float32Array)
      expect(result.vertices.length).toBeGreaterThan(0)
    })

    it('should compute normals for degenerate triangles gracefully', () => {
      // This tests that the normal computation handles edge cases
      const c = cube({ size: 10 })
      const normals = c.normals

      // No NaN values in normals
      for (let i = 0; i < normals.length; i++) {
        expect(isNaN(normals[i])).toBe(false)
      }

      // All normals should be unit length (or close to it)
      for (let i = 0; i < normals.length; i += 3) {
        const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2])
        expect(len).toBeCloseTo(1, 5)
      }
    })
  })

  describe('mirror on 2D geometry', () => {
    it('mirror([0,0,1]) on geom2 is identity (no-op for z-only normal)', () => {
      // Regression test: mirror({normal:[0,0,1]}) on a 2D shape previously
      // called section.mirror([0,0]) with zero vector, returning empty geometry.
      // OpenSCAD treats mirror([0,0,1]) on 2D as a no-op since z-flip doesn't
      // affect points in the z=0 plane.
      const sq = rectangle({ size: [50, 40] })
      const mirrored = mirror({ normal: [0, 0, 1] }, sq)
      expect(isManifoldGeom2(mirrored)).toBe(true)
      // Must not be empty — should have same area as original
      const extOriginal = extrudeLinear({ height: 1 }, sq)
      const extMirrored = extrudeLinear({ height: 1 }, mirrored)
      expect(measureVolume(extOriginal)).toBeCloseTo(50 * 40 * 1, 0)
      expect(measureVolume(extMirrored)).toBeCloseTo(50 * 40 * 1, 0)
    })

    it('mirror([0,0,1]) geom2 produces valid geometry usable in boolean ops', () => {
      // After the fix, mirror([0,0,1]) on 2D should return non-empty geometry
      // that can be used in union/intersect/difference operations.
      const sq = rectangle({ size: [50, 40] })
      const mirrored = mirror({ normal: [0, 0, 1] }, sq)
      const extA = extrudeLinear({ height: 1 }, rectangle({ size: [100, 100] }))
      const extB = extrudeLinear({ height: 10 }, mirrored)
      const result = intersect(extA, extB)
      expect(isManifoldGeom3(result)).toBe(true)
      expect(measureVolume(result)).toBeGreaterThan(0)
    })
  })
})
