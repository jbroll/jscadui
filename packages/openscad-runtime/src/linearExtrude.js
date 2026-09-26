/**
 * OpenSCAD's linear_extrude, ported from OpenSCAD 2026.09 (src/core/LinearExtrudeNode.cc,
 * src/geometry/linear_extrude.cc and src/core/CurveDiscretizer.cc).
 *
 * A twisted or scaled extrusion is a mesh whose shape depends on how many slices
 * OpenSCAD cuts, which edges it splits and which diagonal it takes across each
 * side quad, so each of those follows OpenSCAD step for step.
 */

import { _sinDeg, _cosDeg } from './math.js'

const GRID_FINE = 0.00000095367431640625
const F_MINIMUM = 0.01

const isFiniteNumber = (x) => typeof x === 'number' && Number.isFinite(x)

// Parameters::validate_integral: a finite number, truncated and clamped to lo
const integral = (x, lo) => (isFiniteNumber(x) ? Math.max(lo, Math.trunc(x)) : undefined)

/**
 * linear_extrude's arguments as builtin_linear_extrude reads them: `height` or
 * `h` (height wins), `v` the direction, `scale` a number or 2-vector clamped at
 * 0, `center` only when boolean, integral `slices` >= 1 and `segments` >= 0.
 * `height` defaults to 100, or to 1 when `v` gives the length.
 */
