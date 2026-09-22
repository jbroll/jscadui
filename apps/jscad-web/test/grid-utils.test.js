import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

// grid-utils is CommonJS, loaded the same way the worker loads it
const gridUtils = (() => {
  const source = readFileSync(join(__dirname, '..', 'examples', 'lib', 'grid-utils.js'), 'utf-8')
  const module = { exports: {} }
  new Function('require', 'exports', 'module', source)(nodeRequire, module.exports, module)
  return module.exports
})()
const { failureMarker, normalizeAndPlace } = gridUtils
const jscad = nodeRequire('@jscad/modeling')
const { measureAggregateBoundingBox } = jscad.measurements

describe('failureMarker', () => {
  it('returns geometry', () => {
    const geoms = failureMarker()
    expect(Array.isArray(geoms)).toBe(true)
    expect(geoms.length).toBeGreaterThan(0)
  })

  it('has non-zero extent on every axis', () => {
    const [[x0, y0, z0], [x1, y1, z1]] = measureAggregateBoundingBox(...failureMarker())
    expect(x1 - x0).toBeGreaterThan(0)
    expect(y1 - y0).toBeGreaterThan(0)
    expect(z1 - z0).toBeGreaterThan(0)
  })

  it('is colorized so it stands out from real models', () => {
    expect(failureMarker().every(g => Array.isArray(g.color))).toBe(true)
  })

  it('survives normalizeAndPlace at the grid cell size', () => {
    const placed = normalizeAndPlace(failureMarker(), 30, -30, 51)
    expect(placed.length).toBeGreaterThan(0)

    const [[x0, y0, z0], [x1, y1, z1]] = measureAggregateBoundingBox(...placed)
    const longest = Math.max(x1 - x0, y1 - y0, z1 - z0)
    expect(longest).toBeCloseTo(51, 5)
    expect((x0 + x1) / 2).toBeCloseTo(30, 5)
    expect((y0 + y1) / 2).toBeCloseTo(-30, 5)
    expect((z0 + z1) / 2).toBeCloseTo(0, 5)
  })
})
