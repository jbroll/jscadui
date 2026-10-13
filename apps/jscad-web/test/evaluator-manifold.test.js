/**
 * Manifold evaluator equivalence. This lives here, not in packages/model-tree,
 * because Manifold WASM only loads in the worker/browser harness (as
 * examples.test.js does): the package's own tests run plain jscad in Node.
 *
 * For each multipart model the tree path is built with `@jscadui/model-tree`
 * and evaluated over the manifold engine; the eager path calls manifold
 * directly. Volume, bounding box and triangle count must match.
 */
import { describe, test, expect, beforeAll } from 'vitest'
import * as manifold from '@jscadui/manifold'
import { createModelTree, createBuildContext, withBuildContext, memoFromSpecials, createEvaluator } from '@jscadui/model-tree'

const evaluate = createEvaluator(manifold)

beforeAll(async () => {
  await manifold.init()
})

const treeDraw = async (draw) => {
  const t = createModelTree(manifold)
  const ctx = createBuildContext(manifold)
  const root = await withBuildContext(ctx, async () => draw(t))
  const { solids } = await evaluate(root, memoFromSpecials(ctx))
  return solids
}

const triangles = (geometry) => (geometry.polygons || geometry.sides || []).length

const expectSame = (solid, eager) => {
  expect(manifold.measurements.measureVolume(solid)).toBeCloseTo(manifold.measurements.measureVolume(eager), 6)
  expect(manifold.measurements.measureBoundingBox(solid)).toEqual(manifold.measurements.measureBoundingBox(eager))
  expect(triangles(solid)).toBe(triangles(eager))
}

describe('manifold evaluator equivalence', () => {
  test('union of two translated cubes', async () => {
    const eager = manifold.booleans.union(
      manifold.primitives.cube({ size: 10 }),
      manifold.transforms.translate([20, 0, 0], manifold.primitives.cube({ size: 10 })),
    )
    const solids = await treeDraw((t) => t.booleans.union(
      t.primitives.cube({ size: 10 }),
      t.transforms.translate([20, 0, 0], t.primitives.cube({ size: 10 })),
    ))
    expect(solids).toHaveLength(1)
    expectSame(solids[0], eager)
  })

  test('subtract leaves an L-shaped solid', async () => {
    const eager = manifold.booleans.subtract(
      manifold.primitives.cube({ size: 10 }),
      manifold.transforms.translate([5, 0, 0], manifold.primitives.cube({ size: 10 })),
    )
    const solids = await treeDraw((t) => t.booleans.subtract(
      t.primitives.cube({ size: 10 }),
      t.transforms.translate([5, 0, 0], t.primitives.cube({ size: 10 })),
    ))
    expect(solids).toHaveLength(1)
    expectSame(solids[0], eager)
  })

  test('multipart root keeps each part a separate solid', async () => {
    const eager = [
      manifold.booleans.union(manifold.primitives.cube({ size: 10 }), manifold.transforms.rotateZ(Math.PI / 4, manifold.primitives.cube({ size: 4 }))),
      manifold.transforms.translate([30, 0, 0], manifold.primitives.sphere({ radius: 5 })),
    ]
    const solids = await treeDraw((t) => [
      t.booleans.union(t.primitives.cube({ size: 10 }), t.transforms.rotateZ(Math.PI / 4, t.primitives.cube({ size: 4 }))),
      t.transforms.translate([30, 0, 0], t.primitives.sphere({ radius: 5 })),
    ])
    expect(solids).toHaveLength(2)
    expectSame(solids[0], eager[0])
    expectSame(solids[1], eager[1])
  })
})