export const linearExtrudeParams = ({ height, h, v, scale, center, twist, slices, segments, $fn, $fa, $fs }) => {
  let dir = [0, 0, 1]
  let length = 100
  if (v !== undefined) {
    if (Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number')) dir = [...v]
    length = 1
  }
  const heightArg = height !== undefined ? height : h
  if (heightArg !== undefined) {
    length = isFiniteNumber(heightArg) ? heightArg : 100
    const norm = Math.hypot(...dir)
    if (norm > 0) dir = dir.map((c) => c / norm)
  }
  const vector = dir.map((c) => c * length)
  if (vector[2] <= 0) vector[2] = 0

  let scaleX = 1, scaleY = 1
  if (isFiniteNumber(scale)) {
    scaleX = scaleY = scale
  } else if (Array.isArray(scale) && scale.length === 2 && scale.every(isFiniteNumber)) {
    [scaleX, scaleY] = scale
  }
  if (scaleX < 0) scaleX = 0
  if (scaleY < 0) scaleY = 0

  const twistDeg = isFiniteNumber(twist) ? twist : 0

  return {
    vector,
    center: typeof center === 'boolean' ? center : false,
    scaleX,
    scaleY,
    twist: twistDeg,
    hasTwist: twistDeg !== 0,
    slices: integral(slices, 1),
    segments: integral(segments, 0),
    // CurveDiscretizer: NaN and infinities pass through, as they do in OpenSCAD
    fn: typeof $fn === 'number' ? ($fn < 0 ? 0 : $fn) : 0,
    fa: typeof $fa === 'number' ? ($fa < F_MINIMUM ? F_MINIMUM : $fa) : 12,
    fs: typeof $fs === 'number' ? ($fs < F_MINIMUM ? F_MINIMUM : $fs) : 2,
  }
}

// CurveDiscretizer::getHelixSlices
const helixSlices = (d, rSqr, height, twistDeg) => {
  const twist = Math.abs(twistDeg)
  const minSlices = Math.max(Math.ceil(twist / 120), 1)
  if (Math.sqrt(rSqr) < GRID_FINE || !Number.isFinite(d.fn) || Number.isNaN(height) || Number.isNaN(twist)) return undefined
  if (d.fn > 0) return Math.max(Math.ceil(twist / 360 * d.fn), minSlices)
  const T = twist * Math.PI / 180
  const c = height / T
  const arcLength = T * Math.sqrt(rSqr + c * c)
  return Math.max(Math.min(Math.ceil(twist / d.fa), Math.ceil(arcLength / d.fs)), minSlices)
}

const archimedesLength = (a, theta) => 0.5 * a * (theta * Math.sqrt(1 + theta * theta) + Math.asinh(theta))

// CurveDiscretizer::getConicalHelixSlices
const conicalHelixSlices = (d, rSqr, height, twistDeg, scale) => {
  const twist = Math.abs(twistDeg)
  const r = Math.sqrt(rSqr)
  const minSlices = Math.max(Math.ceil(twist / 120), 1)
  if (r < GRID_FINE || !Number.isFinite(d.fn)) return undefined
  if (d.fn > 0) return Math.max(Math.ceil(twist * d.fn / 360), minSlices)
  const rads = twist * Math.PI / 180
  const angleEnd = scale > 1 ? rads * scale / (scale - 1) : rads / (1 - scale)
  const angleStart = angleEnd - rads
  const a = r / angleEnd
  const spiralLength = archimedesLength(a, angleEnd) - archimedesLength(a, angleStart)
  const totalLength = Math.sqrt(spiralLength * spiralLength + height * height)
  return Math.max(Math.min(Math.ceil(totalLength / d.fs), Math.ceil(twist / d.fa)), minSlices)
}

// CurveDiscretizer::getDiagonalSlices
const diagonalSlices = (d, deltaSqr, height) => {
  if (Math.sqrt(deltaSqr) < GRID_FINE || !Number.isFinite(d.fn)) return undefined
  if (d.fn > 0) return Math.max(Math.trunc(d.fn), 1)
  return Math.max(Math.ceil(Math.sqrt(deltaSqr + height * height) / d.fs), 1)
}

const maxDeltaSqr = (outlines, sx, sy) => {
  let max = 0
  for (const o of outlines) {
    for (const [x, y] of o) max = Math.max(max, (x - x * sx) ** 2 + (y - y * sy) ** 2)
  }
  return max
}

// calc_num_slices
const numSlices = (p, outlines) => {
  if (p.slices !== undefined) return p.slices
  const height = p.vector[2]
  const twistFallback = () => Math.max(Math.ceil(p.twist / 120), 1)
  if (p.hasTwist) {
    let maxR1Sqr = 0
    for (const o of outlines) for (const [x, y] of o) maxR1Sqr = Math.max(maxR1Sqr, x * x + y * y)
    if (p.scaleX === 1 && p.scaleY === 1) {
      return helixSlices(p, maxR1Sqr, height, p.twist) ?? twistFallback()
    }
    if (p.scaleX !== p.scaleY) {
      const nonUniform = diagonalSlices(p, maxDeltaSqr(outlines, p.scaleX, p.scaleY), height) ?? 1
      return Math.max(nonUniform, helixSlices(p, maxR1Sqr, height, p.twist) ?? twistFallback())
    }
    return conicalHelixSlices(p, maxR1Sqr, height, p.twist, p.scaleX) ?? twistFallback()
  }
  if (p.scaleX !== p.scaleY) {
    return diagonalSlices(p, maxDeltaSqr(outlines, p.scaleX, p.scaleY), height) ?? 1
  }
  return 1
}

// Eigen::Scaling(scale) * rotate_degrees(angle) applied to [x, y]
const transform2 = (sx, sy, angle) => {
  const c = _cosDeg(angle), s = _sinDeg(angle)
  return ([x, y]) => [sx * (c * x - s * y), sy * (s * x + c * y)]
}

const lerp = (a, b, t) => a + (b - a) * t

// The length of edge v0-v1 at its longest over the slices, for a non-uniform scale
const maxEdgeLength = (v0, v1, twist, sx, sy, slices) => {
  let max = 0
  for (let j = 0; j <= slices; j++) {
    const t = j / slices
    const m = transform2(lerp(1, sx, t), lerp(1, sy, t), -twist * t)
    const a = m(v0), b = m(v1)
    max = Math.max(max, Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  return max
}

const edgeLengths = (o, twist, sx, sy, slices) => {
  const n = o.length
  const maxScale = Math.max(sx, 1)
  const lengths = []
  for (let i = 1; i <= n; i++) {
    const v0 = o[i - 1], v1 = o[i % n]
    lengths.push(sx !== sy
      ? maxEdgeLength(v0, v1, twist, sx, sy, slices)
      : Math.hypot(v1[0] - v0[0], v1[1] - v0[1]) * maxScale)
  }
  return lengths
}

// add_segmented_edge for every edge: `counts[i]` points from o[i] toward o[i + 1], o[i] first
const segmentedOutline = (o, counts) => {
  const n = o.length
  const out = []
  for (let i = 0; i < n; i++) {
    const v0 = o[i], v1 = o[(i + 1) % n]
    for (let j = 0; j < counts[i]; j++) {
      const t = j / counts[i]
      out.push([(1 - t) * v0[0] + t * v1[0], (1 - t) * v0[1] + t * v1[1]])
    }
  }
  return out
}

/**
 * splitOutlineByFn: while the outline has fewer than `fn` points, split once more
 * every edge whose (length / (pieces + 0.5)) is within 0.1% of the largest, as
 * long as the whole group still fits.
 */
const splitOutlineByFn = (o, twist, sx, sy, fn, slices) => {
  const lengths = edgeLengths(o, twist, sx, sy, slices)
  const counts = lengths.map(() => 1)
  const metric = (i) => lengths[i] / (counts[i] + 0.5)
  const closeMatch = (a, b) => Math.min(a, b) / Math.max(a, b) >= 0.999
  let total = o.length
  while (total < fn) {
    let top = 0
    for (let i = 1; i < counts.length; i++) if (metric(i) > metric(top)) top = i
    const topMetric = metric(top)
    const group = counts.map((_, i) => i).filter((i) => i === top || closeMatch(metric(i), topMetric))
    if (total + group.length > fn) break
    for (const i of group) counts[i]++
    total += group.length
  }
  return segmentedOutline(o, counts)
}

// splitOutlineByFs: split each edge into pieces no longer than fs
const splitOutlineByFs = (o, twist, sx, sy, fs, slices) =>
  segmentedOutline(o, edgeLengths(o, twist, sx, sy, slices).map((len) => Math.ceil(len / fs)))

// CurveDiscretizer::splitOutline
const splitOutline = (p, o, slices) => {
  const { twist, scaleX: sx, scaleY: sy, fn, fa, fs } = p
  const segments = p.segments ?? 0
  if (segments > 0 || fn > 0) {
    const minVertices = segments > 0 ? segments : Math.trunc(Math.max(fn, 3))
    return o.length >= minVertices ? o : splitOutlineByFn(o, twist, sx, sy, minVertices, slices)
  }
  const faSegs = Math.ceil(360 / fa)
  if (o.length >= faSegs) return o
  const byFs = splitOutlineByFs(o, twist, sx, sy, fs, slices)
  return byFs.length >= faSegs ? splitOutlineByFn(o, twist, sx, sy, faSegs, slices) : byFs
}

// sgn_vdiff: -1, 0 or 1 comparing |a| and |b|, equal within 5 orders of magnitude
const sgnVdiff = (a, b) => {
  const l1 = Math.hypot(a[0], a[1]), l2 = Math.hypot(b[0], b[1])
  return 2 * Math.abs(l1 - l2) * 1e5 > l1 + l2 ? (l1 < l2 ? -1 : 1) : 0
}

const signedArea = (o) => {
  let a = 0
  for (let i = 0; i < o.length; i++) {
    const p0 = o[i], p1 = o[(i + 1) % o.length]
    a += p0[0] * p1[1] - p1[0] * p0[1]
  }
  return a / 2
}

/**
 * Side triangles of the extrusion, as add_slice_indices builds them: each quad
 * is split along its shorter diagonal (measured in XY), ties broken by the
 * outline's orientation and the twist direction.
 */
const sideTriangles = (p, outlines, positive, n, stride) => {
  const tris = []
  for (let s = 1; s <= n; s++) {
    const bottom = (s - 1) * stride, top = s * stride
    const rotBot = p.twist * (s - 1) / n, rotTop = p.twist * s / n
    const topX = 1 - (1 - p.scaleX) * s / n, topY = 1 - (1 - p.scaleY) * s / n
    const mBot = transform2(1 - (1 - p.scaleX) * (s - 1) / n, 1 - (1 - p.scaleY) * (s - 1) / n, -rotBot)
    const mTop = transform2(topX, topY, -rotTop)
    // A slice whose top collapses takes the other diagonal
    const anyZero = topX === 0 || topY === 0
    const backTwist = rotTop <= rotBot
    let first = 0
    outlines.forEach((o, k) => {
      const flip = !positive[k] !== backTwist
      let prevBot = mBot(o[0]), prevTop = mTop(o[0])
      for (let i = 1; i <= o.length; i++) {
        const oi = i % o.length
        const vBot = mBot(o[oi]), vTop = mTop(o[oi])
        const idx = first + oi, prev = first + i - 1
        const diff = sgnVdiff([prevBot[0] - vTop[0], prevBot[1] - vTop[1]], [vBot[0] - prevTop[0], vBot[1] - prevTop[1]])
        const splitFirst = diff === -1 || (diff === 0 && !flip)
        if (splitFirst !== anyZero) {
          tris.push([bottom + idx, top + idx, bottom + prev], [top + prev, bottom + prev, top + idx])
        } else {
          tris.push([bottom + idx, top + prev, bottom + prev], [bottom + idx, top + idx, top + prev])
        }
        prevBot = vBot
        prevTop = vTop
      }
      first += o.length
    })
  }
  return tris
}

/**
 * Triangles covering the outlines (holes included) that use every outline point.
 * Earcut drops collinear points, which the side walls still use, and can run a
 * triangle edge along several outlines at once (a row of holes whose edges line
 * up). Each cap edge is therefore split at every outline point lying on it, its
 * triangle fanned out through them, and earcut's zero-area triangles, which the
 * split edges replace, are dropped.
 */
const capTriangles = (outlines, slice) => {
  const flat = outlines.flat()
  const indexOf = new Map()
  flat.forEach(([x, y], i) => {
    const key = `${x},${y}`
    if (!indexOf.has(key)) indexOf.set(key, i)
  })

  // slice.toPolygons can pair a hole with the wrong outline when outlines nest
  // several deep, so each outline goes in with only its own holes: a hole
  // belongs to the smallest outline around it.
  const area = outlines.map(signedArea)
  const inside = ([x, y], o) => {
    let odd = false
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
      const [xi, yi] = o[i], [xj, yj] = o[j]
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) odd = !odd
    }
    return odd
  }
  const groups = new Map()
  outlines.forEach((o, k) => { if (area[k] > 0) groups.set(k, [o]) })
  outlines.forEach((o, k) => {
    if (area[k] > 0) return
    let parent
    for (const g of groups.keys()) {
      if (inside(o[0], outlines[g]) && (parent === undefined || area[g] < area[parent])) parent = g
    }
    if (parent !== undefined) groups.get(parent).push(o)
  })

  const collinear = ([a, b, c]) => {
    const [pa, pb, pc] = [flat[a], flat[b], flat[c]]
    const cross = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1])
    const len2 = Math.max(...[[pa, pb], [pb, pc], [pc, pa]].map(([p, q]) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2))
    return Math.abs(cross) <= 1e-9 * len2
  }
  const sidesOf = (rs) => rs.flatMap((o) => o.map((pt, i) => [pt, o[(i + 1) % o.length]]))
  const tris = []
  for (const group of groups.values()) {
    for (const poly of slice.toPolygons(slice.fromSides(sidesOf(group)))) {
      const tri = poly.vertices.map(([x, y]) => indexOf.get(`${x},${y}`))
      if (tri.some((i) => i === undefined) || collinear(tri)) continue
      tris.push(tri)
    }
  }

  // Outline points strictly inside segment a-b, in order from a
  const byX = [...indexOf.values()].sort((i, j) => flat[i][0] - flat[j][0])
  const firstAtLeast = (x) => {
    let lo = 0, hi = byX.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (flat[byX[mid]][0] < x) lo = mid + 1; else hi = mid }
    return lo
  }
  const pointsBetween = (a, b) => {
    const pa = flat[a], pb = flat[b]
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1]
    const len2 = dx * dx + dy * dy
    const tol = 1e-9 * Math.sqrt(len2)
    const [x0, x1] = [Math.min(pa[0], pb[0]) - tol, Math.max(pa[0], pb[0]) + tol]
    const found = []
    for (let k = firstAtLeast(x0); k < byX.length && flat[byX[k]][0] <= x1; k++) {
      const i = byX[k]
      if (i === a || i === b) continue
      const p = flat[i]
      const t = ((p[0] - pa[0]) * dx + (p[1] - pa[1]) * dy) / len2
      if (t <= 0 || t >= 1) continue
      if (Math.abs((p[0] - pa[0]) * dy - (p[1] - pa[1]) * dx) <= 1e-9 * len2) found.push([t, i])
    }
    return found.sort((u, v) => u[0] - v[0]).map(([, i]) => i)
  }

  const out = []
  for (const [a, b, c] of tris) {
    const ab = pointsBetween(a, b), bc = pointsBetween(b, c), ca = pointsBetween(c, a)
    if (ab.length + bc.length + ca.length === 0) {
      out.push([a, b, c])
      continue
    }
    // Fan from the corner opposite the longest run of inserted points
    const loop = [a, ...ab, b, ...bc, c, ...ca]
    const apex = ab.length >= bc.length && ab.length >= ca.length ? loop.indexOf(c)
      : bc.length >= ca.length ? 0 : loop.indexOf(b)
    for (let i = 1; i < loop.length - 1; i++) {
      out.push([loop[apex], loop[(apex + i) % loop.length], loop[(apex + i + 1) % loop.length]])
    }
  }
  return out
}

