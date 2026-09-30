// Extra geometry facts a fixture's checks can ask for (`fixture.probe`),
// computed by the grader next to `measure` and `check`: planar sections split
// into their separate loops (with outline shape facts on request), the separate
// bodies of the model, and the volume each pair of bodies shares.
import jscad from '@jscad/modeling'
import { wrapOne } from '@jscadui/model-tools/src/array-geom.js'
import { PLANE, axisCross, createWelder, cross2, crossing, newellNormal, signedArea } from '@jscadui/model-tools/src/section-geom.js'

const { booleans, geometries, measurements } = jscad

const AXES = ['x', 'y', 'z']
const WELD = 1e-4
const MIN_LOOP_AREA = 0.01
const MAX_LOOPS = 64
const MAX_OVERLAP_PAIRS = 45
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

// The section's closed loops, each with its signed area (outer loops positive,
// holes negative) and bounding box.
const sectionLoops = (polygons, i, at) => {
  const [u, v] = PLANE[i]
  const weld = createWelder(WELD)
  const uf = createUnionFind()
  const segments = []
  for (const vertices of polygons) {
    const seg = crossing(vertices, i, at)
    if (!seg) continue
    const t = axisCross(i, newellNormal(vertices))
    let [p, q] = seg
    if ((q[u] - p[u]) * t[u] + (q[v] - p[v]) * t[v] < 0) [p, q] = [q, p]
    const ids = [weld(p), weld(q)]
    uf.union(ids[0], ids[1])
    segments.push({ p, q, ids })
  }
  const loops = new Map()
  for (const { p, q, ids } of segments) {
    const root = uf.find(ids[0])
    if (!loops.has(root)) loops.set(root, { area: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], points: [], edges: [] })
    const loop = loops.get(root)
    loop.area += (p[u] * q[v] - q[u] * p[v]) / 2
    loop.points.push([p[u], p[v]])
    loop.edges.push({ from: ids[0], to: ids[1], p: [p[u], p[v]], q: [q[u], q[v]] })
    for (const pt of [p, q]) {
      for (let k = 0; k < 3; k++) {
        loop.lo[k] = Math.min(loop.lo[k], pt[k])
        loop.hi[k] = Math.max(loop.hi[k], pt[k])
      }
    }
  }
  return [...loops.values()].filter((l) => Math.abs(l.area) >= MIN_LOOP_AREA).sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
}

const loopFacts = ({ area, lo, hi }) => ({ area, boundingBox: [lo, hi], dimensions: hi.map((h, k) => h - lo[k]) })

const HARMONICS = 12
// 7-point Gauss-Legendre on [0, 1]: exact for the degree-13 polynomials the moments integrate.
const GAUSS = [
  [0, 0.4179591836734694],
  [0.4058451513773972, 0.3818300505051189],
  [-0.4058451513773972, 0.3818300505051189],
  [0.7415311855993945, 0.2797053914892766],
  [-0.7415311855993945, 0.2797053914892766],
  [0.9491079123427585, 0.1294849661688697],
  [-0.9491079123427585, 0.1294849661688697],
].map(([x, w]) => [(x + 1) / 2, w / 2])

const centroidOf = (edges, area) => {
  let cu = 0
  let cv = 0
  for (const { p, q } of edges) {
    const c = p[0] * q[1] - q[0] * p[1]
    cu += (p[0] + q[0]) * c
    cv += (p[1] + q[1]) * c
  }
  return [cu / (6 * area), cv / (6 * area)]
}

