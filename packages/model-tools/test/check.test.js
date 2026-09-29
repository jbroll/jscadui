import { expect, test } from 'vitest'
import jscad from '@jscad/modeling'
import { check, BEDS } from '../index.js'
import { isInsideOut } from '../src/check.js'

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

test('a named bed fits a 10mm cube', () => {
  expect(check(cuboid({ size: [10, 10, 10] }), { bed: 'mk3' }).fitsBed).toBe(true)
})

test('a named bed is case-insensitive', () => {
  expect(check(cuboid({ size: [10, 10, 10] }), { bed: 'MK3' }).fitsBed).toBe(true)
})

test('a bracket-sized cube fits the mk3 bed', () => {
  expect(check(cuboid({ size: [40, 60, 40] }), { bed: 'mk3' }).fitsBed).toBe(true)
})

test('an oversized cube does not fit the mk3 bed', () => {
  expect(check(cuboid({ size: [300, 300, 300] }), { bed: 'mk3' }).fitsBed).toBe(false)
})

test('a bed given as an {x, y, z} object fits like the equivalent array', () => {
  expect(check(cuboid({ size: [10, 10, 10] }), { bed: { x: 200, y: 200, z: 200 } }).fitsBed).toBe(true)
  expect(check(cuboid({ size: [300, 300, 300] }), { bed: { x: 200, y: 200, z: 200 } }).fitsBed).toBe(false)
})

test('a bed given as a JSON array string fits like the equivalent array', () => {
  expect(check(cuboid({ size: [10, 10, 10] }), { bed: '[200, 200, 200]' }).fitsBed).toBe(true)
  expect(check(cuboid({ size: [300, 300, 300] }), { bed: '[200, 200, 200]' }).fitsBed).toBe(false)
})

test('a bed given as a JSON object string fits like the equivalent object', () => {
  expect(check(cuboid({ size: [10, 10, 10] }), { bed: '{"x": 250, "y": 210, "z": 210}' }).fitsBed).toBe(true)
  expect(check(cuboid({ size: [300, 300, 300] }), { bed: '{"x": 250, "y": 210, "z": 210}' }).fitsBed).toBe(false)
})

test('a string that parses to something other than a dims array or {x, y, z} object still errors', () => {
  expect(() => check(cuboid({ size: [10, 10, 10] }), { bed: '{"a": 1}' })).toThrow(/unknown bed/)
  expect(() => check(cuboid({ size: [10, 10, 10] }), { bed: '"just a string"' })).toThrow(/unknown bed/)
})

test('an unknown bed name throws with the list of known names', () => {
  expect(() => check(cuboid({ size: [10, 10, 10] }), { bed: 'bambu' })).toThrow(
    /unknown bed bambu: use one of .*mk3.*or \[x, y, z\] in mm/,
  )
})

test('BEDS exports the known bed dimensions in mm', () => {
  expect(BEDS.mk3).toEqual([250, 210, 210])
  expect(BEDS.mk4).toEqual([250, 210, 220])
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

test('isInsideOut uses an epsilon relative to the solid\'s own scale', () => {
  // A 10x10x10 solid's floating-point summation noise is nowhere near its own
  // scale (1000 mm^3), so a hair below zero must not read as inside out.
  expect(isInsideOut(-1e-9, [10, 10, 10])).toBe(false)
  expect(isInsideOut(-1e-6, [10, 10, 10])).toBe(false)
  // A volume comparable to (or larger in magnitude than) the solid's own
  // scale is a real inversion, not noise.
  expect(isInsideOut(-500, [10, 10, 10])).toBe(true)
  expect(isInsideOut(0, [10, 10, 10])).toBe(false)
})

test('a fully inverted solid is reported inside out, never watertight', () => {
  const reversed = cubeFaces(0).map((f) => [...f].reverse())
  const inverted = polyhedron(cubePoints([0, 0, 0]), reversed)
  const c = check(inverted)
  expect(c.insideOut).toBe(true)
  expect(c.watertight).toBe(false)
  expect(c.notes).toContain(
    'solid is inside out (volume < 0); a 2D outline given clockwise usually causes this; reverse its points',
  )
})

test('an array aggregates insideOut like selfIntersecting', () => {
  const reversed = cubeFaces(0).map((f) => [...f].reverse())
  const inverted = polyhedron(cubePoints([0, 0, 0]), reversed)
  expect(check([inverted, cuboid({ size: [5, 5, 5] })]).insideOut).toBe(true)
  expect(check([cuboid({ size: [5, 5, 5] })]).insideOut).toBe(false)
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