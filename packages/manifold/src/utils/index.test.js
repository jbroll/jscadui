import { describe, it, expect } from 'vitest'
import { isPath2, isNonZeroVector3 } from './index.js'

describe('utils', () => {
  describe('isPath2', () => {
    it('should return true for path2 objects', () => {
      const path2 = { points: [[0, 0], [1, 0], [1, 1]] }
      expect(isPath2(path2)).toBe(true)
    })

    it('should return false for geom2 objects (has sides)', () => {
      const geom2 = { points: [[0, 0]], sides: [[[0, 0], [1, 0]]] }
      expect(isPath2(geom2)).toBe(false)
    })

    it('should return falsy for null/undefined', () => {
      expect(isPath2(null)).toBeFalsy()
      expect(isPath2(undefined)).toBeFalsy()
    })

    it('should return false for objects without points', () => {
      expect(isPath2({ sides: [] })).toBe(false)
      expect(isPath2({})).toBe(false)
    })
  })

  describe('isNonZeroVector3', () => {
    it('should return false for [0,0,0]', () => {
      expect(isNonZeroVector3([0, 0, 0])).toBe(false)
    })

    it('should return true for vectors with any non-zero component', () => {
      expect(isNonZeroVector3([1, 0, 0])).toBe(true)
      expect(isNonZeroVector3([0, 1, 0])).toBe(true)
      expect(isNonZeroVector3([0, 0, 1])).toBe(true)
      expect(isNonZeroVector3([1, 2, 3])).toBe(true)
      expect(isNonZeroVector3([-1, 0, 0])).toBe(true)
    })
  })
})
