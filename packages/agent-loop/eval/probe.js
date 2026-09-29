// Extra geometry facts a fixture's checks can ask for (`fixture.probe`),
// computed by the grader next to `measure` and `check`: planar sections split
// into their separate loops, and the separate bodies of the model.
import { wrapOne } from '@jscadui/model-tools/src/array-geom.js'

const AXES = ['x', 'y', 'z']
// Right-handed in-plane axes (u, v) for a cut normal to each axis, as in model-tools' section.js.
const PLANE = [
  [1, 2],
  [2, 0],
  [0, 1],
]
const WELD = 1e-4
const MIN_LOOP_AREA = 0.01
const MAX_LOOPS = 64
// Keeps a cut off the round-number faces of a model built from round numbers.
const NUDGE = 1.234e-4

const polygonsOf = (geometry) =>
  [geometry]
    .flat(Infinity)
    .map(wrapOne)
    .filter((g) => typeof g?.toPolygons === 'function')
    .map((g) => g.toPolygons().map((p) => p.vertices))

const boxOf = (polygons) => {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const vertices of polygons) {
    for (const p of vertices) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k])
        hi[k] = Math.max(hi[k], p[k])
      }
    }
  }
  return [lo, hi]
}

// Welds points closer than WELD into one id.
const createWelder = (dims) => {
  const cells = new Map()
  const points = []
  const cellKey = (c) => c.join(',')
  const neighbors = (c, k = 0, acc = [...c]) => {
    if (k === c.length) return [cellKey(acc)]
    const out = []
    for (const d of [-1, 0, 1]) {
      acc[k] = c[k] + d
      out.push(...neighbors(c, k + 1, acc))
    }
    return out
  }
  return (p) => {
    const q = dims.map((k) => p[k])
    const c = q.map((x) => Math.floor(x / WELD))
    for (const key of neighbors(c)) {
      for (const id of cells.get(key) ?? []) {
        if (points[id].every((x, i) => Math.abs(x - q[i]) <= WELD)) return id
      }
    }
    const id = points.length
    points.push(q)
    const key = cellKey(c)
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(id)
    return id
  }
}

const createUnionFind = () => {
  const parent = []
  const find = (i) => {
    parent[i] ??= i
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  return { find, union: (a, b) => (parent[find(a)] = find(b)) }
}

const newellNormal = (vertices) => {
  const n = [0, 0, 0]
  for (let j = 0; j < vertices.length; j++) {
    const [x1, y1, z1] = vertices[j]
    const [x2, y2, z2] = vertices[(j + 1) % vertices.length]
    n[0] += (y1 - y2) * (z1 + z2)
    n[1] += (z1 - z2) * (x1 + x2)
    n[2] += (x1 - x2) * (y1 + y2)
  }
  return n
}

const crossing = (vertices, i, at) => {
  const points = []
  for (let j = 0; j < vertices.length; j++) {
    const p = vertices[j]
    const q = vertices[(j + 1) % vertices.length]
    const sp = p[i] - at
    const sq = q[i] - at
    if (sp >= 0 === sq >= 0) continue
    const t = sp / (sp - sq)
    points.push(p.map((c, k) => (k === i ? at : c + t * (q[k] - c))))
  }
  return points.length === 2 ? points : null
}

// The section's closed loops, each with its signed area (outer loops positive,
// holes negative) and bounding box.
const sectionLoops = (polygons, i, at) => {
  const [u, v] = PLANE[i]
  const weld = createWelder([0, 1, 2])
  const uf = createUnionFind()
  const segments = []
  for (const vertices of polygons) {
    const seg = crossing(vertices, i, at)
    if (!seg) continue
    const n = newellNormal(vertices)
    const a = [0, 0, 0]
    a[i] = 1
    const t = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]]
    let [p, q] = seg
    if ((q[u] - p[u]) * t[u] + (q[v] - p[v]) * t[v] < 0) [p, q] = [q, p]
    const ids = [weld(p), weld(q)]
    uf.union(ids[0], ids[1])
    segments.push({ p, q, id: ids[0] })
  }
  const loops = new Map()
  for (const { p, q, id } of segments) {
    const root = uf.find(id)
    if (!loops.has(root)) loops.set(root, { area: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] })
    const loop = loops.get(root)
    loop.area += (p[u] * q[v] - q[u] * p[v]) / 2
    for (const pt of [p, q]) {
      for (let k = 0; k < 3; k++) {
        loop.lo[k] = Math.min(loop.lo[k], pt[k])
        loop.hi[k] = Math.max(loop.hi[k], pt[k])
      }
    }
  }
  return [...loops.values()]
    .filter((l) => Math.abs(l.area) >= MIN_LOOP_AREA)
    .sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
    .map(({ area, lo, hi }) => ({ area, boundingBox: [lo, hi], dimensions: hi.map((h, k) => h - lo[k]) }))
}

