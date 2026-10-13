// Tag mechanics and frame math for the model tree.
//
// A node's `anchors` tag is `null` or `{ frames, pending, basis }`:
//   frames  — named concrete frames `{ name: { origin, z, x } }`
//   pending — unresolved directional descriptors `{ node, direction, basis }`
//   basis   — the constant `'tree'`, matched by jscad-anchors' `inSync` rule
//             so wrapping already-tagged factory output a second time no-ops.
//
// `productionTagOps(engine)` returns the `{ map, carry, merge, drop }` group
// table Task 2's factory calls at construction. Frame math runs on the injected
// engine's `maths`, so both engines share one implementation. The ghost math is
// copied from openscad-runtime's `overlay.js` (no runtime import; the engine
// workers cannot reach that package).

const UP = [0, 0, 1]
const DOWN = [0, 0, -1]
const BACK = [0, 1, 0]

export const TREE_BASIS = 'tree'

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

const GHOST_COLORS = { background: [0.5, 0.5, 0.5, 0.3], highlight: [1, 0.32, 0.32, 0.5] }

const point3 = (v) => [v[0], v[1] || 0, v[2] || 0]

// Plain-array frame math mirroring jscad-anchors' `frame.js`, over engine.maths.
export const makeFrameMath = (engine) => {
  const { vec3, mat4 } = engine.maths
  const normalize = (v) => vec3.normalize(vec3.create(), point3(v))

  // BOSL2 affine3d_rot_from_to(UP, z); axis from vector_axis, which picks BACK for DOWN.
  const rotationFromUp = (z) => {
    const w = normalize(z)
    if (vec3.distance(w, UP) < 1e-9) return mat4.create()
    const axis = vec3.distance(w, DOWN) < 1e-9
      ? [0, 1, 0]
      : vec3.normalize(vec3.create(), vec3.cross(vec3.create(), UP, w))
    const angle = Math.acos(Math.max(-1, Math.min(1, w[2])))
    return mat4.fromRotation(mat4.create(), angle, axis)
  }

  const spinReference = (z) => point3(vec3.transform(vec3.create(), [1, 0, 0], rotationFromUp(z)))

  const frame = (origin, z, x) => {
    const zn = normalize(z)
    let xn = null
    if (x) {
      const xv = point3(x)
      const xo = vec3.subtract(vec3.create(), xv, vec3.scale(vec3.create(), zn, vec3.dot(xv, zn)))
      if (vec3.length(xo) > 1e-6 * vec3.length(xv)) xn = vec3.normalize(vec3.create(), xo)
    }
    if (!xn) xn = spinReference(zn)
    return { origin: point3(origin), z: zn, x: xn }
  }

  const yHint = (d) => {
    const nonzero = d.filter((c) => c !== 0).length
    if (nonzero === 1) return d[2] !== 0 ? BACK : UP
    if (nonzero !== 2) return UP
    const faces = [[d[0], 0, 0], [0, d[1], 0], [0, 0, d[2]]].filter((_, i) => d[i] !== 0)
    const e = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), faces[0], faces[1]))
    if (Math.abs(e[2]) > 1e-9) return vec3.scale(vec3.create(), e, Math.sign(e[2]))
    const c = vec3.cross(vec3.create(), UP, e)
    const target = vec3.scale(vec3.create(), vec3.normalize(vec3.create(), [d[0], d[1], 0]), d[2])
    return vec3.distance(c, target) < 1e-9 ? e : vec3.scale(vec3.create(), e, -1)
  }

  const frameFromY = (origin, z, y) => {
    const zn = normalize(z)
    const yn = vec3.subtract(vec3.create(), point3(y), vec3.scale(vec3.create(), zn, vec3.dot(y, zn)))
    return frame(origin, zn, vec3.cross(vec3.create(), yn, zn))
  }

  const yOf = (f) => point3(vec3.cross(vec3.create(), f.z, f.x))

  const frameToMat4 = (f) => {
    const y = yOf(f)
    return mat4.fromValues(
      f.x[0], f.x[1], f.x[2], 0,
      y[0], y[1], y[2], 0,
      f.z[0], f.z[1], f.z[2], 0,
      f.origin[0], f.origin[1], f.origin[2], 1,
    )
  }

  const linear = (m, v) => [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ]

  const transformFrame = (matrix, f) =>
    frame(vec3.transform(vec3.create(), f.origin, matrix), linear(matrix, f.z), linear(matrix, f.x))

  return { frame, frameFromY, frameToMat4, transformFrame, yOf, yHint }
}

