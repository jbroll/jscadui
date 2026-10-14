import { test, expect } from 'vitest'
import modeling from '@jscad/modeling'
import { createModelTree, createBuildContext, withBuildContext, bindEvaluator, createEvaluator } from '../src/index.js'

test('measurement evaluates once and caches in specials', async () => {
  let evals = 0
  const fakeEngine = { measurements: { measureVolume: () => 42 } }
  const t = createModelTree(fakeEngine)
  const cube = t.primitives.cube({})
  const ctx = createBuildContext(fakeEngine)
  ctx.eager = async (_node) => { evals++; return { fakeGeom: true } }
  const v = await withBuildContext(ctx, async () => t.measurements.measureVolume(cube))
  expect(v).toBe(42)
  expect(evals).toBe(1)
  expect(ctx.specials.get(cube).value).toBe(42)
  await withBuildContext(ctx, async () => t.measurements.measureVolume(cube))
  expect(evals).toBe(1)
})

// model-tools measures evaluated solids through this namespace (the frame's
// '@jscad/modeling' alias). A real value needs no evaluation, so it must return
// the number itself: an async wrapper would postMessage a Promise (DataCloneError).
test('measuring real geometry returns the value synchronously', () => {
  const t = createModelTree(modeling)
  const r = t.measurements.measureBoundingBox(modeling.primitives.cuboid({ size: [2, 3, 4] }))
  expect(r).not.toBeInstanceOf(Promise)
  expect(r).toEqual([[-1, -1.5, -2], [1, 1.5, 2]])
})

// A deferred subtree with no async leaf can be replayed synchronously inside
// the build, so the measurement returns the number itself. Examples such as
// 10-slicer and 11-balloons read box coordinates straight off the result.
test('measuring a deferred subtree runs synchronously inside a build context', async () => {
  const t = createModelTree(modeling)
  const ctx = createBuildContext(modeling)
  await withBuildContext(ctx, () => {
    const cube = t.primitives.cube({ size: 4 })
    const moved = t.transforms.translate([10, 0, 0], cube)
    const tree = t.booleans.union(cube, moved)

    const cubeVolume = t.measurements.measureVolume(cube)
    expect(cubeVolume).not.toBeInstanceOf(Promise)
    expect(cubeVolume).toBeCloseTo(64, 5)

    const volume = t.measurements.measureVolume(tree)
    expect(volume).not.toBeInstanceOf(Promise)
    expect(volume).toBeCloseTo(128, 5)
    expect(ctx.specials.get(tree).value).toBeCloseTo(128, 5)

    const box = t.measurements.measureBoundingBox(tree)
    expect(box).not.toBeInstanceOf(Promise)
    expect(box).toEqual([[-2, -2, -2], [12, 2, 2]])
    return undefined
  })
})

// A subtree that reaches a thenable cannot be replayed synchronously, so the
// measurement falls back to the async eager path and returns a Promise, as it
// did before the fast path existed.
test('a subtree with a Promise leaf still returns a Promise', async () => {
  const t = createModelTree(modeling)
  const ctx = createBuildContext(modeling)
  bindEvaluator(ctx, createEvaluator(modeling))
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
  const value = await withBuildContext(ctx, () => {
    const pending = t.measurements.measureVolume(node)
    expect(pending).toBeInstanceOf(Promise)
    return pending
  })
  expect(value).toBeCloseTo(64, 5)
})

test('all twelve measurements exist', async () => {
  const t = createModelTree({ measurements: {} })
  for (const name of ['measureArea', 'measureBoundingBox', 'measureBoundingSphere', 'measureCenter', 'measureCenterOfMass', 'measureDimensions', 'measureEpsilon', 'measureVolume', 'measureAggregateArea', 'measureAggregateBoundingBox', 'measureAggregateEpsilon', 'measureAggregateVolume']) {
    expect(typeof t.measurements[name], name).toBe('function')
  }
})

test('measurement outside build context throws', async () => {
  const t = createModelTree({ measurements: { measureVolume: () => 1 } })
  await expect(t.measurements.measureVolume(t.primitives.cube({}))).rejects.toThrow('outside build context')
})
