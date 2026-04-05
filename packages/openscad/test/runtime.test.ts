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

describe('applyPositionalArgs', () => {
  it('returns vals unchanged when _arg0 is not in _opts', () => {
    const result = j$.applyPositionalArgs({ x: 1 }, [1, undefined, 3])
    expect(result).toEqual([1, undefined, 3])
  })

  it('maps _argN to undefined vals when _arg0 is present', () => {
    const _opts = { _arg0: 10, _arg1: 20, _arg2: 30 } as Record<string, unknown>
    const result = j$.applyPositionalArgs(_opts, [undefined, undefined, undefined])
    expect(result).toEqual([10, 20, 30])
  })

  it('preserves already-defined vals (named args take priority)', () => {
    const _opts = { _arg0: 10, _arg1: 20, x: 99 } as Record<string, unknown>
    // x was destructured as 99 from _opts.x, so vals[0]=99 (not undefined)
    const result = j$.applyPositionalArgs(_opts, [99, undefined])
    expect(result).toEqual([99, 20])
  })

  it('handles partial positional args', () => {
    const _opts = { _arg0: 10 } as Record<string, unknown>
    const result = j$.applyPositionalArgs(_opts, [undefined, undefined, undefined])
    // _arg1 and _arg2 don't exist, so undefined stays undefined
    expect(result).toEqual([10, undefined, undefined])
  })
})

describe('resolveParams', () => {
  it('keeps defined values, ignoring defaults', () => {
    const result = j$.resolveParams([10, 'hello', true], [1, 'default', false])
    expect(result).toEqual([10, 'hello', true])
  })

  it('applies defaults for undefined values', () => {
    const result = j$.resolveParams([undefined, undefined], [5, 'default'])
    expect(result).toEqual([5, 'default'])
  })

  it('applies defaults for EXPLICIT_UNDEF values', () => {
    const result = j$.resolveParams([j$.EXPLICIT_UNDEF, 10], [5, 99])
    expect(result).toEqual([5, 10])
  })

  it('uses undefined default for params without defaults', () => {
    const result = j$.resolveParams([undefined, j$.EXPLICIT_UNDEF], [undefined, undefined])
    expect(result).toEqual([undefined, undefined])
  })

  it('handles self-referencing defaults (outer variable reference)', () => {
    // Simulates: module foo(screw = screw) where outer screw = "M3"
    const outerScrew = 'M3'
    const result = j$.resolveParams([undefined], [outerScrew])
    expect(result).toEqual(['M3'])
  })

  it('mixed: some provided, some defaulted', () => {
    const result = j$.resolveParams([42, undefined, j$.EXPLICIT_UNDEF], [0, 'fallback', false])
    expect(result).toEqual([42, 'fallback', false])
  })
})

describe('resolveUndef', () => {
  it('converts EXPLICIT_UNDEF to undefined', () => {
    const result = j$.resolveUndef(1, j$.EXPLICIT_UNDEF, 3)
    expect(result).toEqual([1, undefined, 3])
  })

  it('leaves other values unchanged', () => {
    const result = j$.resolveUndef(1, 'hello', undefined, null)
    expect(result).toEqual([1, 'hello', undefined, null])
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

describe('withScope isolation', () => {
  it('empty withScope still isolates special var modifications', () => {
    // An empty-vars withScope MUST still push/pop a scope frame.
    // Without this, $fn modifications inside a module body leak to siblings,
    // causing geometry mismatches (5 BOSL2 + 10 NopSCADlib regressions).
    j$.resetScope()
    const original = j$.getSpecialVar('$fn')

    j$.withScope({}, () => {
      j$.setSpecialVar('$fn', 999)
      expect(j$.getSpecialVar('$fn')).toBe(999)
    })

    // After withScope returns, $fn must be restored to original value
    expect(j$.getSpecialVar('$fn')).toBe(original)
  })

  it('nested withScope scopes do not leak', () => {
    j$.resetScope()
    const original = j$.getSpecialVar('$fn')

    j$.withScope({ $fn: 32 }, () => {
      expect(j$.getSpecialVar('$fn')).toBe(32)

      j$.withScope({}, () => {
        j$.setSpecialVar('$fn', 64)
        expect(j$.getSpecialVar('$fn')).toBe(64)
      })

      // Inner modification should not leak to this scope
      expect(j$.getSpecialVar('$fn')).toBe(32)
    })

    expect(j$.getSpecialVar('$fn')).toBe(original)
  })
})

describe('hull empty/absent children guard', () => {
  it('returns undefined when all children are undefined', () => {
    // OpenSCAD hull() with no valid geometry produces nothing; JSCAD hull() throws.
    const result = j$.hull(undefined, undefined)
    expect(result).toBeUndefined()
  })

  it('returns undefined when all children are null', () => {
    const result = j$.hull(null, null)
    expect(result).toBeUndefined()
  })

  it('returns undefined when all children are NO_CHILD', () => {
    const result = j$.hull(j$.NO_CHILD, j$.NO_CHILD)
    expect(result).toBeUndefined()
  })

  it('returns undefined for mixed absent values', () => {
    const result = j$.hull(undefined, j$.NO_CHILD, null)
    expect(result).toBeUndefined()
  })
})

describe('polygon degenerate input guard', () => {
  it('returns undefined for empty points array instead of throwing', () => {
    // OpenSCAD silently ignores degenerate polygons. In JSCAD, polygon([]) used to throw
    // "polygon requires at least 3 points, got: []". Now we guard and return undefined.
    const result = j$.polygon({ points: [] as number[][], paths: undefined })
    expect(result).toBeUndefined()
  })

  it('returns undefined for fewer than 3 points', () => {
    const result = j$.polygon({ points: [[0, 0], [1, 1]] as number[][], paths: undefined })
    expect(result).toBeUndefined()
  })
})
