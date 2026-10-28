import { afterEach, expect, test, vi } from 'vitest'
import jscad from '@jscad/modeling'
import { check, INTERFERENCE_BUDGET_MS, INTERFERENCE_EPSILON, MAX_INTERSECTIONS } from '../index.js'
import { interference, sharedPairs } from '../src/interference.js'

const { booleans, primitives } = jscad

afterEach(() => vi.restoreAllMocks())
const { cuboid, rectangle } = primitives

const cube = (x, extra = {}) => Object.assign(cuboid({ size: [10, 10, 10], center: [x, 0, 0] }), extra)
const withFrames = (geometry, frames) =>
  Object.assign({}, geometry, { anchors: { frames, basis: geometry.polygons } })

test('constants', () => {
  expect(INTERFERENCE_EPSILON).toBe(0.001)
  expect(MAX_INTERSECTIONS).toBe(300)
  expect(INTERFERENCE_BUDGET_MS).toBe(5000)
})

test('two overlapping cubes are interference', () => {
  const r = check([cube(0), cube(5)])
  expect(r.interference.pairs).toHaveLength(1)
  const [pair] = r.interference.pairs
  expect(pair).toEqual({ a: '0', b: '1', volume: 500, size: [5, 10, 10] })
  expect(r.interference.total).toBe(1)
})

test('volumes are rounded to 0.0001 mm³', () => {
  const ball = (extra) => Object.assign(primitives.sphere({ radius: 3, center: [5, 0, 0], segments: 16 }), extra)
  const r = check([cube(0), ball(), ball({ reference: { reason: 'x', allow: ['0'] } })])
  const volumes = [...r.interference.pairs.map((p) => p.volume), ...r.references[0].overlaps.map((o) => o.volume)]
  expect(volumes.length).toBeGreaterThan(0)
  for (const v of volumes) expect(Math.round(v * 1e4) / 1e4).toBe(v)
})

test('interference.volume sums every non-allowed pair, past the 20 listed', () => {
  const r = check(Array.from({ length: 22 }, () => cube(0)))
  expect(r.interference.volume).toBe(231 * 1000)
})

test('interference.volume leaves out allowed pairs', () => {
  const r = check([cube(0), cube(5), cube(7, { reference: { reason: 'x', allow: ['0'] } })])
  expect(r.interference.volume).toBe(500 + 800)
})

test('sharedPairs reports allowed and unallowed pairs, and none for boxes that overlap alone', () => {
  const notch = booleans.subtract(cuboid({ size: [10, 10, 10] }), primitives.cuboid({ size: [6, 6, 12], center: [3, 3, 0] }))
  const inNotch = cuboid({ size: [3, 3, 3], center: [3.5, 3.5, 0] })
  expect(sharedPairs([notch, inNotch]).shared).toEqual([])
  const { shared } = sharedPairs([cube(0), cube(5, { reference: { reason: 'x', allow: ['0'] } })])
  expect(shared).toEqual([{ a: 0, b: 1, volume: 500, size: [5, 10, 10], allowedBy: [1] }])
})

test('cubes that touch at a face share nothing', () => {
  expect(check([cube(0), cube(10)])).not.toHaveProperty('interference')
})

test('a reference part collides', () => {
  const r = check([cube(0), cube(5, { reference: 'NEMA 17' })])
  expect(r.interference.pairs).toHaveLength(1)
  expect(r.references).toEqual([{ part: '1', reason: 'NEMA 17', overlaps: [] }])
})

test('a non-enumerable reference tag is read', () => {
  const motor = cube(5)
  Object.defineProperty(motor, 'reference', { value: 'NEMA 17', writable: true, configurable: true, enumerable: false })
  expect(check([cube(0), motor]).references).toEqual([{ part: '1', reason: 'NEMA 17', overlaps: [] }])
})

test('allow lets a reference overlap the named part', () => {
  const r = check([cube(0), cube(5, { reference: { reason: 'film path', allow: ['0'] } })])
  expect(r).not.toHaveProperty('interference')
  expect(r.references).toHaveLength(1)
  expect(r.references[0]).toMatchObject({ part: '1', reason: 'film path', allow: ['0'] })
  expect(r.references[0].overlaps).toEqual([{ part: '0', volume: 500 }])
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

test('a pair whose intersect throws is counted unchecked and the other pairs are still reported', () => {
  const broken = cube(5)
  const intersect = booleans.intersect
  vi.spyOn(booleans, 'intersect').mockImplementation((a, b) => {
    if (a === broken || b === broken) throw new Error('Not manifold')
    return intersect(a, b)
  })
  const r = check([cube(0), cube(3), broken])
  expect(r.interferenceUnchecked).toBe(2)
  expect(r.interference.pairs).toEqual([expect.objectContaining({ a: '0', b: '1' })])
})

test('once the time budget is spent the remaining pairs are unchecked, largest box overlap checked first', () => {
  const intersect = vi.spyOn(booleans, 'intersect')
  const now = () => (intersect.mock.calls.length > 0 ? INTERFERENCE_BUDGET_MS + 1 : 0)
  // Box overlaps: parts 0 and 2 share 900 mm³, 1 and 2 share 200, 0 and 1 share 100.
  const r = interference([cube(0), cube(9), cube(1)], { now })
  expect(intersect).toHaveBeenCalledTimes(1)
  expect(r.interferenceUnchecked).toBe(2)
  expect(r.interference.pairs).toEqual([expect.objectContaining({ a: '0', b: '2' })])
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

const stale = (i, selector) => `part ${i}: allow ${selector} shares no volume with it; remove it from allow`

test('an allow naming a part the reference does not touch is a tag error', () => {
  const r = check([cube(0), cube(50), cube(5, { reference: { reason: 'x', allow: ['0', '1'] } })])
  expect(r.tagErrors).toEqual([stale(2, '1')])
})

test('an allow naming an overlapped part is no error and lists the overlap', () => {
  const r = check([cube(0), cube(5, { reference: { reason: 'x', allow: ['0'] } })])
  expect(r).not.toHaveProperty('tagErrors')
  expect(r.references[0].overlaps).toEqual([{ part: '0', volume: 500 }])
})

test('a range allow is fine when one named part overlaps', () => {
  const r = check([cube(0), cube(50), cube(5, { reference: { reason: 'x', allow: ['0-1'] } })])
  expect(r).not.toHaveProperty('tagErrors')
})

test('an allow whose pair went unchecked is no error', () => {
  const r = interference([cube(0), cube(5, { reference: { reason: 'x', allow: ['0'] } })], { now: (() => { let n = 0; return () => (n++ ? 1e9 : 0) })() })
  expect(r.interferenceUnchecked).toBe(1)
  expect(r).not.toHaveProperty('tagErrors')
})

test('a reason of only whitespace is a tag error', () => {
  expect(check([cube(0), cube(50, { reference: '  ' })]).tagErrors).toEqual(['part 1: reference needs a reason'])
})
