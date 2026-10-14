// Deferred node constructors: every geometry operation becomes an immutable
// node; only explicit eager reads (measurements, text output) touch the engine.
//
// Node shape (the contract Tasks 4-6 and 13 build on):
//   { op, params, children, isTreeNode: true, dim, overlay, anchors, color }
// Transform nodes add `matrix`; literal leaves add `value`.

import { eagerEvaluate } from './context.js'
import { createSyncEvaluator, AsyncLeafError } from './evaluator.js'

const isTreeNode = (value) => Boolean(value && value.isTreeNode === true)
const isThenable = (value) => Boolean(value && typeof value.then === 'function')
const isFluentArray = (value) => Boolean(value && typeof value === 'object' && value.isFluentArray === true)

// Primitive dims. `polygon` builds a geom2, `polyhedron` a geom3.
const PRIMITIVE_DIM = {
  arc: 2, circle: 2, ellipse: 2, line: 2, polygon: 2, rectangle: 2,
  roundedRectangle: 2, square: 2, star: 2, triangle: 2,
  cube: 3, cuboid: 3, cylinder: 3, cylinderElliptic: 3, ellipsoid: 3,
  geodesicSphere: 3, polyhedron: 3, roundedCuboid: 3, roundedCylinder: 3, sphere: 3, torus: 3,
}

const DEFERRED_OPS = {
  primitives: Object.keys(PRIMITIVE_DIM),
  booleans: ['union', 'subtract', 'intersect', 'scission'],
  transforms: [
    'translate', 'translateX', 'translateY', 'translateZ',
    'scale', 'scaleX', 'scaleY', 'scaleZ',
    'rotate', 'rotateX', 'rotateY', 'rotateZ',
    'mirror', 'mirrorX', 'mirrorY', 'mirrorZ',
    'transform', 'align', 'center', 'centerX', 'centerY', 'centerZ',
    // Factors need the child bbox, so resize carries no stored matrix and
    // defers placement to the evaluator.
    'resize',
  ],
  extrusions: ['extrudeLinear', 'extrudeRotate', 'extrudeHelical', 'extrudeRectangular', 'extrudeFromSlices', 'project'],
  expansions: ['expand', 'offset'],
  hulls: ['hull', 'hullChain', 'hullPoints2', 'hullPoints3'],
  minkowski: ['minkowskiSum'],
  modifiers: ['generalize', 'snap', 'retessellate'],
}

const EXTRUDE_3D = new Set(['extrudeLinear', 'extrudeRotate', 'extrudeHelical', 'extrudeRectangular', 'extrudeFromSlices'])

// Transform ops whose affine matrix is pure math on params (no bbox).
const MATRIX_OPS = new Set([
  'translate', 'translateX', 'translateY', 'translateZ',
  'scale', 'scaleX', 'scaleY', 'scaleZ',
  'rotate', 'rotateX', 'rotateY', 'rotateZ',
  'mirror', 'mirrorX', 'mirrorY', 'mirrorZ', 'transform',
])

const DROP_PREFIXES = ['extrusions.', 'expansions.', 'hulls.', 'minkowski.']
const MERGE_OPS = new Set(['booleans.union', 'booleans.subtract', 'booleans.intersect'])

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const asVec3 = (value, fallback = [0, 0, 0]) => (Array.isArray(value) || ArrayBuffer.isView(value)) ? value : fallback

const translationMatrix = (offset) => {
  const m = identity()
  const o = asVec3(offset)
  m[12] = o[0] || 0
  m[13] = o[1] || 0
  m[14] = o[2] || 0
  return m
}

const scalingMatrix = (factors) => {
  const m = identity()
  const f = Array.isArray(factors) || ArrayBuffer.isView(factors) ? factors : [factors, factors, factors]
  m[0] = f[0] ?? 1
  m[5] = f[1] ?? 1
  m[10] = f[2] ?? 1
  return m
}

