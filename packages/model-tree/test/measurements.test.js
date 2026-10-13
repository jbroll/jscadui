import { test, expect } from 'vitest'
import { createModelTree, createBuildContext, withBuildContext } from '../src/index.js'

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
