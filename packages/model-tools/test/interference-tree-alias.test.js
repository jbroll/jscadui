// In the frame worker '@jscad/modeling' resolves to the engine's tree bundle,
// whose booleans build lazy nodes. This mirrors that bundle's exports.
import { expect, test, vi } from 'vitest'

vi.mock('@jscad/modeling', async () => {
  const modeling = (await vi.importActual('@jscad/modeling')).default
  const { createModelTree, createSyncEvaluator } = await import('@jscadui/model-tree')
  return { default: { ...createModelTree(modeling, { anchors: true }), evaluateSync: createSyncEvaluator(modeling) } }
})

const modeling = (await vi.importActual('@jscad/modeling')).default
const { check } = await import('../index.js')

const cube = (x) => modeling.primitives.cuboid({ size: [10, 10, 10], center: [x, 0, 0] })

test('check measures shared volume through the tree bundle', () => {
  const r = check([cube(0), cube(5)])
  expect(r.interference.pairs).toHaveLength(1)
  expect(r.interference.pairs[0].volume).toBeCloseTo(500, 3)
  r.interference.pairs[0].size.forEach((s, i) => expect(s).toBeCloseTo([5, 10, 10][i], 3))
})
