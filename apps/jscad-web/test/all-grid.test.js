import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

const examplesDir = join(__dirname, '..', 'examples')
const gridPath = join(examplesDir, 'openscad', 'text', 'ALL.js')

const jscad = nodeRequire('@jscad/modeling')
const { cube } = jscad.primitives
const { measureAggregateBoundingBox } = jscad.measurements

const loadCjs = (path, req) => {
  const module = { exports: {} }
  new Function('require', 'exports', 'module', readFileSync(path, 'utf-8'))(
    req, module.exports, module,
  )
  return module.exports
}

/**
 * Run a generated ALL.js with every model stubbed out, except the ones named
 * in `broken`, whose require throws.
 */
const runGrid = (broken = []) => {
  const req = (name) => {
    if (name.endsWith('grid-utils.js')) {
      return loadCjs(resolve(dirname(gridPath), name), nodeRequire)
    }
    if (broken.includes(name)) throw new Error(`boom in ${name}`)
    return { main: () => cube({ size: 10 }) }
  }
  return loadCjs(gridPath, req).main({})
}

describe('generated ALL.js grid', () => {
  it('renders every cell when nothing fails', () => {
    const geoms = runGrid()
    expect(geoms.length).toBe(11)
  })

  it('keeps the other cells when one model throws', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const geoms = runGrid(['./text-fonts.scad'])
      expect(geoms.filter(g => !g.color).length).toBe(10)
    } finally {
      errors.mockRestore()
    }
  })

  it('places the marker in the failed cell, at the cell size', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let geoms
    try {
      geoms = runGrid(['./text-fonts.scad'])
    } finally {
      errors.mockRestore()
    }

    const marker = geoms.filter(g => g.color)
    expect(marker.length).toBeGreaterThan(0)

    const [[x0, y0, z0], [x1, y1, z1]] = measureAggregateBoundingBox(...marker)
    expect(Math.max(x1 - x0, y1 - y0, z1 - z0)).toBeCloseTo(51, 5)
    expect((z0 + z1) / 2).toBeCloseTo(0, 5)

    // Cell 3 of 11: grid is 4 wide, spacing 60, centred on the origin
    expect((x0 + x1) / 2).toBeCloseTo(90, 5)
  })

  it('reports each failure and a summary for the test harness', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let lines
    try {
      runGrid(['./text-fonts.scad', './text-sizes.scad'])
      lines = errors.mock.calls.map(args => args.join(' '))
    } finally {
      errors.mockRestore()
    }

    expect(lines).toContain('ALL: FAILED ./text-fonts.scad: boom in ./text-fonts.scad')
    expect(lines).toContain('ALL: FAILED ./text-sizes.scad: boom in ./text-sizes.scad')
    expect(lines).toContain('ALL: 2/11 models failed: ./text-fonts.scad ./text-sizes.scad')
  })
})
