import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import jscad from '@jscad/modeling'
import { init, text2d, text2dAsync, resolveFont, registerFonts, listFonts, STATIC_FONT_MAP } from '../src/index.js'

// A TTF font available in the repo (no network needed)
const OPEN_SANS_TTF = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/jscad-web/jscad/packages/desktop/assets/fonts/Open_Sans/OpenSans-Regular.ttf'
)

beforeAll(() => {
  init(jscad)
})

describe('text2d (Hershey mode)', () => {
  it('returns null for empty string', () => {
    const result = text2d('')
    expect(result).toBeNull()
  })

  it('renders single character to a geom2', () => {
    const result = text2d('A', { size: 10 })
    expect(result).not.toBeNull()
    // geom2 has a 'sides' property
    expect(jscad.geometries.geom2.toSides(result).length).toBeGreaterThan(0)
  })

  it('renders multi-character string', () => {
    const result = text2d('Hello', { size: 10 })
    expect(result).not.toBeNull()
    expect(jscad.geometries.geom2.toSides(result).length).toBeGreaterThan(0)
  })

  it('scales with size parameter', () => {
    const small = text2d('A', { size: 5 })
    const large = text2d('A', { size: 20 })

    const [smallMin, smallMax] = jscad.measurements.measureBoundingBox(small)
    const [largeMin, largeMax] = jscad.measurements.measureBoundingBox(large)

    const smallHeight = smallMax[1] - smallMin[1]
    const largeHeight = largeMax[1] - largeMin[1]

    expect(largeHeight).toBeGreaterThan(smallHeight)
  })

  it('can be extruded', () => {
    const text = text2d('Hi', { size: 10 })
    const extruded = jscad.extrusions.extrudeLinear({ height: 5 }, text)
    expect(extruded).not.toBeNull()
    expect(jscad.geometries.geom3.toPolygons(extruded).length).toBeGreaterThan(0)
  })

  describe('halign', () => {
    it('left-aligned starts at x >= 0', () => {
      const result = text2d('Hi', { size: 10, halign: 'left' })
      const [min] = jscad.measurements.measureBoundingBox(result)
      expect(min[0]).toBeGreaterThanOrEqual(-1)  // allow small numerical error
    })

    it('center-aligned is symmetric around x=0', () => {
      const result = text2d('|||', { size: 10, halign: 'center' })
      const [min, max] = jscad.measurements.measureBoundingBox(result)
      // |min[0]| ≈ max[0] (not perfect due to stroke width)
      expect(Math.abs(Math.abs(min[0]) - Math.abs(max[0]))).toBeLessThan(2)
    })

    it('right-aligned ends near x=0', () => {
      const result = text2d('Hi', { size: 10, halign: 'right' })
      const [, max] = jscad.measurements.measureBoundingBox(result)
      expect(max[0]).toBeLessThanOrEqual(1)  // right edge near 0
    })
  })

  describe('valign', () => {
    it('baseline puts geometry above y=0 (mostly)', () => {
      const result = text2d('A', { size: 10, valign: 'baseline' })
      const [, max] = jscad.measurements.measureBoundingBox(result)
      expect(max[1]).toBeGreaterThan(0)
    })

    it('top shifts geometry down (max y < baseline max y)', () => {
      const baseline = text2d('A', { size: 10, valign: 'baseline' })
      const top = text2d('A', { size: 10, valign: 'top' })

      const [, baselineMax] = jscad.measurements.measureBoundingBox(baseline)
      const [, topMax] = jscad.measurements.measureBoundingBox(top)

      expect(topMax[1]).toBeLessThan(baselineMax[1])
    })

    it('center is between top and bottom', () => {
      const top = text2d('A', { size: 10, valign: 'top' })
      const center = text2d('A', { size: 10, valign: 'center' })
      const bottom = text2d('A', { size: 10, valign: 'bottom' })

      const [, topMax] = jscad.measurements.measureBoundingBox(top)
      const [, centerMax] = jscad.measurements.measureBoundingBox(center)
      const [, bottomMax] = jscad.measurements.measureBoundingBox(bottom)

      // top shifts text down most (top of text at y=0) → lowest max y
      // bottom shifts text up most (bottom at y=0) → highest max y
      // center is between them
      expect(topMax[1]).toBeLessThan(centerMax[1])
      expect(centerMax[1]).toBeLessThan(bottomMax[1])
    })
  })

  it('spacing multiplier increases character spacing', () => {
    const normal = text2d('Hi', { size: 10, spacing: 1 })
    const wide = text2d('Hi', { size: 10, spacing: 2 })

    const [, normalMax] = jscad.measurements.measureBoundingBox(normal)
    const [, wideMax] = jscad.measurements.measureBoundingBox(wide)

    expect(wideMax[0]).toBeGreaterThan(normalMax[0])
  })

  it('rtl direction reverses text', () => {
    // Both should produce geometry (hard to test exact reversal without font metrics)
    const ltr = text2d('AB', { size: 10, direction: 'ltr' })
    const rtl = text2d('AB', { size: 10, direction: 'rtl' })
    expect(ltr).not.toBeNull()
    expect(rtl).not.toBeNull()
  })
})

describe('text2d (string + options overload)', () => {
  it('accepts string as first argument', () => {
    const result = text2d('Test', { size: 10 })
    expect(result).not.toBeNull()
  })

  it('accepts options object as first argument', () => {
    const result = text2d({ text: 'Test', size: 10 })
    expect(result).not.toBeNull()
  })
})