// Mean of (z - centre)^k over the loop's region, z = u + iv, by Green's theorem
// on F = (z - centre)^(k+1) / (k+1); dividing by the signed area makes a hole's
// region read the same as an outer loop's. `magnitude` is its size over reach^k,
// reach being the loop's farthest point from the centre.
const harmonicsOf = (edges, area, centre, reach) => {
  const sums = Array.from({ length: HARMONICS }, () => [0, 0])
  for (const { p, q } of edges) {
    const dv = q[1] - p[1]
    if (dv === 0) continue
    for (const [t, w] of GAUSS) {
      const re = p[0] + t * (q[0] - p[0]) - centre[0]
      const im = p[1] + t * (q[1] - p[1]) - centre[1]
      let [pr, pi] = [re * re - im * im, 2 * re * im]
      for (let k = 1; k <= HARMONICS; k++) {
        sums[k - 1][0] += (pr * w * dv) / (k + 1)
        sums[k - 1][1] += (pi * w * dv) / (k + 1)
        ;[pr, pi] = [pr * re - pi * im, pr * im + pi * re]
      }
    }
  }
  return sums.map(([re, im], n) => {
    const k = n + 1
    const [mr, mi] = [re / area, im / area]
    return { k, magnitude: Math.hypot(mr, mi) / reach ** k, angle: (Math.atan2(mi, mr) * 180) / Math.PI / k }
  })
}

const toSegment = (c, { p, q }) => {
  const [du, dv] = [q[0] - p[0], q[1] - p[1]]
  const len2 = du * du + dv * dv
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((c[0] - p[0]) * du + (c[1] - p[1]) * dv) / len2))
  return Math.hypot(p[0] + t * du - c[0], p[1] + t * dv - c[1])
}

// The loop's vertices and edge midpoints in order around it, or by angle about
// `centre` when its edges do not chain into one ring.
const ringOf = (edges, centre) => {
  const byStart = new Map(edges.map((e) => [e.from, e]))
  const ordered = []
  let edge = edges[0]
  while (edge && ordered.length < edges.length) {
    ordered.push(edge)
    edge = byStart.get(edge.to)
    if (edge === edges[0]) break
  }
  const chain = ordered.length === edges.length ? ordered : [...edges].sort((a, b) => Math.atan2(a.p[1] - centre[1], a.p[0] - centre[0]) - Math.atan2(b.p[1] - centre[1], b.p[0] - centre[0]))
  return chain.flatMap(({ p, q }) => [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]])
}

// Bumps outward around the loop's centroid: each rise from below 35% of its
// radius range to above 65%.
const lobesOf = (radii) => {
  const lo = radii.reduce((a, b) => Math.min(a, b), Infinity)
  const hi = radii.reduce((a, b) => Math.max(a, b), -Infinity)
  if (hi - lo < 0.02 * hi) return 0
  const [low, high] = [lo + 0.35 * (hi - lo), lo + 0.65 * (hi - lo)]
  const start = radii.findIndex((r) => r < low)
  let raised = false
  let count = 0
  for (let n = 1; n <= radii.length; n++) {
    const r = radii[(start + n) % radii.length]
    if (!raised && r > high) {
      count += 1
      raised = true
    } else if (raised && r < low) raised = false
  }
  return count
}

const outlineFacts = ({ area, edges }, centre) => {
  const centroid = centroidOf(edges, area)
  const far = edges.reduce((m, { p }) => Math.max(m, Math.hypot(p[0] - centre[0], p[1] - centre[1])), 0)
  const near = edges.reduce((m, e) => Math.min(m, toSegment(centre, e)), Infinity)
  return {
    centroid,
    perimeter: edges.reduce((sum, { p, q }) => sum + Math.hypot(q[0] - p[0], q[1] - p[1]), 0),
    radius: [near, far],
    lobes: lobesOf(ringOf(edges, centroid).map(([a, b]) => Math.hypot(a - centroid[0], b - centroid[1]))),
    harmonics: harmonicsOf(edges, area, centre, far),
  }
}

