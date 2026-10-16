import { describe, expect, it } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const shim = require('./v1shim.cjs')

describe('v1shim (vendored V1 compat on fluent)', () => {
  it('exposes the V1 functional surface', () => {
    for (const name of ['color', 'cube', 'cylinder', 'difference', 'intersection',
      'linear_extrude', 'polygon', 'rotate', 'sphere', 'translate', 'union']) {
      expect(typeof shim[name], name).toBe('function')
    }
  })

  it('runs the upstream README step-1 example', () => {
    const { difference, intersection, union, cube, sphere } = shim
    const out = union(
      difference(
        cube({ size: 3, center: true }),
        sphere({ r: 2, center: true })
      ),
      intersection(
        sphere({ r: 1.3, center: true }),
        cube({ size: 2.1, center: true })
      )
    )
    expect(out).toBeDefined()
    expect(out.polygons.length).toBeGreaterThan(0)
  })

  it('accepts V1 positional polygon points', () => {
    const poly = shim.polygon([[0, 0], [1, 0], [0, 1]])
    expect(poly.sides.length).toBeGreaterThan(0)
  })

  it('chains like V1 (table_4pieds core: subtract, extrude, mirror, bounds)', () => {
    const pTrous = shim.polygon([[16, 32], [22, 24], [25, 0]])
    const pFond = shim.polygon([[0, 0], [32, 0], [32, 32], [0, 32]])
    let p = pFond.subtract(pTrous)
    p = p.extrude({ offset: [0, 0, 1] })
    p = p.union(p.mirroredX())
    const b = p.getBounds()
    expect(b[0].y).toBeDefined()
    p = p.translate([0, -b[0].y, 0])
    expect(p.polygons.length).toBeGreaterThan(0)
  })

  it('supports V1 rotate (degrees) and translate globals', () => {
    const { cube, rotate, translate } = shim
    const out = translate([5, 0, 0], rotate([0, 0, 90], cube({ size: 2, center: true })))
    expect(out.polygons.length).toBeGreaterThan(0)
  })
})
