import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

// grid-utils is CommonJS, loaded the same way the worker loads it
const loadGridUtils = (req) => {
  const source = readFileSync(join(__dirname, '..', 'examples', 'lib', 'grid-utils.js'), 'utf-8')
  const module = { exports: {} }
  new Function('require', 'exports', 'module', source)(req, module.exports, module)
  return module.exports
}
const gridUtils = loadGridUtils(nodeRequire)
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

describe('normalizeAndPlace on the manifold engine', () => {
  let manifold, placeWithManifold
  beforeAll(async () => {
    manifold = await import('@jscadui/manifold')
    await manifold.init()
    placeWithManifold = loadGridUtils(name => name === '@jscad/modeling' ? manifold : nodeRequire(name)).normalizeAndPlace
  })

  const transformResults = (run) => {
    let proto = manifold.cube({ size: 1 }).manifold
    while (!Object.hasOwn(proto, 'translate')) proto = Object.getPrototypeOf(proto)
    const made = []
    const spies = ['translate', 'scale'].map(name => {
      const orig = proto[name]
      return vi.spyOn(proto, name).mockImplementation(function (...args) {
        const out = orig.apply(this, args)
        made.push(out)
        return out
      })
    })
    try {
      return { result: run(), made }
    } finally {
      spies.forEach(s => s.mockRestore())
    }
  }

  it('frees the intermediate transforms and keeps the placed result', () => {
    const cell = manifold.cube({ size: 10, center: [5, 5, 5] })
    const { result: [placed], made } = transformResults(() => placeWithManifold([cell], 60, 0, 51))

    expect(made).toHaveLength(3)
    expect(made.slice(0, 2).every(m => m.isDeleted())).toBe(true)
    expect(placed.manifold).toBe(made[2])
    expect(placed.volume()).toBeCloseTo(51 ** 3, 3)
    const [[x0, , z0], [x1, , z1]] = placed.boundingBox()
    expect((x0 + x1) / 2).toBeCloseTo(60, 5)
    expect((z0 + z1) / 2).toBeCloseTo(0, 5)
  })

  it('leaves the cell geometry alone, since a model may reuse it', () => {
    const cell = manifold.cube({ size: 10 })
    placeWithManifold([cell], 0, 0, 51)
    expect(cell.manifold.isDeleted()).toBe(false)
    expect(cell.volume()).toBeCloseTo(1000, 5)
  })
})