// Mirror of modelling/mat4.fromTaitBryanRotation with yaw=angles[2], pitch=angles[1], roll=angles[0].
const rotationMatrix = (angles) => {
  const a = asVec3(angles)
  const yaw = a[2] || 0
  const pitch = a[1] || 0
  const roll = a[0] || 0
  const sy = Math.sin(yaw); const cy = Math.cos(yaw)
  const sp = Math.sin(pitch); const cp = Math.cos(pitch)
  const sr = Math.sin(roll); const cr = Math.cos(roll)
  return [
    cp * cy, cp * sy, -sp, 0,
    sr * sp * cy - cr * sy, cr * cy + sr * sp * sy, sr * cp, 0,
    sr * sy + cr * sp * cy, cr * sp * sy - sr * cy, cr * cp, 0,
    0, 0, 0, 1,
  ]
}

// Mirror of modelling/mat4.mirrorByPlane over the plane from normal + origin.
const mirrorMatrix = (options) => {
  const opts = options || {}
  const normal = asVec3(opts.normal, [0, 0, 1])
  const origin = asVec3(opts.origin, [0, 0, 0])
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1
  const [nx, ny, nz] = [normal[0] / len, normal[1] / len, normal[2] / len]
  const w = origin[0] * nx + origin[1] * ny + origin[2] * nz
  return [
    1 - 2 * nx * nx, -2 * ny * nx, -2 * nz * nx, 0,
    -2 * nx * ny, 1 - 2 * ny * ny, -2 * nz * ny, 0,
    -2 * nx * nz, -2 * ny * nz, 1 - 2 * nz * nz, 0,
    2 * nx * w, 2 * ny * w, 2 * nz * w, 1,
  ]
}

const transformMatrixFor = (name, params) => {
  switch (name) {
    case 'translate': return translationMatrix(params)
    case 'translateX': return translationMatrix([params, 0, 0])
    case 'translateY': return translationMatrix([0, params, 0])
    case 'translateZ': return translationMatrix([0, 0, params])
    case 'scale': return scalingMatrix(params)
    case 'scaleX': return scalingMatrix([params, 1, 1])
    case 'scaleY': return scalingMatrix([1, params, 1])
    case 'scaleZ': return scalingMatrix([1, 1, params])
    case 'rotate': return rotationMatrix(params)
    case 'rotateX': return rotationMatrix([params, 0, 0])
    case 'rotateY': return rotationMatrix([0, params, 0])
    case 'rotateZ': return rotationMatrix([0, 0, params])
    case 'mirror': return mirrorMatrix(params)
    case 'mirrorX': return mirrorMatrix({ normal: [1, 0, 0] })
    case 'mirrorY': return mirrorMatrix({ normal: [0, 1, 0] })
    case 'mirrorZ': return mirrorMatrix({ normal: [0, 0, 1] })
    case 'transform': return params ? Array.from(params) : identity()
    default: return undefined
  }
}

// Which tag group an op belongs to in anchor mode. Classification here mirrors
// the anchors groups TABLE at the granularity Task 2 needs; the pure semantics
// live in the injected tagOps (Task 5).
//
// opts.tagOps is `{ map, carry, merge, drop }`, each a pure
// `(node, children) => anchorsTag` that returns the tag to store on the node.
const tagGroupOf = (path) => {
  if (MATRIX_OPS.has(path.slice('transforms.'.length)) && path.startsWith('transforms.')) return 'map'
  if (MERGE_OPS.has(path)) return 'merge'
  if (DROP_PREFIXES.some((prefix) => path.startsWith(prefix))) return 'drop'
  if (path.startsWith('modifiers.')) return 'carry'
  return null
}

