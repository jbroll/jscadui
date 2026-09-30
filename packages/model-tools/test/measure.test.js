import { expect, test } from 'vitest'
import jscad from '@jscad/modeling'
import { measure } from '../index.js'
import { measureAnchors, measureBetween, measureParts } from '../src/measure.js'

const { booleans, primitives, transforms } = jscad
const { cuboid, cylinder, rectangle } = primitives

const cube = (x) => transforms.translate([x, 0, 0], cuboid({ size: [5, 5, 5] }))
const withFrames = (geometry, frames) =>
  Object.assign({}, geometry, { anchors: { frames, basis: geometry.polygons } })

test('measures a geom3 cube', () => {
  const m = measure(cuboid({ size: [10, 10, 10] }))
  expect(m.dimensions).toEqual([10, 10, 10])
  expect(m.volume).toBeCloseTo(1000, 3)
  expect(m.polygonCount).toBeGreaterThan(0)
})

test('measures a geom2 plate with area', () => {
  const m = measure(rectangle({ size: [30, 30] }))
  expect(m.area).toBeCloseTo(900, 3)
})

test('measureParts measures every item, a single item, and a range together', () => {
  const scene = [cube(0), cube(10), [cube(20), cube(30)]]
  const all = measureParts(scene, 'array', 'all')
  expect(all.map((p) => p.part)).toEqual(['0', '1', '2'])
  expect(all[1]).toMatchObject({ center: [10, 0, 0], dimensions: [5, 5, 5] })
  expect(all[1].volume).toBeCloseTo(125, 6)
  expect(all[2]).toMatchObject({ dimensions: [15, 5, 5], entityCount: 2 })
  const [range] = measureParts(scene, 'array', ['0-1'])
  expect(range).toMatchObject({ part: '0-1', dimensions: [15, 5, 5], center: [5, 0, 0] })
})

test('measureParts treats a single geometry as item 0 and rejects an index past the end', () => {
  expect(measureParts(cube(0), 'geom3', 'all')).toHaveLength(1)
  expect(() => measureParts([cube(0), cube(10)], 'array', ['1-2'])).toThrow(
    'part 1-2 is out of range; the model has 2 items (0-1)',
  )
})

test('measureBetween reports per-axis gap, box distance, and center offset', () => {
  const apart = measureBetween([cube(0), cube(10)], 'array', ['0', '1'])
  expect(apart).toEqual({
    a: '0',
    b: '1',
    gap: [5, -5, -5],
    boxesOverlap: false,
    distance: 5,
    centerOffset: [10, 0, 0],
    axes: { a: null, b: null, angle: null, offset: null },
  })
  const overlapping = measureBetween([cube(0), cube(3)], 'array', ['1', '0'])
  expect(overlapping).toMatchObject({ gap: [-2, -5, -5], boxesOverlap: true, distance: 0 })
  expect(overlapping.centerOffset).toEqual([-3, 0, 0])
})

test('measureBetween reports the symmetry axes of two round parts', () => {
  const pin = cylinder({ radius: 2, height: 10, segments: 32 })
  const bore = transforms.translate(
    [0.5, 0, 3],
    cylinder({ radius: 5, height: 4, segments: 32 }),
  )
  const r = measureBetween([pin, bore], 'array', ['0', '1'])
  expect(r.axes).toEqual({ a: [0, 0, 1], b: [0, 0, 1], angle: 0, offset: 0.5 })
})

test('measureBetween reads faces that touch within boolean noise as a zero gap', () => {
  const base = booleans.subtract(cuboid({ size: [10, 10, 10] }), cylinder({ radius: 2, height: 20 }))
  const post = transforms.translate([0, 0, 7 + 1e-13], cuboid({ size: [4, 4, 4] }))
  const r = measureBetween([base, post], 'array', ['0', '1'])
  expect(r.gap[2]).toBe(0)
  expect(r).toMatchObject({ boxesOverlap: false, distance: 0 })
})

