import { describe, it, expect, beforeAll } from 'vitest'
import j$ from '@jscadui/openscad-runtime'
import { initScadRuntime } from '../bin/run-jscad.js'

type Ghost = { polygons?: { vertices: number[][] }[], sides?: number[][][], color: number[], previewOnly: boolean }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const J = j$ as unknown as Record<string, any>

const bounds = (points: number[][]) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const p of points) for (let i = 0; i < p.length; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]) }
  return [lo.slice(0, points[0].length), hi.slice(0, points[0].length)]
}
const ghostBounds = (g: Ghost) => g.polygons
  ? bounds(g.polygons.flatMap(p => p.vertices))
  : bounds(g.sides!.flat())

describe('overlay core', () => {
  beforeAll(async () => { await initScadRuntime() })

  it('withOverlays returns a result without overlays unchanged', () => {
    const c = J.cube({ size: 10 })
    expect(J.withOverlays(c)).toBe(c)
    expect(J.withOverlays(undefined)).toBe(undefined)
  })

  it('highlight returns its child and adds a pink ghost', () => {
    const c = J.cube({ size: 10 })
    expect(J.highlight(c)).toBe(c)
    const out = J.withOverlays(c)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(c)
    expect(out[1].previewOnly).toBe(true)
    expect(out[1].color).toEqual([1, 0.32, 0.32, 0.5])
    expect(ghostBounds(out[1])).toEqual([[0, 0, 0], [10, 10, 10]])
  })

  it('background returns a placeholder that is only a grey ghost', () => {
    const out = J.withOverlays(J.background(J.cube({ size: 4 })))
    expect(out).toHaveLength(1)
    expect(out[0].color).toEqual([0.5, 0.5, 0.5, 0.3])
    expect(ghostBounds(out[0])).toEqual([[0, 0, 0], [4, 4, 4]])
  })

  it('records nothing for an absent child', () => {
    expect(J.highlight(J.NO_CHILD)).toBe(J.NO_CHILD)
    expect(J.highlight(undefined)).toBe(undefined)
    expect(J.background(J.NO_CHILD)).toBe(J.NO_CHILD)
    expect(J.background(undefined)).toBe(J.NO_CHILD)
  })

  it('snapshots a 2D child as sides', () => {
    const out = J.withOverlays(J.background(J.square({ size: 3 })))
    expect(out[0].sides.length).toBeGreaterThan(0)
    expect(ghostBounds(out[0])).toEqual([[0, 0], [3, 3]])
  })

  it('keeps the ghost after the highlighted child is disposed', () => {
    const c = J.cube({ size: 10 })
    J.highlight(c)
    const out = J.withOverlays(c)
    c.dispose()
    expect(ghostBounds(out[1])).toEqual([[0, 0, 0], [10, 10, 10]])
  })

  it('waits for a promised child', async () => {
    const out = await J.withOverlays(J.highlight(Promise.resolve(J.cube({ size: 2 }))))
    expect(out).toHaveLength(2)
  })
})

