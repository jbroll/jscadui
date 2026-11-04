import { afterEach, describe, expect, it } from 'vitest'
import { CAPTURES, exportParts } from '../src_frame/exportParts.js'
import { CAPTURES as PAGE_CAPTURES } from '../src/projectExport.js'
import modeling from '@jscad/modeling'

const { geom2, geom3, path2 } = modeling.geometries

const toSolids = async (value) => value
const solid = (id, extra) => ({ id, polygons: [{}], ...extra })
const serialize = (solids) => ({ data: [new Uint8Array([solids.length]).buffer, new Uint8Array(solids.map((s) => s.id)).buffer] })

describe('exportParts', () => {
  afterEach(() => {
    delete globalThis[CAPTURES]
  })

  it('names the same global the page export script fills', () => {
    expect(CAPTURES).toBe(PAGE_CAPTURES)
  })

  it('serializes each capture in call order, its chunks joined', async () => {
    globalThis[CAPTURES] = [
      { maker: 'makeA', file: 'a.js', value: [solid(7), solid(8)] },
      { maker: 'makeB', file: 'b.js', value: [solid(9)] },
    ]

    const { parts } = await exportParts({ toSolids, serialize })

    expect(parts).toEqual([
      { maker: 'makeA', file: 'a.js', data: new Uint8Array([2, 7, 8]) },
      { maker: 'makeB', file: 'b.js', data: new Uint8Array([1, 9]) },
    ])
  })

  it('drops a capture with no exportable geometry', async () => {
    globalThis[CAPTURES] = [
      { maker: 'makeA', file: 'a.js', value: [] },
      { maker: 'makeB', file: 'b.js', value: [solid(1, { previewOnly: true })] },
      { maker: 'makeC', file: 'c.js', value: [solid(3)] },
    ]

    const { parts } = await exportParts({ toSolids, serialize })

    expect(parts.map((p) => p.maker)).toEqual(['makeC'])
  })

  it('drops a capture whose geometry has no polygons, sides or points', async () => {
    globalThis[CAPTURES] = [
      { maker: 'makeA', file: 'a.js', value: [geom3.create()] },
      { maker: 'makeB', file: 'b.js', value: [geom2.create(), path2.create()] },
      { maker: 'makeC', file: 'c.js', value: [{ id: 1, isEmpty: () => true }] },
    ]

    const { parts } = await exportParts({ toSolids, serialize })

    expect(parts).toEqual([])
  })

  it('serializes only the solids with geometry in a mixed capture', async () => {
    globalThis[CAPTURES] = [{ maker: 'makeA', file: 'a.js', value: [geom3.create(), solid(5)] }]

    const { parts } = await exportParts({ toSolids, serialize })

    expect(parts).toEqual([{ maker: 'makeA', file: 'a.js', data: new Uint8Array([1, 5]) }])
  })

  it('keeps only the 3D solids, dropping a capture with none', async () => {
    const manifold = { id: 4, isManifoldGeom3: true, isEmpty: () => false }
    const square = Object.assign(geom2.fromPoints([[0, 0], [1, 0], [1, 1]]), { id: 2 })
    globalThis[CAPTURES] = [
      { maker: 'makeProfile', file: 'p.js', value: [square] },
      { maker: 'makeNumber', file: 'n.js', value: [42] },
      { maker: 'makeMixed', file: 'm.js', value: [square, solid(6)] },
      { maker: 'makeManifold', file: 'f.js', value: [manifold] },
    ]

    const { parts } = await exportParts({ toSolids, serialize })

    expect(parts).toEqual([
      { maker: 'makeMixed', file: 'm.js', data: new Uint8Array([1, 6]) },
      { maker: 'makeManifold', file: 'f.js', data: new Uint8Array([1, 4]) },
    ])
  })

  it('removes the global', async () => {
    globalThis[CAPTURES] = [{ maker: 'makeA', file: 'a.js', value: [{ id: 1 }] }]

    await exportParts({ toSolids, serialize })

    expect(CAPTURES in globalThis).toBe(false)
  })

  it('returns no parts without the global', async () => {
    const { parts } = await exportParts({ toSolids, serialize })

    expect(parts).toEqual([])
  })
})
