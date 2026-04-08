import { describe, it, expect } from 'vitest'

// Import the runtime directly for unit testing
import j$ from '@jscadui/openscad-runtime'
import { _cylinder, _sphere } from '@jscadui/openscad-runtime'

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

describe('trunc (safe array index)', () => {
  it('truncates positive float', () => {
    expect(j$.trunc(1.7)).toBe(1)
  })
  it('truncates negative float', () => {
    expect(j$.trunc(-1.7)).toBe(-1)
  })
  it('returns 0 for integer 0', () => {
    expect(j$.trunc(0)).toBe(0)
  })
  it('returns NaN for empty array (prevents Math.trunc([]) === 0 coercion)', () => {
    // OpenSCAD: arr[[]] returns undef; JS Math.trunc([]) coerces to 0 → returns arr[0].
    // j$.trunc guards this: returns NaN so arr?.[NaN] === undefined.
    expect(j$.trunc([])).toBeNaN()
  })
  it('unwraps 1-element array [n] to n (OpenSCAD search([x],y)[0] pattern)', () => {
    // OpenSCAD: arr[search([key], arr)[0]] where search returns [[idx]].
    // search([key],arr)[0] = [idx]; arr[[idx]] = arr[idx] in OpenSCAD.
    expect(j$.trunc([0])).toBe(0)
    expect(j$.trunc([3])).toBe(3)
  })
  it('returns NaN for multi-element array', () => {
    expect(j$.trunc([0, 1])).toBeNaN()
  })
  it('returns NaN for undefined', () => {
    expect(j$.trunc(undefined)).toBeNaN()
  })
  it('returns NaN for null', () => {
    expect(j$.trunc(null)).toBeNaN()
  })
  it('returns NaN for string', () => {
    expect(j$.trunc('5')).toBeNaN()
  })
})

describe('eq scalar vs 1-element list coercion', () => {
  // OpenSCAD _find_eq returns [k] (1-element list) from search([x], list)[0].
  // hashmap_del does `loop_var != [k]` which needs to be false for the target index.
  // _eq handles number == [number] to replicate OpenSCAD's implicit index unwrap.
  it('number equals 1-element number list', () => {
    expect(j$.eq(0, [0])).toBe(true)
    expect(j$.eq(3, [3])).toBe(true)
    expect(j$.eq([0], 0)).toBe(true)
  })
  it('number does not equal different 1-element list', () => {
    expect(j$.eq(0, [1])).toBe(false)
    expect(j$.eq(1, [0])).toBe(false)
  })
  it('number does not equal multi-element list', () => {
    expect(j$.eq(0, [0, 1])).toBe(false)
    expect(j$.eq(0, [])).toBe(false)
  })
})

describe('search function', () => {
  it('finds scalar in flat list', () => {
    expect(j$.search(5, [1, 2, 5, 3])).toEqual([2])
  })

  it('finds string in list', () => {
    expect(j$.search('a', ['a', 'b', 'c'])).toEqual([0])
  })

  it('finds scalar in column 0 of table (scalar keys)', () => {
    const table = [[1, 'a'], [5, 'b'], [3, 'c']]
    expect(j$.search(5, table)).toEqual([1])
    // List needle always returns list of lists: [[k]] when found
    expect(j$.search([5], table)).toEqual([[1]])
  })

  it('finds array key in column 0 of table (array keys) — hashmap_get pattern', () => {
    // This is the critical case: bucket = [[[key], val], ...]
    // OpenSCAD: search uses column 0 by default, so column 0 = [key]
    // Compare [key] with [key] → deep equal → found
    // List needle returns [[k]] when found, [[]] when not found
    const bucket: [number[], string][] = [[[2, 3, 1, 2016], 'circ_val_a'], [[0, 1, 3, 34], 'circ_val_b']]
    expect(j$.search([[2, 3, 1, 2016]], bucket)).toEqual([[0]])
    expect(j$.search([[0, 1, 3, 34]], bucket)).toEqual([[1]])
    expect(j$.search([[9, 9, 9, 9]], bucket)).toEqual([[]])
  })

  it('searching for array in flat vector list compares full elements (OpenSCAD semantics)', () => {
    // When needle is array and source[i][0] is a scalar (not array), OpenSCAD compares
    // the needle against the FULL source element (not column 0).
    // This is needed for contains(badTriangles, t) in dotSCAD's Delaunay triangulation.
    // List needle returns list of lists: [[k]] when found, [[]] when not found
    const vectors = [[1, 2], [3, 4], [5, 6]]
    // [3,4] vs [1,2]: no; [3,4] vs [3,4]: found at index 1
    expect(j$.search([[3, 4]], vectors)).toEqual([[1]])
    // [9,9] not in list → [[]] (so contains() returns false via _eq([[[]],[[]]]))
    expect(j$.search([[9, 9]], vectors)).toEqual([[]])
  })

  it('returns multiple results with num_returns=0', () => {
    expect(j$.search(1, [1, 2, 1, 3], 0)).toEqual([0, 2])
  })
})

