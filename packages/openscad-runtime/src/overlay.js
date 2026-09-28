/**
 * Ghost geometry for OpenSCAD's % (background) and # (highlight) modifiers.
 * Overlays ride beside the real geometry in a WeakMap and reach the viewport
 * as previewOnly entities, which every export drops.
 */
import { NO_CHILD } from './sentinels.js'

const COLORS = { background: [0.5, 0.5, 0.5, 0.3], highlight: [1, 0.32, 0.32, 0.5] }

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

export const mul = (a, b) => {
  const out = new Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = s
    }
  }
  return out
}

const apply = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

const det3 = (m) =>
  m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])

let geom2, geom3

export const initOverlays = (jscad) => {
  geom2 = jscad.geometries.geom2
  geom3 = jscad.geometries.geom3
}

const table = new WeakMap()

// Stands in for a child whose only content is overlays. `empty` keeps the
// difference between an empty result (undefined) and an absent one (NO_CHILD):
// OpenSCAD skips a % node only as a direct child, so once an op wraps it, it is empty.
export class Ghosts {
  constructor(list, empty) {
    this.list = list
    this.empty = empty
  }
}

export const isGhosts = (x) => x instanceof Ghosts

const isThenable = (x) => x !== null && typeof x === 'object' && typeof x.then === 'function'

const present = (g) => g !== undefined && g !== null && g !== NO_CHILD && !(g instanceof Ghosts)

export const overlaysOf = (x) => {
  if (x === null || typeof x !== 'object') return []
  if (Array.isArray(x)) return x.flatMap(overlaysOf)
  if (x instanceof Ghosts) return x.list
  return table.get(x) ?? []
}

export const strip = (x) => {
  if (x instanceof Ghosts) return x.empty ? undefined : NO_CHILD
  if (Array.isArray(x)) return x.filter(g => !(g instanceof Ghosts)).map(strip)
  return x
}

const forget = (x) => {
  if (x === null || typeof x !== 'object') return
  if (Array.isArray(x)) x.forEach(forget)
  else table.delete(x)
}

export const attach = (result, list, empty = true) => {
  if (list.length === 0) return result
  if (isThenable(result)) return result.then(r => attach(r, list, empty))
  if (Array.isArray(result)) {
    forget(result)
    return [...result, new Ghosts(list, false)]
  }
  if (result === null || typeof result !== 'object' || result instanceof Ghosts) return new Ghosts(list, empty)
  table.set(result, list)
  return result
}

export const gathering = (op) => function (...args) {
  const list = overlaysOf(args)
  if (list.length === 0) return op.apply(this, args)
  return attach(op.apply(this, args.map(strip)), list)
}

export const affine = (matrixOf, op) => function (arg, geo) {
  const list = overlaysOf(geo)
  if (list.length === 0) return op.call(this, arg, geo)
  const g = strip(geo)
  const m = matrixOf(arg, g)
  return attach(op.call(this, arg, g), list.map(o => ({ ...o, matrix: mul(m, o.matrix) })))
}

// `in`, not a read: on ManifoldGeom2 these are getters that convert the cross-section.
const is2D = (g) => 'sides' in g || 'outlines' in g

const snapshot = (g) => {
  if (is2D(g)) return { dim: 2, sides: geom2.toSides(g).map(([a, b]) => [[a[0], a[1]], [b[0], b[1]]]) }
  const polygons = g.isManifoldGeom3 ? g.polygons : geom3.toPolygons(g)
  return { dim: 3, polygons: polygons.map(p => p.vertices.map(v => [v[0], v[1], v[2]])) }
}

// Taken now: under # the child is also a CSG input, and consume.js disposes it.
const snapshots = (kind, child) =>
  [child].flat(Infinity).filter(present).map(g => ({ kind, mesh: snapshot(g), matrix: IDENTITY }))

export const highlight = (child) => {
  if (isThenable(child)) return child.then(highlight)
  const absent = child === NO_CHILD || (child instanceof Ghosts && !child.empty)
  return attach(child, [...overlaysOf(child), ...snapshots('highlight', strip(child))], !absent)
}

export const background = (child) => {
  if (isThenable(child)) return child.then(background)
  const list = [...overlaysOf(child), ...snapshots('background', strip(child))]
  return list.length === 0 ? NO_CHILD : new Ghosts(list, false)
}

// A module body whose only statement is `%x`: the module node exists, so it is empty.
export const group = (child) => {
  if (isThenable(child)) return child.then(group)
  return child instanceof Ghosts && !child.empty ? new Ghosts(child.list, true) : child
}

const ghostOf =({ kind, mesh, matrix }) => {
  const flip = det3(matrix) < 0
  const base = { transforms: [...IDENTITY], color: [...COLORS[kind]], previewOnly: true }
  if (mesh.dim === 2) {
    const to2 = (p) => apply(matrix, [p[0], p[1], 0]).slice(0, 2)
    return { ...base, sides: mesh.sides.map(([a, b]) => flip ? [to2(b), to2(a)] : [to2(a), to2(b)]) }
  }
  return {
    ...base,
    polygons: mesh.polygons.map(vs => {
      const out = vs.map(v => apply(matrix, v))
      return { vertices: flip ? out.reverse() : out }
    }),
  }
}

export const withOverlays = (result) => {
  if (isThenable(result)) return result.then(withOverlays)
  const list = overlaysOf(result)
  if (list.length === 0) return result
  const solids = [strip(result)].flat(Infinity).filter(present)
  return [...solids, ...merged(list)]
}

// One entity per kind and dimension: the viewport caps the entity count, and a
// loop of # children would otherwise spend one per iteration.
const merged = (list) => {
  const byKey = new Map()
  for (const o of list) {
    const g = ghostOf(o)
    const key = `${o.kind}${o.mesh.dim}`
    const into = byKey.get(key)
    if (!into) byKey.set(key, g)
    else if (g.sides) for (const s of g.sides) into.sides.push(s)
    else for (const p of g.polygons) into.polygons.push(p)
  }
  return [...byKey.values()]
}
