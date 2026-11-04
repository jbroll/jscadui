import { afterEach, describe, expect, it } from 'vitest'
import { CAPTURES, exportParts } from '../src_frame/exportParts.js'
import { CAPTURES as PAGE_CAPTURES } from '../src/projectExport.js'
import modeling from '@jscad/modeling'

const { geom2, geom3, path2 } = modeling.geometries

const toSolids = async (value) => value
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
      { maker: 'makeA', file: 'a.js', value: [{ id: 7 }, { id: 8 }] },
      { maker: 'makeB', file: 'b.js', value: [{ id: 9 }] },
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
      { maker: 'makeB', file: 'b.js', value: [{ id: 1, previewOnly: true }] },
      { maker: 'makeC', file: 'c.js', value: [{ id: 3 }] },
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
    globalThis[CAPTURES] = [{ maker: 'makeA', file: 'a.js', value: [geom3.create(), { id: 5, polygons: [{}] }] }]

    const { parts } = await exportParts({ toSolids, serialize })

    expect(parts).toEqual([{ maker: 'makeA', file: 'a.js', data: new Uint8Array([1, 5]) }])
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