export function createNamespace(engine, opts = {}) {
  const tagOps = opts && opts.tagOps ? opts.tagOps : null
  const rawGeom = engine.geometries || {}
  const rawIs2D = (value) => Boolean((rawGeom.geom2 && rawGeom.geom2.isA && rawGeom.geom2.isA(value)) || (rawGeom.path2 && rawGeom.path2.isA && rawGeom.path2.isA(value)))
  const rawIs3D = (value) => Boolean(rawGeom.geom3 && rawGeom.geom3.isA && rawGeom.geom3.isA(value))
  const detectDim = (value) => rawIs2D(value) ? 2 : rawIs3D(value) ? 3 : undefined

  const literalNode = (value) => ({
    op: 'literal',
    value,
    isTreeNode: true,
    dim: detectDim(value),
    overlay: null,
    anchors: null,
    color: null,
  })

  // Flatten operands: arrays and fluent arrays spread, sentinels drop out,
  // real values become literal leaves, nodes and thenables pass through.
  const flattenInto = (value, out) => {
    if (value === undefined || value === null) return out
    if (Array.isArray(value)) { for (const item of value) flattenInto(item, out); return out }
    if (isFluentArray(value)) { for (const item of value) flattenInto(item, out); return out }
    if (isTreeNode(value) || isThenable(value)) { out.push(value); return out }
    if (typeof value === 'object') { out.push(literalNode(value)); return out }
    return out
  }
  const flattenAll = (values) => {
    const out = []
    for (const value of values) flattenInto(value, out)
    return out
  }

  const firstDim = (children) => {
    for (const child of children) {
      if (child && child.dim) return child.dim
    }
    return undefined
  }

  const assemble = (path, cfg, params, children) => {
    const op = cfg.op || path
    const node = {
      op,
      params,
      children,
      isTreeNode: true,
      dim: cfg.dim ? cfg.dim(params, children) : undefined,
      overlay: null,
      anchors: null,
      color: cfg.color !== undefined ? cfg.color : null,
    }
    if (cfg.matrix) node.matrix = cfg.matrix(params)
    if (!tagOps) return node
    const group = tagGroupOf(path)
    const apply = group && typeof tagOps[group] === 'function' ? tagOps[group] : null
    return apply ? { ...node, anchors: apply(node, children) } : node
  }

  const defer = (path, cfg = {}) => {
    const lead = cfg.lead === undefined ? 1 : cfg.lead
    return (...args) => {
      const params = lead > 0 ? args[0] : undefined
      const operands = flattenAll(args.slice(lead))
      if (operands.some(isThenable)) {
        return Promise.all(operands).then((children) => assemble(path, cfg, params, children))
      }
      return assemble(path, cfg, params, operands)
    }
  }

  // Build a category from the known deferred ops unioned with the raw engine's
  // function entries (so unknown extra ops still defer).
  const deferredCategory = (category, cfgFor) => {
    const out = {}
    const raw = engine[category]
    if (raw) {
      for (const [name, value] of Object.entries(raw)) {
        out[name] = typeof value === 'function' ? defer(`${category}.${name}`, cfgFor(name)) : value
      }
    }
    for (const name of DEFERRED_OPS[category] || []) {
      if (!(name in out)) out[name] = defer(`${category}.${name}`, cfgFor(name))
    }
    return out
  }

  const primitiveCfg = (name) => ({ lead: 1, dim: () => PRIMITIVE_DIM[name] })
  const booleanCfg = () => ({ lead: 0, dim: (p, children) => firstDim(children) })
  const transformCfg = (name) => (MATRIX_OPS.has(name)
    ? { lead: name === 'mirrorX' || name === 'mirrorY' || name === 'mirrorZ' ? 0 : 1, matrix: (params) => transformMatrixFor(name, params), dim: (p, children) => firstDim(children) }
    : { lead: name === 'centerX' || name === 'centerY' || name === 'centerZ' ? 0 : 1, dim: (p, children) => firstDim(children) })
  const extrusionCfg = (name) => ({
    lead: 1,
    dim: () => (name === 'project' ? 2 : EXTRUDE_3D.has(name) ? 3 : undefined),
  })
  const expansionCfg = () => ({ lead: 1, dim: (p, children) => firstDim(children) })
  const hullCfg = (name) => {
    if (name === 'hullPoints2') return { lead: 1, dim: () => 2 }
    if (name === 'hullPoints3') return { lead: 1, dim: () => 3 }
    return { lead: 0, dim: (p, children) => firstDim(children) }
  }
  const modifierCfg = (name) => ({
    lead: name === 'generalize' ? 1 : 0,
    dim: (p, children) => firstDim(children),
  })

  // colors.colorize: op 'colorize' with the color on the node.
  const colorize = (color, ...geoms) => {
    const children = flattenAll(geoms)
    const build = (resolved) => assemble('colorize', { op: 'colorize', lead: 1, color, dim: (p, cs) => firstDim(cs) || detectDim(color) }, color, resolved)
    if (children.some(isThenable)) return Promise.all(children).then(build)
    return build(children)
  }
  const colors = { ...(engine.colors || {}), colorize }

  // text: the segment generators (vectorChar/vectorText) are synchronous pure
  // data, which model code reads directly, so their result passes through as-is.
  // Only a thenable result (async font IO) becomes a Promise<literal node>.
  const text = {}
  for (const [name, value] of Object.entries(engine.text || {})) {
    text[name] = typeof value === 'function'
      ? (...args) => {
        const result = value(...args)
        return isThenable(result) ? result.then(literalNode) : result
      }
      : value
  }

  // The geometry readers (geom2.toSides, geom3.toPolygons, path2.toPoints, ...)
  // take a real geometry, but model code holds deferred nodes. Replay a node
  // operand on the caller's stack through the build context's evaluator before
  // calling the raw function, so the reader returns data, not a Promise
  // (11-balloons: `geom2.toSides(circle(...))`). Only an async leaf cannot be
  // replayed, so only `AsyncLeafError` falls back to the async eager path.
  const syncEvaluate = createSyncEvaluator(engine)

  const readGeometry = (value, ctx) => {
    if (!isTreeNode(value)) return value
    if (value.op === 'literal') return value.value
    const cached = ctx.specials.get(value)
    if (cached && cached.geometry !== undefined) return cached.geometry
    const { solids } = syncEvaluate(value, ctx.memo)
    const geometry = solids.length === 1 ? solids[0] : solids
    ctx.specials.set(value, { node: value, geometry, value: undefined })
    ctx.memo.set(value, geometry)
    return geometry
  }

  const readGeometryAsync = async (value, ctx) => {
    if (!isTreeNode(value)) return value
    if (value.op === 'literal') return value.value
    const cached = ctx.specials.get(value)
    if (cached && cached.geometry !== undefined) return cached.geometry
    const geometry = await eagerEvaluate(value)
    ctx.specials.set(value, { node: value, geometry, value: undefined })
    ctx.memo.set(value, geometry)
    return geometry
  }

  const readWithNodes = (fn) => (...args) => {
    if (!args.some(isTreeNode)) return fn(...args)
    const ctx = globalThis.__jscadBuild
    if (!ctx) return fn(...args)
    try {
      return fn(...args.map((arg) => readGeometry(arg, ctx)))
    } catch (err) {
      if (!(err instanceof AsyncLeafError)) throw err
    }
    return Promise.all(args.map((arg) => (isTreeNode(arg) ? readGeometryAsync(arg, ctx) : arg)))
      .then((resolved) => fn(...resolved))
  }

  // geometries: never claim a node as geometry; readers replay node operands.
  const geometries = {}
  for (const [name, kind] of Object.entries(engine.geometries || {})) {
    if (kind && typeof kind === 'object') {
      const namespace = {}
      for (const [fnName, value] of Object.entries(kind)) {
        if (fnName === 'isA' && typeof value === 'function') {
          namespace.isA = (candidate) => isTreeNode(candidate) ? false : value(candidate)
        } else if (typeof value === 'function') {
          namespace[fnName] = readWithNodes(value)
        } else {
          namespace[fnName] = value
        }
      }
      geometries[name] = namespace
    } else {
      geometries[name] = kind
    }
  }

  return {
    primitives: deferredCategory('primitives', primitiveCfg),
    booleans: deferredCategory('booleans', booleanCfg),
    transforms: deferredCategory('transforms', transformCfg),
    extrusions: deferredCategory('extrusions', extrusionCfg),
    expansions: deferredCategory('expansions', expansionCfg),
    hulls: deferredCategory('hulls', hullCfg),
    minkowski: deferredCategory('minkowski', () => ({ lead: 0, dim: (p, children) => firstDim(children) })),
    modifiers: deferredCategory('modifiers', modifierCfg),
    colors,
    geometries,
    text,
    measurements: engine.measurements || {},
    maths: engine.maths,
    curves: engine.curves,
    utils: engine.utils,
  }
}