describe('overlays through ops (manifold)', () => {
  let measure: (g: unknown) => number[][]
  beforeAll(async () => {
    const ctx = await initScadRuntime()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    measure = (g) => (ctx.jscadModeling as any).measurements.measureBoundingBox(g)
  })

  const cube = () => J.cube({ size: 10 })
  const close = (a: number[][], b: number[][]) => {
    for (let i = 0; i < 2; i++) for (let k = 0; k < a[i].length; k++) expect(a[i][k]).toBeCloseTo(b[i][k], 4)
  }

  // Each transform's ghost must land where the engine put the real geometry.
  const transforms: [string, (g: unknown) => unknown][] = [
    ['translate', g => J.translate([1, 2, 3], g)],
    ['rotate euler', g => J.rotate([10, 20, 30], g)],
    ['rotate scalar', g => J.rotate(40, g)],
    ['rotate a=[..]', g => J.rotate({ a: [0, 90, 0] }, g)],
    ['rotate axis', g => J.rotate({ a: 30, v: [1, 1, 0] }, g)],
    ['scale', g => J.scale([2, 1, 3], g)],
    ['scale uniform', g => J.scale(2, g)],
    ['mirror', g => J.mirror([1, 0, 0], g)],
    ['mirror short', g => J.mirror([0, 1], g)],
    ['multmatrix', g => J.multmatrix([[1, 0, 0, 5], [0, 1, 0, 0], [0, 0, 1, 0]], g)],
    ['resize', g => J.resize([20, 0, 0], g)],
  ]
  it.each(transforms)('%s moves the ghost with the geometry', (_name, op) => {
    const expected = measure(op(cube()))
    const out = J.withOverlays(op(J.highlight(cube())))
    expect(out).toHaveLength(2)
    close(ghostBounds(out[1]), expected)
    close(measure(out[0]), expected)
  })

  it('nested transforms compose in OpenSCAD order', () => {
    const expected = measure(J.translate([10, 0, 0], J.rotate([0, 0, 90], cube())))
    const out = J.withOverlays(J.translate([10, 0, 0], J.rotate([0, 0, 90], J.highlight(cube()))))
    close(ghostBounds(out[1]), expected)
  })

  it('a mirrored ghost keeps outward winding', () => {
    const [, ghost] = J.withOverlays(J.mirror([1, 0, 0], J.highlight(cube())))
    const [a, b, c] = ghost.polygons[0].vertices
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]
    const centroid = ghost.polygons[0].vertices.reduce((s: number[], v: number[]) => s.map((x, i) => x + v[i] / ghost.polygons[0].vertices.length), [0, 0, 0])
    const out = centroid.map((x: number, i: number) => x - (i === 0 ? -5 : 5))
    expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0)
  })

  const multi: [string, (a: unknown, b: unknown) => unknown][] = [
    ['safeUnion', (a, b) => J.safeUnion([a, [b]])],
    ['union', (a, b) => J.union(a, b)],
    ['subtract', (a, b) => J.subtract(a, b)],
    ['intersect', (a, b) => J.intersect(a, b)],
    ['hull', (a, b) => J.hull(a, b)],
    ['minkowski', (a, b) => J.minkowski(a, b)],
  ]
  it.each(multi)('%s keeps a highlighted operand\'s ghost', (_name, op) => {
    const out = J.withOverlays(op(cube(), J.highlight(J.translate([5, 5, 5], cube()))))
    expect(out.filter((g: Ghost) => g.previewOnly)).toHaveLength(1)
  })

  it.each(multi)('%s leaves a background operand out of the CSG', (_name, op) => {
    const plain = measure(op(cube(), J.NO_CHILD) ?? cube())
    const out = J.withOverlays(op(cube(), J.background(J.translate([50, 50, 50], cube()))))
    expect(out.filter((g: Ghost) => g.previewOnly)).toHaveLength(1)
    close(measure(out[0]), plain)
  })

  it('an undefined result still carries its operands\' ghosts', () => {
    // intersect with an empty (undefined) operand returns undefined
    const out = J.withOverlays(J.intersect(J.highlight(cube()), undefined))
    expect(out).toHaveLength(1)
    expect(out[0].previewOnly).toBe(true)
  })

  it('a highlighted child survives disposal by the op that consumes it', () => {
    const out = J.withOverlays(J.union(J.highlight(cube()), J.translate([20, 0, 0], cube())))
    close(ghostBounds(out[1]), [[0, 0, 0], [10, 10, 10]])
  })

  it('color, offset and the extrusions pass ghosts through', () => {
    expect(J.withOverlays(J.color('red', undefined, J.highlight(cube())))).toHaveLength(2)
    const sq = () => J.square({ size: 10 })
    expect(J.withOverlays(J.offset({ delta: 1 }, J.highlight(sq())))).toHaveLength(2)
    expect(J.withOverlays(J.linearExtrude({ height: 2 }, J.highlight(sq())))).toHaveLength(2)
    expect(J.withOverlays(J.rotateExtrude({}, J.highlight(J.translate([5, 0], sq()))))).toHaveLength(2)
  })

  it('childrenAt carries ghosts for one index and for a list', () => {
    const kids = [() => J.highlight(cube()), () => J.translate([20, 0, 0], cube())]
    expect(J.withOverlays(J.childrenAt(kids, 0))).toHaveLength(2)
    expect(J.withOverlays(J.childrenAt(kids, [0, 1]))).toHaveLength(2)
    expect(J.withOverlays(J.childrenAtRange(kids, 0, 1, 1))).toHaveLength(2)
  })

  it('a background-only transform chain reads as empty', () => {
    const out = J.translate([1, 0, 0], J.background(cube()))
    expect(J.withOverlays(out)).toHaveLength(1)
    const cut = J.withOverlays(J.intersect(cube(), out))
    expect(cut).toHaveLength(1)
    expect(cut[0].previewOnly).toBe(true)
  })

  it('a background-only op result reads as empty', () => {
    const out = J.union(J.background(cube()))
    const cut = J.withOverlays(J.intersect(cube(), out))
    expect(cut).toHaveLength(1)
    expect(cut[0].previewOnly).toBe(true)
  })

  it('highlight keeps a background child absent', () => {
    const plain = J.withOverlays(J.intersect(cube(), J.highlight(J.background(J.translate([50, 50, 50], cube())))))
    expect(plain.filter((g: Ghost) => !g.previewOnly)).toHaveLength(1)
  })
})

// Every function on j$ is either a geometry op the tests above cover, or not
// a geometry op. A new function fails here until someone decides which.
const GEOMETRY_OPS = ['translate', 'rotate', 'scale', 'mirror', 'multmatrix', 'resize', 'safeUnion', 'safeUnion2D',
  'union', 'subtract', 'intersect', 'hull', 'minkowski', 'childrenAt', 'childrenAtRange', 'color', 'offset',
  'linearExtrude', 'rotateExtrude']
const NOT_GEOMETRY_OPS: string[] = ['_list_pattern', 'applyPositionalArgs', 'assert', 'background', 'band', 'bnot',
  'bor', 'chr', 'circle', 'cosDeg', 'cross', 'cube', 'cylinder', 'echo', 'enterScope', 'eq', 'exitScope',
  'getSpecialVar', 'highlight', 'init', 'isTruthy', 'is_consistent', 'is_vector', 'iter', 'lookup', 'max', 'min',
  'norm', 'num', 'ord', 'parent_module', 'polygon', 'polyhedron', 'polyhedronHull', 'popScope', 'pushScope', 'rands',
  'range', 'recursionDetected', 'region', 'regular_polygon', 'resetRng', 'resetScope', 'resolveParams', 'reverse',
  'scopeDepth', 'scopeSnapshot', 'search', 'setSpecialVar', 'shl', 'shr', 'sinDeg', 'sphere', 'square', 'str',
  'tanDeg', 'text', 'trunc', 'vadd', 'vdiv', 'version', 'version_num', 'vmul', 'vneg', 'vsub', 'withOverlays',
  'withScope', 'withScopeFrom']

describe('overlay coverage', () => {
  it('classifies every function on j$', () => {
    const fns = Object.keys(J).filter(k => typeof J[k] === 'function').sort()
    const known = new Set([...GEOMETRY_OPS, ...NOT_GEOMETRY_OPS])
    expect(fns.filter(k => !known.has(k))).toEqual([])
  })
})
