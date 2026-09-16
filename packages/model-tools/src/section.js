import { measureArray, wrapOne } from './array-geom.js'

const AXES = ['x', 'y', 'z']

// Right-handed in-plane axes (u, v) for a cut normal to each axis.
const PLANE = [
  [1, 2],
  [2, 0],
  [0, 1],
]

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
      area += (p[u] * q[v] - q[u] * p[v]) / 2
      for (const pt of seg) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], pt[k])
          max[k] = Math.max(max[k], pt[k])
        }
      }
    }
  }
  if (min[0] === Infinity) {
    return { axis, offset: at, boundingBox: null, dimensions: [0, 0, 0], area: 0 }
  }
  return {
    axis,
    offset: at,
    boundingBox: [min, max],
    dimensions: max.map((m, k) => m - min[k]),
    area,
  }
}