// Build-time orientation for a directional descriptor: z along the direction,
// x from the same yHint rule `defaults.js` uses. Frames with only an origin at
// resolution time reuse this basis so no geometry is read at build.
export const directionBasis = (math, direction) => {
  if (direction.every((c) => c === 0)) return { z: UP, x: [1, 0, 0] }
  const f = math.frameFromY([0, 0, 0], direction, math.yHint(direction))
  return { z: f.z, x: f.x }
}

// Shared bbox -> placement helper: origin = center + direction * size/2, with
// the descriptor's build-time orientation basis (or the direction's). Used for
// descriptor resolution and by Task 13's thin `center`/`align` branches.
export const frameFromBBox = (math, bbox, direction, basis) => {
  const [min, max] = bbox
  const origin = [0, 1, 2].map((i) => {
    const lo = min[i] || 0
    const hi = max[i] || 0
    return (lo + hi) / 2 + (direction[i] || 0) * (hi - lo) / 2
  })
  const b = basis && basis.z ? basis : directionBasis(math, direction)
  return math.frame(origin, b.z, b.x)
}

const tagOf = (child) => (child && child.anchors) || null

const mergeTags = (tags) => {
  const frames = {}
  const pending = []
  for (const tag of tags) {
    if (!tag) continue
    for (const [name, f] of Object.entries(tag.frames || {})) {
      if (!Object.hasOwn(frames, name)) frames[name] = f
    }
    if (Array.isArray(tag.pending)) pending.push(...tag.pending)
  }
  if (Object.keys(frames).length === 0 && pending.length === 0) return null
  return { frames, pending, basis: TREE_BASIS }
}

// The production tag ops: matrix-known transforms map frames through the node's
// stored matrix, keep-group ops carry, anchored booleans merge, drop ops drop.
export const productionTagOps = (engine) => {
  const math = makeFrameMath(engine)
  const ofChildren = (children) => mergeTags((children || []).map(tagOf))
  return {
    map: (node, children) => {
      const tag = ofChildren(children)
      if (!tag || !node.matrix) return tag
      const frames = {}
      for (const [name, f] of Object.entries(tag.frames)) frames[name] = math.transformFrame(node.matrix, f)
      return { frames, pending: tag.pending, basis: TREE_BASIS }
    },
    carry: (_node, children) => ofChildren(children),
    merge: (node, children) => {
      const op = node.op
      if (op === 'booleans.subtract' || op === 'booleans.intersect') {
        return mergeTags([tagOf((children || [])[0])])
      }
      return ofChildren(children)
    },
    drop: () => null,
  }
}

export const mulMat = (a, b) => {
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

const applyMat = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

const det3 = (m) =>
  m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])

// A ghost entity from a stored snapshot, exactly like overlay.js:ghostOf.
export const ghostOf = ({ kind, mesh, matrix }) => {
  const flip = det3(matrix) < 0
  const base = { transforms: [...IDENTITY], color: [...(GHOST_COLORS[kind] || GHOST_COLORS.background)], previewOnly: true }
  if (mesh.dim === 2) {
    const to2 = (p) => applyMat(matrix, [p[0], p[1], 0]).slice(0, 2)
    return { ...base, sides: mesh.sides.map(([a, b]) => (flip ? [to2(b), to2(a)] : [to2(a), to2(b)])) }
  }
  return {
    ...base,
    polygons: mesh.polygons.map((vs) => {
      const out = vs.map((v) => applyMat(matrix, v))
      return { vertices: flip ? out.reverse() : out }
    }),
  }
}

// One entity per kind and dimension; a loop of markers would otherwise spend one
// entity per iteration.
export const mergeGhosts = (list) => {
  const byKey = new Map()
  for (const raw of list) {
    if (!raw || !raw.mesh) continue
    const key = `${raw.kind}${raw.mesh.dim}`
    const into = byKey.get(key)
    if (!into) {
      byKey.set(key, ghostOf(raw))
      continue
    }
    const g = ghostOf(raw)
    if (g.sides) for (const s of g.sides) into.sides.push(s)
    else for (const p of g.polygons) into.polygons.push(p)
  }
  return [...byKey.values()]
}
