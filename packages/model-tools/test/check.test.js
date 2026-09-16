import { expect, test } from 'vitest'
import jscad from '@jscad/modeling'
import { check } from '../index.js'

const { booleans, geometries, primitives, transforms } = jscad
const { geom3 } = geometries
const { cuboid, cylinder, rectangle } = primitives

const cubePoints = ([x, y, z]) =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [x + (i & 1), y + ((i >> 1) & 1), z + ((i >> 2) & 1)])
const cubeFaces = (offset) =>
  [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ].map((f) => f.map((i) => i + offset))
const polyhedron = (points, faces) => geom3.fromPoints(faces.map((f) => f.map((i) => points[i])))
const twoCubes = (second) =>
  polyhedron([...cubePoints([0, 0, 0]), ...cubePoints(second)], [...cubeFaces(0), ...cubeFaces(8)])
const fromPolygons = (polygons) => geom3.fromPoints(polygons.map((p) => p.vertices))

const plateHole = () =>
  booleans.subtract(cuboid({ size: [20, 20, 5] }), cylinder({ radius: 4, height: 6, segments: 32 }))
const overlapCubes = () =>
  booleans.union(cuboid({ size: [10, 10, 10] }), transforms.translate([5, 5, 5], cuboid({ size: [10, 10, 10] })))
const openMesh = () => geom3.fromPoints([[[0, 0, 0], [10, 0, 0], [0, 10, 0]]])

test('a solid cube is watertight and manifold', () => {
  const c = check(cuboid({ size: [10, 10, 10] }), { bed: [200, 200, 200] })
  expect(c).toMatchObject({
    empty: false,
    watertight: true,
    manifold: true,
    openEdges: 0,
    nonManifoldEdges: 0,
    nonManifoldVertices: 0,
    consistentNormals: true,
    selfIntersecting: false,
    intersectingPairs: 0,
    intersectionSamples: [],
    fitsBed: true,
  })
})

test.each([
  ['plate-hole', plateHole()],
  ['overlap-cubes', overlapCubes()],
])('boolean result %s does not self-intersect', (_name, geom) => {
  expect(check(geom)).toMatchObject({ selfIntersecting: false, intersectingPairs: 0 })
})

test('two overlapping shells in one solid self-intersect, with sample points', () => {
  const c = check(twoCubes([0.5, 0.5, 0.5]))
  expect(c.selfIntersecting).toBe(true)
  expect(c.intersectingPairs).toBeGreaterThan(0)
  expect(c.intersectionSamples.length).toBeGreaterThan(0)
  expect(c.intersectionSamples.length).toBeLessThanOrEqual(5)
  for (const p of c.intersectionSamples) {
    for (const v of p) expect(v).toBeGreaterThanOrEqual(0.5 - 1e-9)
    for (const v of p) expect(v).toBeLessThanOrEqual(1 + 1e-9)
  }
})

test('a cube with a top corner pushed through its bottom face self-intersects', () => {
  const points = cubePoints([0, 0, 0])
  points[7] = [0.5, 0.5, -1]
  const folded = polyhedron(points, cubeFaces(0))
  expect(check(folded)).toMatchObject({ watertight: true, selfIntersecting: true })
})

test('solids touching face to face do not self-intersect', () => {
  expect(check(twoCubes([1, 0.5, 0]))).toMatchObject({ selfIntersecting: false })
  expect(check(twoCubes([1, 1, 0]))).toMatchObject({ selfIntersecting: false })
})

test('flags a model larger than the bed', () => {
  expect(check(cuboid({ size: [20, 20, 20] }), { bed: [10, 10, 10] }).fitsBed).toBe(false)
})

test.each([
  ['plate-hole', plateHole()],
  ['overlap-cubes', overlapCubes()],
])('boolean result %s has no open edges from T-junctions', (_name, geom) => {
  expect(check(geom)).toMatchObject({ watertight: true, manifold: true, openEdges: 0 })
})

test('flags an open mesh', () => {
  expect(check(openMesh())).toMatchObject({ watertight: false, openEdges: 3 })
})

test('a boolean result with one polygon removed is still open', () => {
  const polygons = geom3.toPolygons(plateHole())
  const c = check(fromPolygons(polygons.slice(1)))
  expect(c.watertight).toBe(false)
  expect(c.openEdges).toBeGreaterThan(0)
})

test('solids sharing only an edge have a non-manifold edge', () => {
  expect(check(twoCubes([1, 1, 0]))).toMatchObject({
    watertight: true,
    manifold: false,
    nonManifoldEdges: 1,
  })
})

test('solids sharing only a vertex have a non-manifold vertex', () => {
  expect(check(twoCubes([1, 1, 1]))).toMatchObject({
    watertight: true,
    manifold: false,
    nonManifoldEdges: 0,
    nonManifoldVertices: 1,
  })
})

test('inside-out and mixed winding give consistentNormals false', () => {
  const reversed = cubeFaces(0).map((f) => [...f].reverse())
  const inverted = polyhedron(cubePoints([0, 0, 0]), reversed)
  expect(check(inverted).consistentNormals).toBe(false)
  const mixed = polyhedron(cubePoints([0, 0, 0]), [reversed[0], ...cubeFaces(0).slice(1)])
  expect(check(mixed)).toMatchObject({ watertight: true, consistentNormals: false })
})

test('geom2 reports closed outlines and marks solid checks not applicable', () => {
  const c = check(rectangle({ size: [30, 30] }), { bed: [10, 10, 10] })
  expect(c).toMatchObject({
    empty: false,
    closed: true,
    outlines: 1,
    watertight: null,
    manifold: null,
    fitsBed: false,
  })
  expect(c.openEdges).toBeUndefined()
})

test('an array reports each item and aggregates only known values', () => {
  const c = check([
    cuboid({ size: [5, 5, 5] }),
    rectangle({ size: [4, 4] }),
    fromPolygons(geom3.toPolygons(cuboid()).slice(1)),
  ])
  expect(c.entityCount).toBe(3)
  expect(c.items.map((it) => [it.index, it.geomType, it.watertight])).toEqual([
    [0, 'geom3', true],
    [1, 'geom2', null],
    [2, 'geom3', false],
  ])
  expect(c.items[1].closed).toBe(true)
  expect(c).toMatchObject({
    empty: false,
    watertight: false,
    manifold: true,
    selfIntersecting: false,
    openEdges: 4,
  })
  expect(check([cuboid({ size: [5, 5, 5] }), transforms.translate([10, 0, 0], cuboid({ size: [5, 5, 5] }))])).toMatchObject(
    { watertight: true, manifold: true },
  )
  expect(check([])).toMatchObject({ empty: true, watertight: null, items: [] })
})