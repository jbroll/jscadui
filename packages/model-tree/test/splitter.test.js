import { test, expect } from 'vitest'
import { createModelTree, splitParts } from '../src/index.js'

const t = () => createModelTree({})

test('three independent children split three ways', () => {
  const tr = t()
  const parts = splitParts([tr.primitives.cube({}), tr.primitives.cube({}), tr.primitives.cube({})])
  expect(parts.map(p => p.key)).toEqual(['0', '1', '2'])
})

test('attach edge merges two root children', () => {
  const tr = t()
  const a = tr.primitives.cube({})
  const b = tr.primitives.cube({})
  const placed = { op: 'attach', params: { child: b, childAnchor: { node: b, direction: [0, 0, -1] }, parent: a, parentAnchor: { node: a, direction: [0, 0, 1] }, overlap: 0, flip: true, spin: 0 }, children: [b, a], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const parts = splitParts([a, placed])
  expect(parts).toHaveLength(1)
  expect(parts[0].key).toBe('0+1')
  expect(parts[0].nodes).toHaveLength(2)
})

test('transitive edges merge three ways', () => {
  const tr = t()
  const a = tr.primitives.cube({})
  const b = tr.primitives.cube({})
  const c = tr.primitives.cube({})
  const mk = (child, parent) => ({ op: 'attach', params: { child, childAnchor: { node: child, direction: [0, 0, -1] }, parent, parentAnchor: { node: parent, direction: [0, 0, 1] }, overlap: 0, flip: true, spin: 0 }, children: [child, parent], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null })
  const parts = splitParts([a, mk(b, a), mk(c, b)])
  expect(parts).toHaveLength(1)
  expect(parts[0].key).toBe('0+1+2')
})

test('reversed root order merges an attach reference into the nested owner', () => {
  const tr = t()
  const x = tr.primitives.cube({})
  const parent = tr.primitives.cube({})
  const partA = tr.booleans.union(x)
  const placed = { op: 'attach', params: { child: x, childAnchor: { node: x, direction: [0, 0, -1] }, parent, parentAnchor: { node: parent, direction: [0, 0, 1] }, overlap: 0, flip: true, spin: 0 }, children: [x, parent], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const parts = splitParts([placed, partA])
  expect(parts).toHaveLength(1)
  expect(parts[0].key).toBe('0+1')
})

test('alignTo edge merges two root children', () => {
  const tr = t()
  const x = tr.primitives.cube({})
  const parent = tr.primitives.cube({})
  const partA = tr.booleans.union(x)
  const aligned = { op: 'alignTo', params: { child: x, parent, direction: [0, 0, 1], inset: 0, inside: false }, children: [x, parent], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const parts = splitParts([aligned, partA])
  expect(parts).toHaveLength(1)
  expect(parts[0].key).toBe('0+1')
})

test('anchors.pending descriptor merges two root children', () => {
  const tr = t()
  const x = tr.primitives.cube({})
  const owner = tr.transforms.translate([1, 0, 0], x)
  const host = tr.primitives.cube({})
  host.anchors = { frames: null, pending: [{ node: x, direction: [0, 0, 1] }] }
  const parts = splitParts([host, owner])
  expect(parts).toHaveLength(1)
  expect(parts[0].key).toBe('0+1')
})

test('empty and single roots', () => {
  expect(splitParts([])).toEqual([])
  expect(splitParts(undefined)).toEqual([])
  const tr = t()
  expect(splitParts(tr.primitives.cube({}))).toHaveLength(1)
})

test('fluent arrays flatten', () => {
  const tr = t()
  const arr = { isFluentArray: true, [Symbol.iterator]: function* () { yield tr.primitives.cube({}) } }
  expect(splitParts([arr])).toHaveLength(1)
})
