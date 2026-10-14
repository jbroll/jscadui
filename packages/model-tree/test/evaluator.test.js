import { test, expect } from 'vitest'
import { createModelTree, createBuildContext, withBuildContext, memoFromSpecials, bindEvaluator, createSyncEvaluator, AsyncLeafError } from '../src/index.js'
import { createEvaluator } from '../src/evaluator.js'
import modeling from '@jscad/modeling'

const evaluate = (node, memo) => createEvaluator(modeling)(node, memo)
const syncEvaluate = (node, memo) => createSyncEvaluator(modeling)(node, memo)
const boxOf = (solids) => modeling.measurements.measureBoundingBox(solids.length === 1 ? solids[0] : solids)
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

test('evaluateSync replays a subtree synchronously', () => {
  const t = createModelTree(modeling)
  const node = t.booleans.union(t.primitives.cube({ size: 4 }), t.transforms.translate([10, 0, 0], t.primitives.cube({ size: 4 })))
  const { solids } = createSyncEvaluator(modeling)(node, new Map())
  expect(solids).toHaveLength(1)
  expect(modeling.measurements.measureVolume(solids[0])).toBeCloseTo(128, 5)
})

test('evaluateSync throws an AsyncLeafError on an async leaf', () => {
  const t = createModelTree(modeling)
  const cube = t.primitives.cube({ size: 4 })
  const node = {
    op: 'transforms.translate',
    params: [10, 0, 0],
    children: [Promise.resolve(cube)],
    isTreeNode: true,
    dim: 3,
    overlay: null,
    anchors: null,
    color: null,
  }
  expect(() => createSyncEvaluator(modeling)(node, new Map())).toThrow(AsyncLeafError)
  expect(() => createSyncEvaluator(modeling)(node, new Map())).toThrow('evaluateSync: async leaf')
})

// The sync fast path replays the same deferred subtree a measurement reads, so
// each deferred op must produce the async evaluator's geometry exactly.

test('evaluateSync resize matches the async evaluator', async () => {
  const t = createModelTree(modeling)
  const node = t.transforms.resize([4, 2, 1], t.primitives.cube({ size: 2 }))
  const sync = syncEvaluate(node, new Map())
  const asym = await evaluate(node, new Map())
  expect(boxOf(sync.solids)).toEqual(boxOf(asym.solids))
  expect(boxOf(sync.solids)).toEqual([[-2, -1, -0.5], [2, 1, 0.5]])
})

test('evaluateSync colorize matches the async evaluator', async () => {
  const t = createModelTree(modeling)
  const node = t.colors.colorize([1, 0, 0, 1], t.primitives.cube({ size: 2 }))
  const sync = syncEvaluate(node, new Map())
  const asym = await evaluate(node, new Map())
  expect(sync.solids).toHaveLength(1)
  expect(sync.solids[0].color).toEqual(asym.solids[0].color)
  expect(boxOf(sync.solids)).toEqual(boxOf(asym.solids))
  expect(modeling.measurements.measureVolume(sync.solids[0])).toBeCloseTo(8, 5)
})

test('evaluateSync attach matches the async evaluator', async () => {
  const t = createModelTree(modeling)
  const parent = t.primitives.cube({ size: 10 })
  const child = t.primitives.cube({ size: 2 })
  const node = { op: 'attach', params: { child, childAnchor: { node: child, direction: [0, 0, -1] }, parent, parentAnchor: { node: parent, direction: [0, 0, 1] }, overlap: 0, flip: false, spin: 0 }, children: [child, parent], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const sync = syncEvaluate(node, new Map())
  const asym = await evaluate(node, new Map())
  expect(boxOf(sync.solids)).toEqual(boxOf(asym.solids))
  const [[, , zmin], [, , zmax]] = boxOf(sync.solids)
  expect(zmin).toBeCloseTo(3, 5)
  expect(zmax).toBeCloseTo(5, 5)
})

test('evaluateSync alignTo matches the async evaluator', async () => {
  const t = createModelTree(modeling)
  const parent = t.primitives.cube({ size: 10 })
  const child = t.primitives.cube({ size: 2 })
  const node = { op: 'alignTo', params: { child, parent, direction: [0, 0, 1], inset: 0, inside: false }, children: [child, parent], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const sync = syncEvaluate(node, new Map())
  const asym = await evaluate(node, new Map())
  expect(boxOf(sync.solids)).toEqual(boxOf(asym.solids))
  expect(boxOf(sync.solids)).toEqual([[-1, -1, 5], [1, 1, 7]])
})

test('evaluateSync ghost matches the async evaluator', async () => {
  const mesh = { dim: 3, polygons: [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]] }
  const ghost = { op: 'ghost', params: { kind: 'background' }, children: [], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const ctx = createBuildContext(modeling)
  ctx.specials.set(ghost, { node: ghost, snapshots: [{ kind: 'background', mesh, matrix: IDENTITY }] })
  const sync = syncEvaluate(ghost, memoFromSpecials(ctx))
  const asym = await evaluate(ghost, memoFromSpecials(ctx))
  expect(sync.solids).toHaveLength(0)
  expect(sync.ghosts).toEqual(asym.ghosts)
  expect(sync.ghosts).toHaveLength(1)
})

test('evaluateSync maps overlay ghosts through the node matrix like async', async () => {
  const mesh = { dim: 3, polygons: [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]] }
  const t = createModelTree(modeling)
  const node = t.transforms.translate([5, 0, 0], t.primitives.cube({ size: 2 }))
  node.overlay = { kinds: ['highlight'], unmapped: true }
  const ctx = createBuildContext(modeling)
  ctx.specials.set(node, { node, snapshots: [{ kind: 'highlight', mesh, matrix: IDENTITY }] })
  const sync = syncEvaluate(node, memoFromSpecials(ctx))
  const asym = await evaluate(node, memoFromSpecials(ctx))
  expect(sync.ghosts).toEqual(asym.ghosts)
  expect(sync.ghosts).toHaveLength(1)
  expect(sync.ghosts[0].polygons[0].vertices[0]).toEqual([5, 0, 0])
})

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