// `at` are fractions of the extent along the axis, `above` millimetres above its minimum.
const sectionsOf = (polygons, specs) => {
  const [lo, hi] = boxOf(polygons)
  const out = []
  for (const { axis, at = [], above = [] } of specs) {
    const i = AXES.indexOf(axis)
    const cuts = [
      ...at.map((f) => ({ at: f, offset: lo[i] + f * (hi[i] - lo[i]) })),
      ...above.map((d) => ({ above: d, offset: lo[i] + d })),
    ]
    for (const { offset, ...where } of cuts) {
      const nudged = offset + NUDGE
      const inside = nudged > lo[i] && nudged < hi[i]
      const loops = inside ? sectionLoops(polygons, i, nudged) : []
      out.push({ axis, ...where, offset: nudged, loopCount: loops.length, loops: loops.slice(0, MAX_LOOPS) })
    }
  }
  return out
}

const volumeOf = (polygons) => {
  let volume = 0
  for (const vs of polygons) {
    for (let j = 1; j + 1 < vs.length; j++) {
      const [a, b, c] = [vs[0], vs[j], vs[j + 1]]
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
  }
  return volume
}

// Polygons sharing a vertex belong to one body; each item of an array is its own.
const bodiesOf = (items) =>
  items.flatMap((polygons) => {
    const weld = createWelder([0, 1, 2])
    const uf = createUnionFind()
    const firstIds = polygons.map((vertices) => {
      const ids = vertices.map(weld)
      for (const id of ids) uf.union(id, ids[0])
      return ids[0]
    })
    const groups = new Map()
    polygons.forEach((vertices, n) => {
      const root = uf.find(firstIds[n])
      if (!groups.has(root)) groups.set(root, [])
      groups.get(root).push(vertices)
    })
    return [...groups.values()]
  })

/**
 * @param {unknown} geometry what main() returned
 * @param {{ sections?: Array<{axis:'x'|'y'|'z', at?:number[], above?:number[]}>, bodies?: { sections?: Array<object> } }} spec
 */
export const runProbe = (geometry, spec) => {
  const items = polygonsOf(geometry)
  const out = {}
  if (spec.sections) out.sections = items.length ? sectionsOf(items.flat(), spec.sections) : []
  if (spec.bodies) {
    out.bodies = bodiesOf(items).map((polygons) => {
      const [lo, hi] = boxOf(polygons)
      const body = { boundingBox: [lo, hi], dimensions: hi.map((h, k) => h - lo[k]), volume: volumeOf(polygons) }
      if (spec.bodies.sections) body.sections = sectionsOf(polygons, spec.bodies.sections)
      return body
    })
  }
  return out
}

export const outerLoops = (section) => section?.loops?.filter((l) => l.area > 0) ?? []
export const holeLoops = (section) => section?.loops?.filter((l) => l.area < 0) ?? []

// A loop's two in-plane dimensions, smaller first, so a turned part compares equal.
export const footprint = (loop, axis) => {
  const [u, v] = PLANE[AXES.indexOf(axis)]
  return [loop.dimensions[u], loop.dimensions[v]].sort((a, b) => a - b)
}