describe('min/max with vectors', () => {
  it('returns component-wise min of vector array', () => {
    expect(j$.min([[1, 2], [3, 0]])).toEqual([1, 0])
    expect(j$.min([[5, 3, 8], [1, 9, 2]])).toEqual([1, 3, 2])
  })

  it('returns scalar min for flat number array', () => {
    expect(j$.min([5, 3, 8])).toBe(3)
  })

  it('returns component-wise max of vector array', () => {
    expect(j$.max([[1, 2], [3, 0]])).toEqual([3, 2])
  })

  it('returns scalar max for flat number array', () => {
    expect(j$.max([5, 3, 8])).toBe(8)
  })
})

describe('rands MT19937 output', () => {
  // Verify rands() produces stable values with our MT19937 implementation.
  // Uses generate_canonical formula: g0/2^64 + g1/2^32 (matches libstdc++ and libc++).

  it('rands(0, 10, 1, 42) produces stable value', () => {
    j$.resetRng()
    const result = j$.rands(0, 10, 1, 42)
    expect(result[0]).toBeCloseTo(7.96542984287846, 5)
  })

  it('rands(0, 256, 1, 51) produces stable value (Perlin noise seed)', () => {
    j$.resetRng()
    const result = j$.rands(0, 256, 1, 51)
    expect(result[0]).toBeCloseTo(83.74035988305398, 5)
  })

  it('rands(0, 23, 1, 15) produces stable value (maze seed)', () => {
    j$.resetRng()
    const result = j$.rands(0, 23, 1, 15)
    expect(result[0]).toBeCloseTo(18.712350373743757, 5)
  })

  it('round(rands(0, 23, 1, 15)[0]) gives stable direction index', () => {
    j$.resetRng()
    const result = j$.rands(0, 23, 1, 15)
    expect(Math.round(result[0])).toBe(19)
  })
})

describe('rands float seed (Python hash conversion)', () => {
  // OpenSCAD converts float seeds via Python's _Py_HashDouble before seeding mt19937.
  // hash(1.0)=1, hash(2.0)=2 (integers map to themselves), but hash(1.5)≠hash(1.0).
  // Reference values verified against OpenSCAD 2026.01.24.

  it('integer .0 seeds are unchanged: rands(0,1,1,1.0) same as seed=1', () => {
    j$.resetRng()
    expect(j$.rands(0, 1, 1, 1.0)[0]).toBeCloseTo(0.997185, 5)
  })

  it('rands(0,1,1,1.5) uses hash seed (not truncation to 1)', () => {
    j$.resetRng()
    const result = j$.rands(0, 1, 3, 1.5)
    expect(result[0]).toBeCloseTo(0.776800, 5)  // OpenSCAD: 0.7768
    expect(result[1]).toBeCloseTo(0.024931, 5)  // OpenSCAD: 0.0249309
    expect(result[2]).toBeCloseTo(0.348639, 5)  // OpenSCAD: 0.348639
  })

  it('rands(0,1,2,2.5) uses hash seed', () => {
    j$.resetRng()
    const result = j$.rands(0, 1, 2, 2.5)
    expect(result[0]).toBeCloseTo(0.932255, 5)  // OpenSCAD: 0.932255
    expect(result[1]).toBeCloseTo(0.167864, 5)  // OpenSCAD: 0.167864
  })

  it('rands(0,1,1,0.5) uses hash seed', () => {
    j$.resetRng()
    expect(j$.rands(0, 1, 1, 0.5)[0]).toBeCloseTo(0.421193, 5)  // OpenSCAD: 0.421193
  })

  it('rands(0,256,1,115.14753...) matches OpenSCAD Perlin noise seed', () => {
    j$.resetRng()
    // This seed appears in dotSCAD nz_perlin2 — the fix enables island_maze etc.
    expect(j$.rands(0, 256, 1, 115.14753815281719)[0]).toBeCloseTo(103.639, 3)
  })

  it('negative float seeds work correctly', () => {
    j$.resetRng()
    expect(j$.rands(0, 1, 1, -1.5)[0]).toBeCloseTo(0.284617, 5)  // OpenSCAD: 0.284617
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

describe('cylinder negative/NaN radius guard', () => {
  // OpenSCAD: cylinder with negative radius produces empty geometry.
  // JSCAD's cylinder() with negative radius creates malformed geometry that breaks
  // boolean operations — we return undefined instead so _subtract() ignores it.

  it('returns undefined for negative r', () => {
    expect(_cylinder({ r: -5, h: 10 })).toBeUndefined()
  })

  it('returns undefined for negative r1', () => {
    expect(_cylinder({ r1: -1, r2: 5, h: 10 })).toBeUndefined()
  })

  it('returns undefined for negative r2', () => {
    expect(_cylinder({ r1: 5, r2: -1, h: 10 })).toBeUndefined()
  })

})

describe('sphere negative radius guard', () => {
  // OpenSCAD: sphere with negative radius produces empty geometry.

  it('returns undefined for negative r', () => {
    expect(_sphere({ r: -3 })).toBeUndefined()
  })
})
