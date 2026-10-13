import { test, expect } from 'vitest'
import { createModelTree, createBuildContext, withBuildContext, memoFromSpecials, bindEvaluator } from '../src/index.js'
import { createEvaluator } from '../src/evaluator.js'
import modeling from '@jscad/modeling'

const evaluate = (node, memo) => createEvaluator(modeling)(node, memo)

// Manifold engine equivalence needs WASM, so it is not unit-tested here. The
// engine-agnostic volume check below runs on the plain jscad engine;
// apps/jscad-web/test/evaluator-manifold.test.js covers the manifold twin.
test('tree evaluates to the same volume as eager', async () => {
  const t = createModelTree(modeling)
  const ctx = createBuildContext(modeling)
  const built = await withBuildContext(ctx, async () =>
    t.booleans.union(t.primitives.cube({ size: 10 }), t.transforms.translate([20, 0, 0], t.primitives.cube({ size: 10 }))))
  const eager = modeling.booleans.union(modeling.primitives.cube({ size: 10 }), modeling.transforms.translate([20, 0, 0], modeling.primitives.cube({ size: 10 })))
  const { solids } = await evaluate(built, memoFromSpecials(ctx))
  expect(solids).toHaveLength(1)
  expect(modeling.measurements.measureVolume(solids[0])).toBe(modeling.measurements.measureVolume(eager))
})

test('measured subtree evaluates once across build and evaluate', async () => {
  const ctx = createBuildContext(modeling)
  let vols = 0
  const counting = { ...modeling, measurements: { ...modeling.measurements, measureVolume: (...a) => { vols++; return modeling.measurements.measureVolume(...a) } } }
  const t = createModelTree(counting)
  const sub = t.primitives.cube({ size: 4 })
  bindEvaluator(ctx, createEvaluator(counting))
  const v = await withBuildContext(ctx, async () => t.measurements.measureVolume(sub))
  expect(v).toBeCloseTo(64, 5)
  await evaluate(sub, memoFromSpecials(ctx))
  expect(vols).toBe(1)
})

test('attach resolves to placed geometry', async () => {
  const t = createModelTree(modeling)
  const parent = t.primitives.cube({ size: 10 })
  const child = t.primitives.cube({ size: 2 })
  const node = { op: 'attach', params: { child, childAnchor: { node: child, direction: [0, 0, -1] }, parent, parentAnchor: { node: parent, direction: [0, 0, 1] }, overlap: 0, flip: false, spin: 0 }, children: [child, parent], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const { solids } = await evaluate(node, new Map())
  expect(solids).toHaveLength(1)
  // `attach` returns the placed child, exactly like eager jscad-anchors
  // `place.attach` (Task 13's equivalence gate compares against it): with
  // flip:false the child hangs below the parent's top face, z in [3, 5].
  const [[xmin, , zmin], [xmax, , zmax]] = modeling.measurements.measureBoundingBox(solids[0])
  expect(zmin).toBeCloseTo(3, 5)
  expect(zmax).toBeCloseTo(5, 5)
  expect(xmax - xmin).toBeCloseTo(2, 5)
})