test('measureAnchors lists each item explicit world frames, null for an array item', () => {
  const plate = withFrames(cuboid({ size: [30, 20, 5] }), {
    'bolt1.axis': { origin: [6, 2, 0], z: [0, 0, 1], x: [1, 0, 0] },
  })
  const pin = withFrames(cylinder({ radius: 2.9, height: 12, segments: 32 }), {
    axis: { origin: [6, 2, 0], z: [0, 0, -1], x: [-1, 0, 0] },
  })
  expect(measureAnchors([plate, pin], 'array')).toEqual([
    { part: '0', anchors: { 'bolt1.axis': { origin: [6, 2, 0], z: [0, 0, 1], x: [1, 0, 0] } } },
    { part: '1', anchors: { axis: { origin: [6, 2, 0], z: [0, 0, -1], x: [-1, 0, 0] } } },
  ])
  expect(measureAnchors([cube(0), [cube(10)]], 'array')).toEqual([
    { part: '0', anchors: {} },
    { part: '1', anchors: null },
  ])
  expect(measureAnchors(cube(0), 'geom3')).toEqual([{ part: '0', anchors: {} }])
})

test('measureAnchors prefixes a non-geometry item error with its part index', () => {
  expect(() => measureAnchors([cube(0), {}], 'array')).toThrow(
    'part 1: geometry must be geom2 or geom3',
  )
})

test('the public measure takes geometry plus options', () => {
  const m = measure(cuboid({ size: [10, 10, 10] }))
  expect(m.dimensions).toEqual([10, 10, 10])
  expect(m.volume).toBeCloseTo(1000, 3)
  const parts = measure([cube(0), cube(10)], { parts: 'all' }).parts
  expect(parts.map((p) => p.part)).toEqual(['0', '1'])
  const between = measure([cube(0), cube(10)], { between: ['0', '1'] }).between
  expect(between.distance).toBe(5)
})

test('measure accepts a bare selector string for parts, as a one-element list', () => {
  const parts = measure([cube(0), cube(10)], { parts: '1' }).parts
  expect(parts.map((p) => p.part)).toEqual(['1'])
})

test('measure accepts parts as a JSON array string, and index numbers', () => {
  const scene = [cube(0), cube(10), cube(20)]
  expect(measure(scene, { parts: '["0", "2"]' }).parts.map((p) => p.part)).toEqual(['0', '2'])
  expect(measure(scene, { parts: ' ["1-2"] ' }).parts.map((p) => p.part)).toEqual(['1-2'])
  expect(measure(scene, { parts: [0, '2'] }).parts.map((p) => p.part)).toEqual(['0', '2'])
  expect(measure(scene, { parts: '[1]' }).parts.map((p) => p.part)).toEqual(['1'])
  expect(() => measure(scene, { parts: '["0"' })).toThrow(/parts must be "all"/)
})

test('measure takes "all" inside a parts array as every part', () => {
  const scene = [cube(0), cube(10)]
  expect(measure(scene, { parts: ['all'] }).parts.map((p) => p.part)).toEqual(['0', '1'])
  expect(measure(scene, { parts: '["all"]' }).parts.map((p) => p.part)).toEqual(['0', '1'])
})

test('measure rejects a parts value that is not a selector, a range, or an array', () => {
  expect(() => measure(cube(0), { parts: true })).toThrow(/parts must be "all"/)
})

test('measure rejects a non-numeric part selector with a clear error', () => {
  expect(() => measure(cube(0), { parts: 'base' })).toThrow(
    'part "base" must be an index like "0" or a range like "1-3" — parts are indexes into the array main() returns',
  )
})

test('measure rejects a between that is not exactly two selectors', () => {
  expect(() => measure([cube(0), cube(10)], { between: [] })).toThrow(
    'between needs exactly two part selectors like "0" or "1-3", e.g. ["0", "1"]',
  )
  expect(() => measure([cube(0), cube(10)], { between: ['0'] })).toThrow('between needs exactly two part selectors')
})

test('measure rejects "all" in between, naming the forms it takes', () => {
  expect(() => measure([cube(0), cube(10)], { between: ['0', 'all'] })).toThrow(
    'between needs exactly two part selectors like "0" or "1-3", e.g. ["0", "1"]; "all" works only in parts',
  )
})

test('measure accepts a section as "z" or "z=<offset>"', () => {
  const cube20 = cuboid({ size: [20, 20, 20] })
  expect(measure(cube20, { section: 'z' }).section.offset).toBe(0)
  expect(measure(cube20, { section: 'z=5' }).section.offset).toBe(5)
})

test('measure rejects a section that is not an axis or axis=offset', () => {
  expect(() => measure(cuboid({ size: [10, 10, 10] }), { section: 'sideways' })).toThrow(
    'section must be an axis "x", "y", "z", or an offset like "z=5"',
  )
})

test('measure accepts a well-formed section object', () => {
  const cube20 = cuboid({ size: [20, 20, 20] })
  expect(measure(cube20, { section: { axis: 'z' } }).section.offset).toBe(0)
  expect(measure(cube20, { section: { axis: 'z', offset: 5 } }).section.offset).toBe(5)
})

