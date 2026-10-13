import { test, expect } from 'vitest'
import modeling from '@jscad/modeling'
import { createModelTree, createBuildContext, withBuildContext, createEvaluator, bindEvaluator, memoFromSpecials } from '@jscadui/model-tree'
import { _is2D, withoutDegeneratePolygons, initPrimitives, _safeUnion } from '../src/primitives.js'
import { overlaysOf, strip, initOverlays, highlight, background } from '../src/overlay.js'
import { initTransforms, _resize, _translate } from '../src/transforms.js'

const node2 = { op: 'x', params: {}, children: [], isTreeNode: true, dim: 2, overlay: null, anchors: null, color: null }
const node3 = { ...node2, dim: 3 }

const setup = () => {
  const t = createModelTree(modeling)
  const ctx = createBuildContext(modeling)
  bindEvaluator(ctx, createEvaluator(modeling))
  initPrimitives(t)
  initTransforms(t)
  initOverlays(modeling)
  return { t, ctx }
}

test('is2D reads dim on nodes', () => {
  expect(_is2D(node2)).toBe(true)
  expect(_is2D(node3)).toBe(false)
})

test('withoutDegeneratePolygons passes nodes through', () => {
  expect(withoutDegeneratePolygons(node3)).toBe(node3)
})

test('overlay strip drops ghost markers, keeps nodes', () => {
  const ghost = { ...node3, op: 'ghost', params: { kind: 'background' } }
  const tagged = { ...node3, overlay: { kinds: ['highlight'], unmapped: false } }
  expect(strip([node3, ghost])).toEqual([node3])
  expect(overlaysOf(node3)).toEqual([])
  expect(overlaysOf(tagged)).toEqual([{ kind: 'highlight' }])
  expect(strip(tagged).overlay).toBe(null)
})

test('highlight tags the operand node and records its snapshot', async () => {
  const { t, ctx } = setup()
  const cube = t.primitives.cube({ size: 2 })
  const tagged = await withBuildContext(ctx, () => highlight(cube))
  expect(tagged.isTreeNode).toBe(true)
  expect(tagged.overlay.kinds).toEqual(['highlight'])
  const entry = ctx.specials.get(tagged)
  expect(entry.snapshots).toHaveLength(1)
  expect(entry.snapshots[0].kind).toBe('highlight')
  const { solids, ghosts } = await createEvaluator(modeling)(tagged, memoFromSpecials(ctx))
  expect(solids).toHaveLength(1)
  expect(ghosts).toHaveLength(1)
  expect(ghosts[0].previewOnly).toBe(true)
})

test('background returns a ghost marker that evaluates to a ghost only', async () => {
  const { t, ctx } = setup()
  const cube = t.primitives.cube({ size: 2 })
  const marker = await withBuildContext(ctx, () => background(cube))
  expect(marker.op).toBe('ghost')
  const { solids, ghosts } = await createEvaluator(modeling)(marker, memoFromSpecials(ctx))
  expect(solids).toHaveLength(0)
  expect(ghosts).toHaveLength(1)
})

test('union of a solid and a background keeps the solid and carries the ghost', async () => {
  const { t, ctx } = setup()
  const cube = t.primitives.cube({ size: 2 })
  const out = await withBuildContext(ctx, async () => _safeUnion([cube, await background(t.primitives.sphere({ r: 1 }))]))
  expect(out.isTreeNode).toBe(true)
  expect(out.overlay.kinds).toContain('background')
  const { solids, ghosts } = await createEvaluator(modeling)(out, memoFromSpecials(ctx))
  expect(solids).toHaveLength(1)
  expect(ghosts).toHaveLength(1)
})

test('resize on a node defers as a transforms.resize node', async () => {
  const { t, ctx } = setup()
  const out = _resize([4, 4, 4], t.primitives.cube({ size: 2 }))
  expect(out.isTreeNode).toBe(true)
  expect(out.op).toBe('transforms.resize')
  expect(out.params).toEqual([4, 4, 4])
  const { solids } = await createEvaluator(modeling)(out, memoFromSpecials(ctx))
  expect(solids).toHaveLength(1)
  const bbox = modeling.measurements.measureBoundingBox(solids[0])
  expect(bbox[1][0] - bbox[0][0]).toBeCloseTo(4, 5)
})

test('a highlight inside a translate maps the ghost through the node matrix', async () => {
  const { t, ctx } = setup()
  const moved = await withBuildContext(ctx, async () => _translate([10, 0, 0], await highlight(t.primitives.cube({ size: 2 }))))
  expect(moved.isTreeNode).toBe(true)
  expect(moved.overlay.kinds).toEqual(['highlight'])
  expect(moved.overlay.unmapped).toBe(true)
  const { solids, ghosts } = await createEvaluator(modeling)(moved, memoFromSpecials(ctx))
  expect(solids).toHaveLength(1)
  expect(ghosts).toHaveLength(1)
  const xs = ghosts[0].polygons.flatMap((p) => p.vertices).map((v) => v[0])
  expect(Math.min(...xs)).toBeGreaterThan(8)
})
