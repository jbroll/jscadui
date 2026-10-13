import { test, expect } from 'vitest'
import { createModelTree } from '../src/index.js'

const raw = {
  primitives: { cube: (...a) => ({ real: 'cube', a }) },
  maths: { vec3: { add: (o, a, b) => [a[0] + b[0]] } },
  utils: {},
}
const treeOf = () => createModelTree(raw)

test('primitive defers without touching the engine', () => {
  let called = 0
  const t = createModelTree({ primitives: { cube: () => { called++; return {} } } })
  const n = t.primitives.cube({ size: 3 })
  expect(called).toBe(0)
  expect(n).toMatchObject({ op: 'primitives.cube', isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null })
})

test('namespace parity: every modeling category present', async () => {
  const modeling = await import('@jscad/modeling').catch(() => null)
  if (!modeling) return
  const t = createModelTree(modeling)
  for (const cat of ['primitives', 'booleans', 'transforms', 'extrusions', 'expansions', 'hulls', 'measurements', 'colors', 'geometries', 'maths', 'utils']) {
    expect(t[cat], cat).toBeTruthy()
  }
})

test('boolean takes first present child dim', () => {
  const t = treeOf()
  const c3 = t.primitives.cube({})
  expect(t.booleans.union(undefined, c3).dim).toBe(3)
})

test('colorize tags color', () => {
  const t = treeOf()
  const n = t.colors.colorize([1, 0, 0], t.primitives.cube({}))
  expect(n.color).toEqual([1, 0, 0])
  expect(n.dim).toBe(3)
})

test('thenable operand returns Promise of node', async () => {
  const t = treeOf()
  const out = t.booleans.union(Promise.resolve(t.primitives.cube({})), t.primitives.cube({}))
  expect(typeof out.then).toBe('function')
  expect((await out).isTreeNode).toBe(true)
})

test('transform stores its matrix', () => {
  const t = treeOf()
  const n = t.transforms.translate([5, 0, 0], t.primitives.cube({}))
  expect(n.matrix.slice(12, 15)).toEqual([5, 0, 0])
  expect(n.dim).toBe(3)
})

test('sphere primitive carries dim 3', () => {
  const t = treeOf()
  expect(t.primitives.sphere({ radius: 2 }).dim).toBe(3)
})

test('center is options-first: options become params, not a literal child', () => {
  const t = treeOf()
  const cube = t.primitives.cube({})
  const options = { axes: [true, true, false] }
  const n = t.transforms.center(options, cube)
  expect(n.params).toBe(options)
  expect(n.children).toEqual([cube])
})
