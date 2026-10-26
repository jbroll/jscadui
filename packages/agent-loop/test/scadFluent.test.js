import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { createScadExportsWrapper, wrapScadExports } from '../src/scadFluent.js'

const nodeRequire = createRequire(import.meta.url)
const jf = nodeRequire('@jbroll/jscad-fluent')
const { primitives } = nodeRequire('@jscad/modeling')

describe('wrapScadExports', () => {
  it('wraps a 3D and a 2D result and maps a list', () => {
    const exports = {
      block: (size) => primitives.cuboid({ size: [size, size, size] }),
      plate: () => primitives.square({ size: 4 }),
      both: () => [primitives.cuboid(), primitives.square()],
    }
    const wrapped = wrapScadExports(exports, jf)
    const block = wrapped.block(2)
    expect(block).toBeInstanceOf(jf.FluentGeom3)
    expect(block.translate([10, 0, 0]).polygons.length).toBe(6)
    expect(wrapped.plate()).toBeInstanceOf(jf.FluentGeom2)
    const [solid, flat] = wrapped.both()
    expect(solid).toBeInstanceOf(jf.FluentGeom3)
    expect(flat).toBeInstanceOf(jf.FluentGeom2)
    expect(exports.block(2)).not.toBeInstanceOf(jf.FluentGeom3)
  })

  it('leaves numbers, undefined and reserved exports alone', () => {
    const main = () => primitives.cuboid()
    const meta = [{ kind: 'module', name: 'block' }]
    const exports = { five: () => 5, nothing: () => undefined, main, $meta: meta, M3: 3 }
    exports.default = exports
    const wrapped = wrapScadExports(exports, jf)
    expect(wrapped.five()).toBe(5)
    expect(wrapped.nothing()).toBeUndefined()
    expect(wrapped.main).toBe(main)
    expect(wrapped.$meta).toBe(meta)
    expect(wrapped.M3).toBe(3)
    expect(wrapped.default).toBe(wrapped)
  })

  it('copies a getter without calling it', () => {
    let reads = 0
    const exports = Object.defineProperty({}, 'lazy', { get: () => ++reads, enumerable: true, configurable: true })
    const wrapped = wrapScadExports(exports, jf)
    expect(reads).toBe(0)
    expect(wrapped.lazy).toBe(1)
  })

  it('wraps a dim-3 tree node', () => {
    const seen = []
    const stub = {
      FluentGeom3: class { constructor(value) { seen.push(value) } },
      FluentGeom2: class {},
      isGeom3: () => false,
      isGeom2: () => false,
    }
    const node = { isTreeNode: true, dim: 3, op: 'cube' }
    const out = wrapScadExports({ part: () => node }, stub).part()
    expect(out).toBeInstanceOf(stub.FluentGeom3)
    expect(seen).toEqual([node])
  })
})

describe('createScadExportsWrapper', () => {
  const exports = { block: () => primitives.cuboid() }

  it('wraps for fluent code, the same copy each time', () => {
    const wrap = createScadExportsWrapper({ getApi: () => 'fluent', getFluent: () => jf })
    expect(wrap(exports).block()).toBeInstanceOf(jf.FluentGeom3)
    expect(wrap(exports)).toBe(wrap(exports))
  })

  it('passes the exports through for modeling code', () => {
    let api = 'fluent'
    const wrap = createScadExportsWrapper({ getApi: () => api, getFluent: () => jf })
    wrap(exports)
    api = 'modeling'
    expect(wrap(exports)).toBe(exports)
  })
})
