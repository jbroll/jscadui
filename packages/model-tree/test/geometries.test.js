import { test, expect } from 'vitest'
import modeling from '@jscad/modeling'
import { createModelTree, createBuildContext, withBuildContext, bindEvaluator, createEvaluator } from '../src/index.js'

// Model code holds deferred nodes but calls the geometry readers
// (toSides, toPoints, toPolygons, ...) as if they were real geometry. Inside a
// build context each node operand is replayed on the caller's stack, so the
// reader returns data, not a Promise (11-balloons: geom2.toSides(circle(...))).
test('geom2.toSides replays a node operand synchronously', async () => {
  const t = createModelTree(modeling)
  const ctx = createBuildContext(modeling)
  await withBuildContext(ctx, () => {
    const node = t.primitives.circle({ radius: 1, segments: 8 })
    const sides = t.geometries.geom2.toSides(node)
    expect(sides).not.toBeInstanceOf(Promise)
    expect(sides).toEqual(modeling.geometries.geom2.toSides(modeling.primitives.circle({ radius: 1, segments: 8 })))
  })
})

test('geom3.toPolygons replays a node operand synchronously', async () => {
  const t = createModelTree(modeling)
  const ctx = createBuildContext(modeling)
  await withBuildContext(ctx, () => {
    const cut = t.booleans.intersect(
      t.primitives.sphere({ radius: 6 }),
      t.primitives.cuboid({ size: [100, 100, 0.75], center: [0, 0, 0.375] }),
    )
    const polygons = t.geometries.geom3.toPolygons(cut)
    expect(polygons).not.toBeInstanceOf(Promise)
    expect(polygons.length).toBeGreaterThan(0)
  })
})

// model-tools and the text path read real geometry through this namespace. A
// real value must stay synchronous: postMessage cannot clone a Promise.
test('real geometry passes through synchronously', () => {
  const t = createModelTree(modeling)
  const circle = modeling.primitives.circle({ radius: 1, segments: 8 })
  const sides = t.geometries.geom2.toSides(circle)
  expect(sides).not.toBeInstanceOf(Promise)
  expect(sides).toEqual(modeling.geometries.geom2.toSides(circle))
})

test('isA still reports a node as not geometry', () => {
  const t = createModelTree(modeling)
  expect(t.geometries.geom2.isA(t.primitives.circle({ radius: 1 }))).toBe(false)
})

// A node that reaches a thenable cannot be replayed synchronously, so the
// reader falls back to the async eager path and returns a Promise.
test('a node with a Promise leaf falls back to a Promise', async () => {
  const t = createModelTree(modeling)
  const ctx = createBuildContext(modeling)
  bindEvaluator(ctx, createEvaluator(modeling))
  const cube = t.primitives.cube({ size: 2 })
  const node = {
    op: 'transforms.translate',
    params: [1, 0, 0],
    children: [Promise.resolve(cube)],
    isTreeNode: true,
    dim: 3,
    overlay: null,
    anchors: null,
    color: null,
  }
  const polygons = await withBuildContext(ctx, () => {
    const pending = t.geometries.geom3.toPolygons(node)
    expect(pending).toBeInstanceOf(Promise)
    return pending
  })
  expect(polygons.length).toBe(6)
})
