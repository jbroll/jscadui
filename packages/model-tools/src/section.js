import { measureArray, wrapOne } from './array-geom.js'

const AXES = ['x', 'y', 'z']

// Right-handed in-plane axes (u, v) for a cut normal to each axis.
const PLANE = [
  [1, 2],
  [2, 0],
  [0, 1],
]
// The in-plane axes an outline's points are given in, in axis order.
const OUTLINE_PLANE = [
  [1, 2],
  [0, 2],
  [0, 1],
]

const MAX_LOOPS = 12
const MAX_POINTS = 40
const MIN_LOOP_AREA = 1e-4
const WELD = 1e-5

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

// One segment per convex polygon crossing the plane. A vertex on the plane
// counts as above it, so each crossing polygon yields exactly two points.
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

const axisCross = (i, n) => {
  const a = [0, 0, 0]
  a[i] = 1
  return [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]]
}

const round3 = (v) => Math.round(v * 1000) / 1000 + 0

// Ids for points, the same id for points within WELD of each other.
const createWelder = () => {
  const cells = new Map()
  const points = []
  return (p) => {
    const c = p.map((x) => Math.floor(x / WELD))
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of cells.get(`${c[0] + dx},${c[1] + dy}`) ?? []) {
          if (Math.abs(points[id][0] - p[0]) <= WELD && Math.abs(points[id][1] - p[1]) <= WELD) return id
        }
      }
    }
    const id = points.length
    points.push(p)
    const key = `${c[0]},${c[1]}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(id)
    return id
  }
}

const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

const signedArea = (points) => {
  let area = 0
  for (let k = 0; k < points.length; k++) {
    const [x0, y0] = points[k]
    const [x1, y1] = points[(k + 1) % points.length]
    area += x0 * y1 - x1 * y0
  }
  return area / 2
}

// Joins the oriented segments end to start into closed loops of (u, v) points.
const chainLoops = (segments) => {
  const weld = createWelder()
  const edges = segments.map(([p, q]) => ({ from: weld(p), to: weld(q), p }))
  const leaving = new Map()
  edges.forEach((edge, n) => {
    if (!leaving.has(edge.from)) leaving.set(edge.from, [])
    leaving.get(edge.from).push(n)
  })
  const used = new Set()
  const loops = []
  for (let start = 0; start < edges.length; start++) {
    if (used.has(start)) continue
    const points = []
    let n = start
    while (n !== undefined && !used.has(n)) {
      used.add(n)
      points.push(edges[n].p)
      n = leaving.get(edges[n].to)?.find((next) => !used.has(next))
    }
    if (points.length >= 3) loops.push(points)
  }
  return loops
}

const withoutCollinear = (points) => {
  const out = points.filter((b, k) => {
    const a = points[(k - 1 + points.length) % points.length]
    const c = points[(k + 1) % points.length]
    return Math.abs(cross2(a, b, c)) > 1e-9
  })
  return out.length >= 3 ? out : points
}

// Visvalingam: drop the point whose triangle with its neighbours is smallest
// until `max` remain; a very long outline is thinned evenly first.
const simplified = (points, max) => {
  let out = withoutCollinear(points)
  if (out.length > 50 * max) {
    const step = out.length / (50 * max)
    out = Array.from({ length: 50 * max }, (_, k) => out[Math.floor(k * step)])
  }
  while (out.length > max) {
    let drop = 0
    let least = Infinity
    for (let k = 0; k < out.length; k++) {
      const area = Math.abs(cross2(out[(k - 1 + out.length) % out.length], out[k], out[(k + 1) % out.length]))
      if (area < least) {
        least = area
        drop = k
      }
    }
    out.splice(drop, 1)
  }
  return out
}

// Each loop largest first: its area, whether it is a hole, and up to
// MAX_POINTS of its points in OUTLINE_PLANE order.
const outlinesOf = (segments, i) => {
  const [u, v] = PLANE[i]
  const [a, b] = OUTLINE_PLANE[i]
  const loops = chainLoops(segments.map(([p, q]) => [[p[u], p[v]], [q[u], q[v]]]))
    .map((points) => ({ points, area: signedArea(points) }))
    .filter((loop) => Math.abs(loop.area) >= MIN_LOOP_AREA)
    .sort((x, y) => Math.abs(y.area) - Math.abs(x.area))
  const shown = loops.slice(0, MAX_LOOPS).map(({ points, area }) => ({
    area: round3(Math.abs(area)),
    hole: area < 0,
    points: simplified(points, MAX_POINTS).map(([pu, pv]) => {
      const point = []
      point[u] = pu
      point[v] = pv
      return [round3(point[a]), round3(point[b])]
    }),
  }))
  return { loops: shown, ...(loops.length > MAX_LOOPS ? { loopsLeftOut: loops.length - MAX_LOOPS } : {}) }
}

export const sectionOutline = (geom, geomType, { axis, offset }) => {
  const i = AXES.indexOf(axis)
  const [u, v] = PLANE[i]
  const items = (geomType === 'array' ? geom.flat(Infinity) : [geom]).map(wrapOne)
  const solids = items.filter((g) => typeof g?.toPolygons === 'function')
  if (!solids.length) throw new Error('a section needs 3D geometry')
  const [lo, hi] = measureArray(solids).boundingBox
  const at = offset ?? (lo[i] + hi[i]) / 2
  if (!(at >= lo[i] && at <= hi[i])) {
    throw new Error(
      `section offset ${at} is outside the model's ${axis} range ${lo[i]} to ${hi[i]}`,
    )
  }
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const segments = []
  let area = 0
  for (const solid of solids) {
    for (const { vertices } of solid.toPolygons()) {
      const seg = crossing(vertices, i, at)
      if (!seg) continue
      // Orienting each segment along axis x outward normal walks outer loops
      // counterclockwise and holes clockwise, so the shoelace sum nets out holes.
      const t = axisCross(i, newellNormal(vertices))
      let [p, q] = seg
      if ((q[u] - p[u]) * t[u] + (q[v] - p[v]) * t[v] < 0) [p, q] = [q, p]
      segments.push([p, q])
      area += (p[u] * q[v] - q[u] * p[v]) / 2
      for (const pt of seg) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], pt[k])
          max[k] = Math.max(max[k], pt[k])
        }
      }
    }
  }
  const plane = OUTLINE_PLANE[i].map((k) => AXES[k])
  if (min[0] === Infinity) {
    return { axis, offset: at, boundingBox: null, dimensions: [0, 0, 0], area: 0, plane, loops: [] }
  }
  return {
    axis,
    offset: at,
    boundingBox: [min, max],
    dimensions: max.map((m, k) => m - min[k]),
    area,
    plane,
    ...outlinesOf(segments, i),
  }
}
