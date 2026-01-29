import { describe, expect, it } from 'vitest'

import { boundingBox, computeBounds, computeEntityBounds } from './bounds.js'

describe('boundingBox', () => {
  it('should return zero bounds for empty array', () => {
    const result = boundingBox([])
    expect(result).toEqual([[0, 0, 0], [0, 0, 0]])
  })

  it('should return zero bounds for null input', () => {
    const result = boundingBox(null)
    expect(result).toEqual([[0, 0, 0], [0, 0, 0]])
  })

  it('should compute bounds for flat array', () => {
    const positions = new Float32Array([
      0, 0, 0,
      10, 0, 0,
      0, 10, 0,
      0, 0, 10
    ])

    const result = boundingBox(positions)

    expect(result[0]).toEqual([0, 0, 0]) // min
    expect(result[1]).toEqual([10, 10, 10]) // max
  })

  it('should compute bounds for nested array', () => {
    const positions = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10]
    ]

    const result = boundingBox(positions)

    expect(result[0]).toEqual([0, 0, 0]) // min
    expect(result[1]).toEqual([10, 10, 10]) // max
  })

  it('should handle negative coordinates', () => {
    const positions = new Float32Array([
      -5, -5, -5,
      5, 5, 5
    ])

    const result = boundingBox(positions)

    expect(result[0]).toEqual([-5, -5, -5]) // min
    expect(result[1]).toEqual([5, 5, 5]) // max
  })

  it('should handle single point', () => {
    const positions = new Float32Array([1, 2, 3])

    const result = boundingBox(positions)

    expect(result[0]).toEqual([1, 2, 3])
    expect(result[1]).toEqual([1, 2, 3])
  })
})

describe('computeBounds', () => {
  it('should return zero bounds for empty array', () => {
    const result = computeBounds([])

    expect(result.min).toEqual([0, 0, 0])
    expect(result.max).toEqual([0, 0, 0])
    expect(result.center).toEqual([0, 0, 0])
    expect(result.size).toEqual([0, 0, 0])
    expect(result.dia).toBe(0)
  })

  it('should compute bounds for single geometry', () => {
    const geometry = {
      positions: new Float32Array([
        0, 0, 0,
        10, 0, 0,
        0, 10, 0,
        0, 0, 10
      ])
    }

    const result = computeBounds([geometry])

    expect(result.min).toEqual([0, 0, 0])
    expect(result.max).toEqual([10, 10, 10])
    expect(result.center[0]).toBeCloseTo(5)
    expect(result.center[1]).toBeCloseTo(5)
    expect(result.center[2]).toBeCloseTo(5)
    expect(result.size).toEqual([10, 10, 10])
    expect(result.dia).toBeGreaterThan(0)
  })

  it('should compute combined bounds for multiple geometries', () => {
    const geom1 = {
      positions: new Float32Array([0, 0, 0, 5, 5, 5])
    }
    const geom2 = {
      positions: new Float32Array([10, 10, 10, 20, 20, 20])
    }

    const result = computeBounds([geom1, geom2])

    expect(result.min).toEqual([0, 0, 0])
    expect(result.max).toEqual([20, 20, 20])
    expect(result.center[0]).toBeCloseTo(10)
    expect(result.center[1]).toBeCloseTo(10)
    expect(result.center[2]).toBeCloseTo(10)
  })

  it('should handle geometry with transforms', () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      // Translation transform: move 10 units on x
      transforms: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        10, 0, 0, 1
      ]
    }

    const result = computeBounds([geometry])

    // Bounds should be transformed
    expect(result.min[0]).toBeCloseTo(10)
    expect(result.max[0]).toBeCloseTo(11)
  })

  it('should skip null or invalid geometries', () => {
    const validGeom = {
      positions: new Float32Array([0, 0, 0, 10, 10, 10])
    }

    const result = computeBounds([null, validGeom, undefined, {}])

    expect(result.min).toEqual([0, 0, 0])
    expect(result.max).toEqual([10, 10, 10])
  })

  it('should compute diameter correctly', () => {
    // Unit cube centered at origin
    const geometry = {
      positions: new Float32Array([
        -1, -1, -1,
        1, 1, 1
      ])
    }

    const result = computeBounds([geometry])

    // Diameter should be distance from center to corner
    // Center is at (0,0,0), corner at (1,1,1)
    // Distance = sqrt(1 + 1 + 1) = sqrt(3) ≈ 1.732
    expect(result.dia).toBeCloseTo(Math.sqrt(3), 3)
  })
})

describe('computeEntityBounds', () => {
  it('should return zero bounds for empty array', () => {
    const result = computeEntityBounds([])

    expect(result.min).toEqual([0, 0, 0])
    expect(result.max).toEqual([0, 0, 0])
    expect(result.dia).toBe(0)
  })

  it('should compute bounds from entities', () => {
    const entities = [
      {
        geometry: {
          positions: new Float32Array([0, 0, 0, 10, 10, 10])
        }
      },
      {
        geometry: {
          positions: new Float32Array([20, 20, 20, 30, 30, 30])
        }
      }
    ]

    const result = computeEntityBounds(entities)

    expect(result.min).toEqual([0, 0, 0])
    expect(result.max).toEqual([30, 30, 30])
    expect(result.center[0]).toBeCloseTo(15)
  })

  it('should skip entities without geometry', () => {
    const entities = [
      { geometry: { positions: new Float32Array([0, 0, 0, 10, 10, 10]) } },
      { noGeometry: true },
      null
    ]

    const result = computeEntityBounds(entities)

    expect(result.min).toEqual([0, 0, 0])
    expect(result.max).toEqual([10, 10, 10])
  })

  it('should include transforms from geometry', () => {
    const entities = [
      {
        geometry: {
          positions: new Float32Array([0, 0, 0, 1, 1, 1]),
          transforms: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            100, 0, 0, 1
          ]
        }
      }
    ]

    const result = computeEntityBounds(entities)

    expect(result.min[0]).toBeCloseTo(100)
    expect(result.max[0]).toBeCloseTo(101)
  })
})
