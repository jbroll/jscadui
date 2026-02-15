import { describe, it, expect } from 'vitest'

// Import the runtime directly for unit testing
import j$ from '@jscadui/openscad-runtime'

/**
 * Unit tests for OpenSCAD runtime helpers
 */

describe('isTruthy', () => {
  describe('falsy values in OpenSCAD', () => {
    it('treats false as falsy', () => {
      expect(j$.isTruthy(false)).toBe(false)
    })

    it('treats undefined as falsy', () => {
      expect(j$.isTruthy(undefined)).toBe(false)
    })

    it('treats null as falsy', () => {
      expect(j$.isTruthy(null)).toBe(false)
    })

    it('treats 0 as falsy', () => {
      expect(j$.isTruthy(0)).toBe(false)
    })

    it('treats empty string as falsy', () => {
      expect(j$.isTruthy('')).toBe(false)
    })

    it('treats empty array as falsy (OpenSCAD specific)', () => {
      // This is the key difference from JavaScript!
      // In JS: [] is truthy
      // In OpenSCAD: [] is falsy
      expect(j$.isTruthy([])).toBe(false)
    })
  })

  describe('truthy values in OpenSCAD', () => {
    it('treats true as truthy', () => {
      expect(j$.isTruthy(true)).toBe(true)
    })

    it('treats positive numbers as truthy', () => {
      expect(j$.isTruthy(1)).toBe(true)
      expect(j$.isTruthy(42)).toBe(true)
      expect(j$.isTruthy(0.001)).toBe(true)
    })

    it('treats negative numbers as truthy', () => {
      expect(j$.isTruthy(-1)).toBe(true)
      expect(j$.isTruthy(-0.5)).toBe(true)
    })

    it('treats non-empty strings as truthy', () => {
      expect(j$.isTruthy('hello')).toBe(true)
      expect(j$.isTruthy(' ')).toBe(true)
    })

    it('treats non-empty arrays as truthy', () => {
      expect(j$.isTruthy([1])).toBe(true)
      expect(j$.isTruthy([0])).toBe(true) // Array with falsy element is still truthy
      expect(j$.isTruthy([[]])).toBe(true) // Array with empty array is still truthy
    })

    it('treats objects as truthy', () => {
      expect(j$.isTruthy({})).toBe(true)
      expect(j$.isTruthy({ a: 1 })).toBe(true)
    })
  })
})

describe('OpenSCAD semantics with isTruthy', () => {
  // These tests verify the expected behavior when isTruthy is used in conditionals

  describe('ternary with empty array', () => {
    it('should select else branch for empty array', () => {
      const arr: number[] = []
      // OpenSCAD: arr ? "yes" : "no" returns "no" for empty array
      const result = j$.isTruthy(arr) ? 'yes' : 'no'
      expect(result).toBe('no')
    })

    it('should select then branch for non-empty array', () => {
      const arr = [1, 2, 3]
      const result = j$.isTruthy(arr) ? 'yes' : 'no'
      expect(result).toBe('yes')
    })
  })

  describe('logical AND with empty array', () => {
    it('should short-circuit on empty array', () => {
      const arr: number[] = []
      // OpenSCAD: [] && x returns []
      const result = j$.isTruthy(arr) ? 'other' : arr
      expect(result).toEqual([])
    })
  })

  describe('logical OR with empty array', () => {
    it('should continue to second operand for empty array', () => {
      const arr: number[] = []
      // OpenSCAD: [] || "fallback" returns "fallback"
      const result = j$.isTruthy(arr) ? arr : 'fallback'
      expect(result).toBe('fallback')
    })
  })

  describe('if-else semantics', () => {
    it('should treat len(x) > 0 as truthy check pattern', () => {
      // Common OpenSCAD pattern: if (len(arr) > 0) is equivalent to if (arr)
      const arr: number[] = []
      const byLen = arr.length > 0
      const byTruthy = j$.isTruthy(arr)
      expect(byLen).toBe(byTruthy)
    })
  })
})
