import { test, expect } from 'vitest'
import { createModelTree, createBuildContext, memoFromSpecials, makeFrameMath, frameFromBBox, directionBasis, ghostOf, mergeGhosts } from '../src/index.js'
import { createEvaluator } from '../src/evaluator.js'
import modeling from '@jscad/modeling'

const math = makeFrameMath(modeling)
const frame = (origin, z, x) => math.frame(origin, z, x)

const tagged = (node, frames, pending = []) => ({
  ...node,
  anchors: { frames, pending, basis: 'tree' },
})

test('map: matrix-known transforms move frames through the stored matrix', () => {
  const t = createModelTree(modeling, { anchors: true })
  const cube = tagged(t.primitives.cube({ size: 10 }), { top: frame([0, 0, 5], [0, 0, 1], [1, 0, 0]) })
  const moved = t.transforms.translate([10, 0, 0], cube)
  expect(moved.anchors.frames.top.origin).toEqual([10, 0, 5])
  expect(cube.anchors.frames.top.origin).toEqual([0, 0, 5])
})

test('carry: keep-group modifiers keep child frames', () => {
  const t = createModelTree(modeling, { anchors: true })
  const cube = tagged(t.primitives.cube({ size: 10 }), { top: frame([0, 0, 5], [0, 0, 1], [1, 0, 0]) })
  const kept = t.modifiers.generalize({}, cube)
  expect(kept.anchors.frames.top.origin).toEqual([0, 0, 5])
})

test('drop: extrusions drop child frames', () => {
  const t = createModelTree(modeling, { anchors: true })
  const square = tagged(t.primitives.square({ size: 2 }), { top: frame([0, 0, 1], [0, 0, 1], [1, 0, 0]) })
  const extruded = t.extrusions.extrudeLinear({ height: 1 }, square)
  expect(extruded.anchors).toBe(null)
})

test('merge: anchored union combines child frames, first wins', () => {
  const t = createModelTree(modeling, { anchors: true })
  const a = tagged(t.primitives.cube({ size: 2 }), { top: frame([0, 0, 1], [0, 0, 1], [1, 0, 0]) })
  const b = tagged(t.primitives.cube({ size: 2 }), { top: frame([0, 0, 9], [0, 0, 1], [1, 0, 0]), bottom: frame([0, 0, -1], [0, 0, -1], [-1, 0, 0]) })
  const union = t.booleans.union(a, b)
  expect(Object.keys(union.anchors.frames).sort()).toEqual(['bottom', 'top'])
  expect(union.anchors.frames.top.origin).toEqual([0, 0, 1])
})

test('anchorless tree: no tagOps means no anchors tag', () => {
  const t = createModelTree(modeling)
  const cube = t.primitives.cube({ size: 2 })
  const moved = t.transforms.translate([1, 0, 0], cube)
  expect(moved.anchors).toBe(null)
})

test('directionBasis: bottom direction points down with mirrored x', () => {
  const basis = directionBasis(math, [0, 0, -1])
  expect(basis.z.map(Math.round)).toEqual([0, 0, -1])
  expect(basis.x.map(Math.round)).toEqual([-1, 0, 0])
})

test('frameFromBBox: origin is center + direction * size/2', () => {
  const f = frameFromBBox(math, [[-5, -5, -5], [5, 5, 5]], [0, 0, 1])
  expect(f.origin).toEqual([0, 0, 5])
  expect(f.z.map(Math.round)).toEqual([0, 0, 1])
})

test('ghostOf: a snapshot becomes a previewOnly entity', () => {
  const mesh = { dim: 3, polygons: [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]] }
  const entity = ghostOf({ kind: 'highlight', mesh, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] })
  expect(entity.previewOnly).toBe(true)
  expect(entity.color).toEqual([1, 0.32, 0.32, 0.5])
  expect(entity.polygons).toHaveLength(1)
})

test('ghost markers resolve their snapshot from build specials', async () => {
  const mesh = { dim: 3, polygons: [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]] }
  const ghost = { op: 'ghost', params: { kind: 'background' }, children: [], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const ctx = createBuildContext(modeling)
  ctx.specials.set(ghost, { node: ghost, snapshots: [{ kind: 'background', mesh, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] })
  const { solids, ghosts } = await createEvaluator(modeling)(ghost, memoFromSpecials(ctx))
  expect(solids).toHaveLength(0)
  expect(ghosts).toHaveLength(1)
  expect(ghosts[0].previewOnly).toBe(true)
})

test('evaluate throws on an unsupported op', async () => {
  const node = { op: 'nope', params: {}, children: [], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  await expect(createEvaluator(modeling)(node, new Map())).rejects.toThrow('unsupported op')
})

test('alignTo places the child against the parent face', async () => {
  const t = createModelTree(modeling)
  const parent = t.primitives.cube({ size: 10 })
  const child = t.primitives.cube({ size: 2 })
  const node = { op: 'alignTo', params: { child, parent, direction: [0, 0, 1], inset: 0, inside: false }, children: [child, parent], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const { solids } = await createEvaluator(modeling)(node, new Map())
  expect(solids).toHaveLength(1)
  expect(modeling.measurements.measureBoundingBox(solids[0])).toEqual([[-1, -1, 5], [1, 1, 7]])
})

test('mergeGhosts: one entity per kind and dimension', () => {
  const mesh = (x) => ({ dim: 3, polygons: [[[x, 0, 0], [x + 1, 0, 0], [x, 1, 0]]] })
  const out = mergeGhosts([
    { kind: 'highlight', mesh: mesh(0), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    { kind: 'highlight', mesh: mesh(5), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    { kind: 'background', mesh: mesh(0), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  ])
  expect(out).toHaveLength(2)
  expect(out.find((e) => e.color[0] === 1).polygons).toHaveLength(2)
})
