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
  rotate,
  scale,
  measureBoundingBox,
  measureVolume,
  isManifoldGeom3
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
})
