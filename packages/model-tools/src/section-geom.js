// Plane-cut helpers shared by section.js and agent-loop's eval probe.

// Right-handed in-plane axes (u, v) for a cut normal to each axis.
export const PLANE = [
  [1, 2],
  [2, 0],
  [0, 1],
]

export const newellNormal = (vertices) => {
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
export const crossing = (vertices, i, at) => {
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

export const axisCross = (i, n) => {
  const a = [0, 0, 0]
  a[i] = 1
  return [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]]
}

export const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

export const signedArea = (points) => {
  let area = 0
  for (let k = 0; k < points.length; k++) {
    const [x0, y0] = points[k]
    const [x1, y1] = points[(k + 1) % points.length]
    area += x0 * y1 - x1 * y0
  }
  return area / 2
}

// Ids for points of any dimension, the same id for points within `tolerance`
// of each other on every coordinate.
export const createWelder = (tolerance) => {
  const cells = new Map()
  const points = []
  const neighbors = (c, k = 0, acc = [...c]) => {
    if (k === c.length) return [acc.join(',')]
    const out = []
    for (const d of [-1, 0, 1]) {
      acc[k] = c[k] + d
      out.push(...neighbors(c, k + 1, acc))
    }
    return out
  }
  return (p) => {
    const c = p.map((x) => Math.floor(x / tolerance))
    for (const key of neighbors(c)) {
      for (const id of cells.get(key) ?? []) {
        if (points[id].every((x, k) => Math.abs(x - p[k]) <= tolerance)) return id
      }
    }
    const id = points.length
    points.push(p)
    const key = c.join(',')
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(id)
    return id
  }
}