test('measure rejects a section object with a bad axis or a non-finite offset', () => {
  const cube10 = cuboid({ size: [10, 10, 10] })
  expect(() => measure(cube10, { section: { axis: 'q' } })).toThrow(
    'section must be an axis "x", "y", "z", or an offset like "z=5"',
  )
  expect(() => measure(cube10, { section: { axis: 'z', offset: Infinity } })).toThrow(
    'section must be an axis "x", "y", "z", or an offset like "z=5"',
  )
  expect(() => measure(cube10, { section: { axis: 'z', offset: 'far' } })).toThrow(
    'section must be an axis "x", "y", "z", or an offset like "z=5"',
  )
})

test('measure notes a negative-volume solid as inside out', () => {
  const reversedCube = { ...cuboid({ size: [10, 10, 10] }) }
  reversedCube.polygons = reversedCube.polygons.map((p) => ({ ...p, vertices: [...p.vertices].reverse() }))
  const m = measure(reversedCube)
  expect(m.volume).toBeLessThan(0)
  expect(m.notes).toContain(
    'solid is inside out (volume < 0); a 2D outline given clockwise usually causes this; reverse its points',
  )
})


const insideOutCube = () => {
  const cube10 = { ...cuboid({ size: [10, 10, 10] }) }
  cube10.polygons = cube10.polygons.map((p) => ({ ...p, vertices: [...p.vertices].reverse() }))
  return cube10
}

test('measure flags a negative-volume solid as inside out', () => {
  expect(measure(insideOutCube()).insideOut).toBe(true)
  expect(measure(cuboid({ size: [10, 10, 10] }))).not.toHaveProperty('insideOut')
})

test('measure flags an array holding an inside-out solid, naming the part', () => {
  const m = measure([cuboid({ size: [2, 2, 2] }), insideOutCube()])
  expect(m.insideOut).toBe(true)
  expect(m.notes).toEqual([
    'part 1: solid is inside out (volume < 0); a 2D outline given clockwise usually causes this; reverse its points',
  ])
  expect(measure([cuboid({ size: [2, 2, 2] })])).not.toHaveProperty('insideOut')
})

const sortedPoints = (points) => [...points].map((p) => p.join(',')).sort()

test('a section gives each loop as an outline in the plane, holes marked', () => {
  const cup = booleans.subtract(cuboid({ size: [40, 30, 20] }), transforms.translate([0, 0, 2], cuboid({ size: [36, 26, 20] })))
  const { section } = measure(cup, { section: 'z=1' })
  expect(section.area).toBeCloseTo(264, 6)
  expect(section.plane).toEqual(['x', 'y'])
  expect(section.loops).toHaveLength(2)
  const [outer, hole] = section.loops
  expect(outer).toMatchObject({ hole: false, area: 1200 })
  expect(sortedPoints(outer.points)).toEqual(sortedPoints([[-20, -15], [20, -15], [20, 15], [-20, 15]]))
  expect(hole).toMatchObject({ hole: true, area: 936 })
  expect(sortedPoints(hole.points)).toEqual(sortedPoints([[-18, -13], [18, -13], [18, 13], [-18, 13]]))
  expect(measure(cup, { section: 'x' }).section.plane).toEqual(['y', 'z'])
  expect(measure(cup, { section: 'y' }).section.plane).toEqual(['x', 'z'])
})

test('a section outline keeps at most 40 points, on the shape', () => {
  const { section } = measure(cylinder({ radius: 10, height: 4, segments: 200 }), { section: 'z' })
  const [loop] = section.loops
  expect(loop.points.length).toBeLessThanOrEqual(40)
  expect(loop.points.length).toBeGreaterThanOrEqual(12)
  for (const [x, y] of loop.points) expect(Math.hypot(x, y)).toBeCloseTo(10, 2)
  expect(loop.area).toBeCloseTo(Math.PI * 100, 0)
})

test('a section lists at most 12 loops, largest first, and says how many it left out', () => {
  const pins = Array.from({ length: 25 }, (_, i) => transforms.translate([i * 10, 0, 0], cuboid({ size: [2 + i * 0.1, 2, 4] })))
  const { section } = measure(pins, { section: 'z' })
  expect(section.loops).toHaveLength(12)
  expect(section.loopsLeftOut).toBe(13)
  expect(section.loops[0].area).toBeGreaterThan(section.loops[11].area)
})