/**
 * The extrusion mesh, as extrudePolygon builds it for the Manifold backend:
 * `numSlices + 1` copies of the (split) outlines, side triangles between them,
 * and the base triangulation as bottom cap and, transformed, as top cap.
 *
 * @param {object} p - linearExtrudeParams() result
 * @param {Array<Array<[number, number]>>} outlines - the profile's outlines
 * @param {object} slice - @jscad/modeling's extrusions slice, for cap triangulation
 * @returns {{ points: number[][], faces: number[][] } | undefined}
 */
export const linearExtrudeMesh = (p, outlines, slice) => {
  if (p.vector[2] <= 0) return undefined
  outlines = outlines.filter((o) => o.length >= 3)
  if (outlines.length === 0) return undefined

  const n = numSlices(p, outlines)
  const nonLinear = p.twist !== 0 || p.scaleX !== p.scaleY
  const split = !(p.segments === 0) && ((p.segments ?? 0) > 0 || nonLinear)
  const ref = split ? outlines.map((o) => splitOutline(p, o, n)) : outlines
  const positive = ref.map((o) => signedArea(o) > 0)

  const stride = ref.reduce((sum, o) => sum + o.length, 0)
  const h = p.vector
  const h1 = p.center ? h.map((c) => -c / 2) : [0, 0, 0]
  const points = []
  for (let s = 0; s <= n; s++) {
    const m = transform2(1 - (1 - p.scaleX) * s / n, 1 - (1 - p.scaleY) * s / n, -p.twist * s / n)
    const offset = h.map((c, k) => h1[k] + c * s / n)
    for (const o of ref) {
      for (const v of o) {
        const [x, y] = m(v)
        points.push([x + offset[0], y + offset[1], offset[2]])
      }
    }
  }

  const faces = sideTriangles(p, ref, positive, n, stride)
  const topOffset = stride * n
  for (const [a, b0, c0] of capTriangles(ref, slice)) {
    // Caps face up at the top, down at the bottom
    const pa = points[a], pb = points[b0], pc = points[c0]
    const ccw = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1]) >= 0
    const [b, c] = ccw ? [b0, c0] : [c0, b0]
    faces.push([a + topOffset, b + topOffset, c + topOffset], [c, b, a])
  }
  return { points, faces }
}