describe('text2dAsync (TTF mode)', () => {
  it('is exported and is a function', () => {
    expect(typeof text2dAsync).toBe('function')
  })

  it('returns null for empty string', async () => {
    const result = await text2dAsync('')
    expect(result).toBeNull()
  })

  it('renders Hershey text (no font arg)', async () => {
    const result = await text2dAsync('Hello', { size: 10 })
    expect(result).not.toBeNull()
    expect(jscad.geometries.geom2.toSides(result).length).toBeGreaterThan(0)
  })
})

describe('text2d (TTF mode - synchronous, file path)', () => {
  it('loads TTF font from file path synchronously', () => {
    const result = text2d('A', { size: 10, font: OPEN_SANS_TTF })
    expect(result).not.toBeNull()
    expect(jscad.geometries.geom2.toSides(result).length).toBeGreaterThan(0)
  })

  it('caches the font on subsequent calls', () => {
    // Both calls should succeed (second uses cache)
    const r1 = text2d('B', { size: 10, font: OPEN_SANS_TTF })
    const r2 = text2d('B', { size: 10, font: OPEN_SANS_TTF })
    expect(r1).not.toBeNull()
    expect(r2).not.toBeNull()
  })

  it('renders multi-character string with TTF font', () => {
    const result = text2d('Hello', { size: 12, font: OPEN_SANS_TTF })
    expect(result).not.toBeNull()
    expect(jscad.geometries.geom2.toSides(result).length).toBeGreaterThan(0)
  })

  it('respects halign with TTF font', () => {
    const left = text2d('Hi', { size: 10, font: OPEN_SANS_TTF, halign: 'left' })
    const right = text2d('Hi', { size: 10, font: OPEN_SANS_TTF, halign: 'right' })
    const [leftMin] = jscad.measurements.measureBoundingBox(left)
    const [, rightMax] = jscad.measurements.measureBoundingBox(right)
    expect(leftMin[0]).toBeGreaterThanOrEqual(-1)
    expect(rightMax[0]).toBeLessThanOrEqual(1)
  })

  it('also accepts ArrayBuffer for TTF data', async () => {
    const { readFile } = await import('node:fs/promises')
    const buf = await readFile(OPEN_SANS_TTF)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const result = text2d('A', { size: 10, font: ab })
    expect(result).not.toBeNull()
    expect(jscad.geometries.geom2.toSides(result).length).toBeGreaterThan(0)
  })
})

describe('FontMap', () => {
  it('STATIC_FONT_MAP contains Liberation Sans', () => {
    // Node.js: bundled LiberationSans-Regular.ttf; Browser: CDN URL
    const value = STATIC_FONT_MAP['Liberation Sans']
    expect(typeof value).toBe('string')
    expect(value).toMatch(/LiberationSans-Regular\.ttf$/i)
  })

  it('resolveFont passes through URLs unchanged', () => {
    const url = 'https://example.com/font.ttf'
    expect(resolveFont(url)).toBe(url)
  })

  it('resolveFont passes through file paths unchanged', () => {
    expect(resolveFont('/usr/share/fonts/myfont.ttf')).toBe('/usr/share/fonts/myfont.ttf')
    expect(resolveFont('./fonts/myfont.ttf')).toBe('./fonts/myfont.ttf')
    expect(resolveFont('file:///fonts/myfont.ttf')).toBe('file:///fonts/myfont.ttf')
  })

  it('resolveFont looks up known font names', () => {
    const url = resolveFont('Liberation Sans')
    expect(typeof url).toBe('string')
    expect(url).toContain('ttf')

    const boldUrl = resolveFont('Liberation Sans:style=Bold')
    expect(boldUrl).toContain('Bold')
    expect(boldUrl).not.toBe(url)
  })

  it('resolveFont throws for unknown font names', () => {
    expect(() => resolveFont('UnknownFontXYZ')).toThrow(/not found/)
    expect(() => resolveFont('UnknownFontXYZ')).toThrow(/Available font families/)
  })

  it('registerFonts adds entries that resolveFont can find', () => {
    registerFonts({ 'My Custom Font': 'https://example.com/custom.ttf' })
    expect(resolveFont('My Custom Font')).toBe('https://example.com/custom.ttf')
  })

  it('listFonts returns all registered font names', () => {
    const fonts = listFonts()
    expect(fonts).toContain('Liberation Sans')
    expect(fonts).toContain('Roboto')
    expect(fonts).toContain('Noto Sans')
    expect(fonts).toContain('My Custom Font')
  })
})

describe('text2d TTF geometry correctness', () => {
  it('TTF text is above baseline (Y-up convention)', () => {
    // Verify opentype.js Y-down screen coords are converted to JSCAD Y-up.
    // 'A' at size=10 with valign='baseline' should sit above y=0.
    const a = text2d('A', { size: 10, font: OPEN_SANS_TTF, valign: 'baseline' })
    const [min, max] = jscad.measurements.measureBoundingBox(a)
    // Top of 'A' should be clearly above baseline
    expect(max[1]).toBeGreaterThan(5)
    // Bottom of 'A' should be at or just below baseline (Open Sans 'A' has no descender)
    expect(min[1]).toBeGreaterThan(-2)
  })

  it('TTF "O" has a hole (inner ring present)', () => {
    // 'O' has two contours: outer oval and inner oval (hole).
    // 'I' has a single rectangular contour (no hole).
    // So toSides('O') should return more edges than toSides('I').
    const o = text2d('O', { size: 20, font: OPEN_SANS_TTF })
    const letter_i = text2d('I', { size: 20, font: OPEN_SANS_TTF })
    const sidesO = jscad.geometries.geom2.toSides(o).length
    const sidesI = jscad.geometries.geom2.toSides(letter_i).length
    // 'O' outer ring + inner hole should produce significantly more sides than 'I'
    expect(sidesO).toBeGreaterThan(sidesI)
  })
})
