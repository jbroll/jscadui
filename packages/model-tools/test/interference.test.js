import { expect, test } from 'vitest'
import jscad from '@jscad/modeling'
import { check, INTERFERENCE_EPSILON, MAX_INTERSECTIONS } from '../index.js'

const { primitives } = jscad
const { cuboid, rectangle } = primitives

const cube = (x, extra = {}) => Object.assign(cuboid({ size: [10, 10, 10], center: [x, 0, 0] }), extra)
const withFrames = (geometry, frames) =>
  Object.assign({}, geometry, { anchors: { frames, basis: geometry.polygons } })

test('constants', () => {
  expect(INTERFERENCE_EPSILON).toBe(0.001)
  expect(MAX_INTERSECTIONS).toBe(300)
})

test('two overlapping cubes are interference', () => {
  const r = check([cube(0), cube(5)])
  expect(r.interference.pairs).toHaveLength(1)
  const [pair] = r.interference.pairs
  expect(pair).toMatchObject({ a: '0', b: '1' })
  expect(pair.volume).toBeCloseTo(500, 3)
  pair.size.forEach((s, i) => expect(s).toBeCloseTo([5, 10, 10][i], 3))
  expect(r.interference.total).toBe(1)
})

test('cubes that touch at a face share nothing', () => {
  expect(check([cube(0), cube(10)])).not.toHaveProperty('interference')
})

test('a reference part collides', () => {
  const r = check([cube(0), cube(5, { reference: 'NEMA 17' })])
  expect(r.interference.pairs).toHaveLength(1)
  expect(r.references).toEqual([{ part: '1', reason: 'NEMA 17', overlaps: [] }])
})

test('allow lets a reference overlap the named part', () => {
  const r = check([cube(0), cube(5, { reference: { reason: 'film path', allow: ['0'] } })])
  expect(r).not.toHaveProperty('interference')
  expect(r.references).toHaveLength(1)
  expect(r.references[0]).toMatchObject({ part: '1', reason: 'film path', allow: ['0'] })
  expect(r.references[0].overlaps).toHaveLength(1)
  expect(r.references[0].overlaps[0].part).toBe('0')
  expect(r.references[0].overlaps[0].volume).toBeCloseTo(500, 3)
})

test('allow takes an anchor part name', () => {
  const gate = withFrames(cube(0), { gate: { origin: [0, 0, 0], z: [0, 0, 1] } })
  const r = check([gate, cube(5, { reference: { reason: 'film path', allow: ['gate'] } })])
  expect(r).not.toHaveProperty('interference')
  expect(r.references[0].overlaps[0].part).toBe('0')
})

test('two reference parts collide', () => {
  const r = check([cube(0, { reference: 'a' }), cube(5, { reference: 'b' })])
  expect(r.interference.pairs).toHaveLength(1)
})

test('a reference that allows itself is a tag error', () => {
  const r = check([cube(0), cube(50, { reference: { reason: 'x', allow: ['1'] } })])
  expect(r.tagErrors).toContain('part 1: reference allows itself')
})

test('malformed tags are tag errors naming the part', () => {
  const bad = [{}, { reason: '' }, { reason: 'x', allow: '0' }, { reason: 'x', allow: ['9'] }]
  const r = check([cube(0), ...bad.map((reference, i) => cube(100 * (i + 1), { reference }))])
  expect(r.tagErrors).toHaveLength(4)
  expect(r.tagErrors[0]).toBe('part 1: reference needs a reason')
  expect(r.tagErrors[1]).toBe('part 2: reference needs a reason')
  expect(r.tagErrors[2]).toBe('part 3: allow must be a list of part selectors')
  expect(r.tagErrors[3]).toMatch(/^part 4: allow 9: .*out of range/)
})

test('pairs are sorted largest first and capped at 20', () => {
  const r = check(Array.from({ length: 22 }, () => cube(0)))
  expect(r.interference.pairs).toHaveLength(20)
  expect(r.interference.total).toBe(231)
  expect(r.interference.pairs[0].volume).toBeGreaterThanOrEqual(r.interference.pairs[19].volume)
})

test('past MAX_INTERSECTIONS candidates are counted, not intersected', () => {
  const r = check(Array.from({ length: 26 }, () => cuboid({ size: [1, 1, 1] })))
  expect(r.interferenceUnchecked).toBe(25)
  expect(r.interference.total).toBe(300)
})

test('interference: false skips the work', () => {
  expect(check([cube(0), cube(5)], { interference: false })).not.toHaveProperty('interference')
})

test('geom2 items never intersect', () => {
  const r = check([rectangle({ size: [10, 10] }), rectangle({ size: [10, 10] })])
  expect(r).not.toHaveProperty('interference')
})

test('nested arrays and non-geometry items are skipped', () => {
  const r = check([cube(0), [cube(0)], 'x'])
  expect(r).not.toHaveProperty('interference')
})

test('previewOnly items are not parts', () => {
  expect(check([cube(0), cube(5, { previewOnly: true })])).not.toHaveProperty('interference')
})