// Andrew's monotone chain.
const hullArea = (points) => {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return 0
  const half = (list) => {
    const out = []
    for (const p of list) {
      while (out.length >= 2 && cross2(out.at(-2), out.at(-1), p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return Math.abs(signedArea([...half(sorted), ...half([...sorted].reverse())]))
}

// Loops whose in-plane bounding boxes lie within `gap` of each other form one
// group; a group's hull less its area is what a cut took out of it.
const loopGroups = (loops, i, gap) => {
  const [u, v] = PLANE[i]
  const uf = createUnionFind()
  const apart = (a, b) =>
    Math.hypot(...[u, v].map((k) => Math.max(0, a.lo[k] - b.hi[k], b.lo[k] - a.hi[k])))
  for (let a = 0; a < loops.length; a++) {
    for (let b = a + 1; b < loops.length; b++) if (apart(loops[a], loops[b]) <= gap) uf.union(a, b)
  }
  const groups = new Map()
  loops.forEach((loop, n) => {
    const root = uf.find(n)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(loop)
  })
  return [...groups.values()].map((members) => ({
    loopCount: members.length,
    area: members.reduce((sum, l) => sum + l.area, 0),
    hullArea: hullArea(members.flatMap((l) => l.points)),
  }))
}

// `at` are fractions of the extent along the axis, `above` millimetres above its minimum.
const sectionsOf = (polygons, specs) => {
  const [lo, hi] = boxOf(polygons)
  const out = []
  for (const { axis, at = [], above = [], groupGap, outline = false } of specs) {
    const i = AXES.indexOf(axis)
    const cuts = [
      ...at.map((f) => ({ at: f, offset: lo[i] + f * (hi[i] - lo[i]) })),
      ...above.map((d) => ({ above: d, offset: lo[i] + d })),
    ]
    for (const { offset, ...where } of cuts) {
      const nudged = offset + NUDGE
      const inside = nudged > lo[i] && nudged < hi[i]
      const loops = inside ? sectionLoops(polygons, i, nudged) : []
      const kept = loops.slice(0, MAX_LOOPS)
      const section = { axis, ...where, offset: nudged, loopCount: loops.length, loops: kept.map(loopFacts) }
      if (outline && kept.length) {
        section.centre = centroidOf(kept[0].edges, kept[0].area)
        kept.forEach((loop, n) => Object.assign(section.loops[n], outlineFacts(loop, section.centre)))
      }
      if (groupGap !== undefined) section.groups = loopGroups(loops, i, groupGap)
      out.push(section)
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
    const weld = createWelder(WELD)
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

const boxesOverlap = ([aLo, aHi], [bLo, bHi]) => [0, 1, 2].every((k) => aLo[k] < bHi[k] && bLo[k] < aHi[k])

// Volume two bodies share, for each pair whose bounding boxes overlap; a pair
// left out shares none.
const overlapsOf = (groups, boxes) => {
  const solids = groups.map((polygons) => geometries.geom3.fromPoints(polygons))
  const out = []
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      if (!boxesOverlap(boxes[a], boxes[b])) continue
      if (out.length === MAX_OVERLAP_PAIRS) return out
      out.push({ a, b, volume: measurements.measureVolume(booleans.intersect(solids[a], solids[b])) })
    }
  }
  return out
}

/**
 * @param {unknown} geometry what main() returned
 * @param {{ sections?: Array<{axis:'x'|'y'|'z', at?:number[], above?:number[], groupGap?:number, outline?:boolean}>, bodies?: { sections?: Array<object>, overlaps?: boolean } }} spec
 */
export const runProbe = (geometry, spec) => {
  const items = polygonsOf(geometry)
  const out = {}
  if (spec.sections) out.sections = items.length ? sectionsOf(items.flat(), spec.sections) : []
  if (spec.bodies) {
    const groups = bodiesOf(items)
    const boxes = groups.map(boxOf)
    out.bodies = groups.map((polygons, n) => {
      const [lo, hi] = boxes[n]
      const body = { boundingBox: [lo, hi], dimensions: hi.map((h, k) => h - lo[k]), volume: volumeOf(polygons), polygonCount: polygons.length }
      if (spec.bodies.sections) body.sections = sectionsOf(polygons, spec.bodies.sections)
      return body
    })
    if (spec.bodies.overlaps) out.overlaps = overlapsOf(groups, boxes)
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

/**
 * How far an outline turns through successive cuts, from loops cut with
 * `outline: true`, one per cut in order: the lowest harmonic at least half as
 * strong as the strongest (in every loop), its angle unwrapped from cut to cut.
 * @returns {{ k: number, magnitude: number, degrees: number[] } | null} degrees from the first loop; magnitude is that harmonic's weakest
 */
export const turnOf = (loops) => {
  if (!loops.length || !loops.every((l) => l?.harmonics)) return null
  const floor = loops[0].harmonics.map((_, n) => Math.min(...loops.map((l) => l.harmonics[n].magnitude)))
  const best = Math.max(...floor)
  const n = floor.findIndex((m) => m >= 0.5 * best)
  const { k } = loops[0].harmonics[n]
  const period = 360 / k
  const degrees = [0]
  for (let j = 1; j < loops.length; j++) {
    const step = loops[j].harmonics[n].angle - loops[j - 1].harmonics[n].angle
    degrees.push(degrees[j - 1] + step - period * Math.round(step / period))
  }
  return { k, magnitude: floor[n], degrees }
}

const outerExtent = (section, axis) => {
  const outer = outerLoops(section)
  if (!outer.length) return null
  const [u, v] = PLANE[AXES.indexOf(axis)]
  const span = (k) => Math.max(...outer.map((l) => l.boundingBox[1][k])) - Math.min(...outer.map((l) => l.boundingBox[0][k]))
  return [span(u), span(v)].sort((a, b) => a - b)
}

const opening = (section, axis) => {
  const [hole] = holeLoops(section)
  return hole ? footprint(hole, axis) : null
}

const inside = (inner, outer) => (inner && outer && inner.every((d, k) => d <= outer[k]) ? outer.map((d, k) => d - inner[k]) : null)

// Per-dimension gaps where one cut's outline sits in the other's largest hole, either way round.
const fitGaps = (a, b, axis) => inside(outerExtent(a, axis), opening(b, axis)) ?? inside(outerExtent(b, axis), opening(a, axis))

const NEST_STEP = 0.1

/**
 * How deep `upper`'s bottom goes into `lower`'s top along `axis`, from bodies
 * cut along it (densely: a feature between two cuts is not seen), and the
 * least gap on each side of the fit over that depth. At each depth every cut of
 * `upper` below `lower`'s top must sit inside `lower`'s largest hole at that
 * height, or around its outline in a hole of its own, as a foot or a skirt does.
 * @returns {{ depth: number, play: number[] | null }} play (smaller footprint dimension first) is null when it does not go in
 */
export const nesting = (upper, lower, axis) => {
  const i = AXES.indexOf(axis)
  const cuts = (body, from) =>
    (body.sections ?? []).filter((s) => s.axis === axis && s.loops.length).map((section) => ({ section, h: from(section.offset) }))
  const up = cuts(upper, (o) => o - upper.boundingBox[0][i]).sort((a, b) => a.h - b.h)
  const low = cuts(lower, (o) => lower.boundingBox[1][i] - o)
  const height = lower.boundingBox[1][i] - lower.boundingBox[0][i]
  const nearest = (d) => low.reduce((best, c) => (Math.abs(c.h - d) < Math.abs(best.h - d) ? c : best))
  let fit = { depth: 0, play: null }
  if (!up.length || !low.length) return fit
  for (let n = 0; n < up.length; n++) {
    const next = n + 1 < up.length ? up[n + 1].h : height
    for (let depth = up[n].h; depth < next; depth += NEST_STEP) {
      const gaps = []
      for (const { section, h } of up.slice(0, n + 1)) {
        if (depth - h > height) return fit
        const g = fitGaps(section, nearest(depth - h).section, axis)
        if (!g) return fit
        gaps.push(g)
      }
      fit = { depth, play: [0, 1].map((k) => Math.min(...gaps.map((g) => g[k]))) }
    }
  }
  return fit
}
