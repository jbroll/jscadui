import { describe, expect, it, vi } from 'vitest'

globalThis.self = { addEventListener() {}, postMessage: () => {} }

vi.mock('./src/treeApi.js', async () => {
  const modeling = (await import('@jscad/modeling')).default
  const { createEvaluator } = await import('@jscadui/model-tree')
  return { loadBoundEvaluate: () => createEvaluator(modeling) }
})

const { toSolids } = await import('./worker.js')
const { createModelTree } = await import('@jscadui/model-tree')
const modeling = (await import('@jscad/modeling')).default

describe('toSolids', () => {
  const tree = createModelTree(modeling)

  it('evaluates tree nodes in nested arrays into geometry', async () => {
    const solids = await toSolids([tree.primitives.cube({ size: 2 }), [tree.transforms.translate([5, 0, 0], tree.primitives.cube({ size: 1 }))]])

    expect(solids).toHaveLength(2)
    expect(solids.every((s) => modeling.geometries.geom3.isA(s))).toBe(true)
    expect(modeling.measurements.measureBoundingBox(solids[1])).toEqual([[4.5, -0.5, -0.5], [5.5, 0.5, 0.5]])
  })

  it('passes plain geometry through as one solid', async () => {
    const cube = modeling.primitives.cube({ size: 2 })

    expect(await toSolids(cube)).toEqual([cube])
  })

  it('drops nothing-values and preview-only solids', async () => {
    const cube = modeling.primitives.cube({ size: 2 })
    const ghost = { ...modeling.primitives.cube({ size: 1 }), previewOnly: true }

    expect(await toSolids([cube, null, undefined, ghost])).toEqual([cube])
  })
})
