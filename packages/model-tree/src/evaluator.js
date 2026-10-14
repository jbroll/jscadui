// Subtree replay over the raw engine. `evaluate(node, memo)` walks a built node
// tree, calls the real engine namespace, and returns `{ solids, ghosts }`.
//
// `memo` maps node identity to already-evaluated geometry (single geometry, or
// an array for multi-solid results). It is seeded from the build specials by
// `memoFromSpecials`, so a subtree measured during the build is not evaluated
// twice; anything this evaluator computes is stored back into the same map.

import { makeFrameMath, frameFromBBox, directionBasis, mergeGhosts, mulMat } from './tags.js'
import { SPECIALS } from './context.js'

const isTreeNode = (value) => Boolean(value && value.isTreeNode === true)
const isThenable = (value) => Boolean(value && typeof value.then === 'function')
const isFluentArray = (value) => Boolean(value && typeof value === 'object' && value.isFluentArray === true)

const mapSnapshot = (snapshot, matrix) => (matrix ? { ...snapshot, matrix: mulMat(matrix, snapshot.matrix) } : snapshot)

const snapshotsOf = (node, ctx) => {
  const entry = ctx.specials && ctx.specials.get(node)
  return entry && Array.isArray(entry.snapshots) ? entry.snapshots : null
}

// Result nodes tagged by `attach` emit the snapshots their specials link holds.
// A node whose overlay is `unmapped` was wrapped by a transform, so its ghosts
// map through the matrix the caller resolved (or the node's stored one).
const overlayGhosts = (node, ctx, matrixOverride) => {
  if (!node.overlay || !Array.isArray(node.overlay.kinds) || node.overlay.kinds.length === 0) return []
  const snapshots = snapshotsOf(node, ctx)
  if (!snapshots) return []
  const matrix = matrixOverride || (node.overlay.unmapped && node.matrix ? node.matrix : null)
  return snapshots.map((snapshot) => mapSnapshot(snapshot, matrix))
}

const flattenSolids = (value) => {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.flat(Infinity).filter((v) => v !== undefined && v !== null)
  return [value]
}

const resolveOp = (engine, op) => {
  let cur = engine
  for (const key of op.split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[key]
  }
  return cur
}

const NAME_DIRECTIONS = {
  left: [-1, 0, 0], right: [1, 0, 0],
  front: [0, -1, 0], back: [0, 1, 0], fwd: [0, -1, 0], forward: [0, -1, 0],
  bottom: [0, 0, -1], bot: [0, 0, -1], down: [0, 0, -1],
  top: [0, 0, 1], up: [0, 0, 1],
  center: [0, 0, 0],
}

const parseDirection = (value) => {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return [value[0] || 0, value[1] || 0, value[2] || 0]
  if (typeof value !== 'string') return [0, 0, 0]
  const out = [0, 0, 0]
  for (const word of value.split('+')) {
    const d = NAME_DIRECTIONS[word]
    if (!d) return null
    for (let i = 0; i < 3; i++) if (d[i]) out[i] = d[i]
  }
  return out
}

export const createEvaluator = (engine) => {
  const math = engine.maths ? makeFrameMath(engine) : null
  const { mat4 } = engine.maths || {}

  const evalValue = async (value, ctx) => {
    if (isThenable(value)) return evalValue(await value, ctx)
    if (Array.isArray(value) || isFluentArray(value)) {
      const solids = []
      const ghosts = []
      for (const item of value) {
        const result = await evalValue(item, ctx)
        solids.push(...result.solids)
        ghosts.push(...result.ghosts)
      }
      return { solids, ghosts }
    }
    if (!isTreeNode(value)) return { solids: value === undefined || value === null ? [] : [value], ghosts: [] }
    const memo = ctx.memo.get(value)
    if (memo !== undefined) return { solids: flattenSolids(memo), ghosts: overlayGhosts(value, ctx) }
    return evalNode(value, ctx)
  }

  const evalChildren = async (children, ctx) => {
    const solids = []
    const ghosts = []
    for (const child of children || []) {
      const result = await evalValue(child, ctx)
      solids.push(...result.solids)
      ghosts.push(...result.ghosts)
    }
    return { solids, ghosts }
  }

  const finish = (node, ctx, solids, ghosts, matrixOverride) => {
    if (solids.length === 1) ctx.memo.set(node, solids[0])
    else if (solids.length > 1) ctx.memo.set(node, solids)
    const extra = overlayGhosts(node, ctx, matrixOverride)
    return { solids, ghosts: extra.length ? [...ghosts, ...extra] : ghosts }
  }

  const evalColorize = async (node, ctx) => {
    const { solids, ghosts } = await evalChildren(node.children, ctx)
    const result = engine.colors.colorize(node.color ?? node.params, ...solids)
    return finish(node, ctx, flattenSolids(result), ghosts)
  }

  // A ghost marker's snapshot lives in the build specials keyed by the marker.
  const evalGhost = (node, ctx) => {
    const snapshots = snapshotsOf(node, ctx) || []
    return { solids: [], ghosts: snapshots.map((snapshot) => mapSnapshot(snapshot, node.matrix || null)) }
  }

  // `transforms.resize` defers at build: its factors need the child's real bbox,
  // computed here exactly like openscad-runtime's `resizeFactors`.
  const evalResize = async (node, ctx) => {
    const { solids, ghosts } = await evalChildren(node.children, ctx)
    const geo = solids[0]
    if (geo === undefined || geo === null) return finish(node, ctx, [], ghosts)
    const bounds = engine.measurements.measureBoundingBox(geo)
    const curSize = [0, 1, 2].map((i) => bounds[1][i] - bounds[0][i])
    const factors = (node.params || []).map((s, i) => (s > 0 && curSize[i] > 0 ? s / curSize[i] : 1))
    const scaled = engine.transforms.scale(factors, geo)
    const matrix = [factors[0], 0, 0, 0, 0, factors[1], 0, 0, 0, 0, factors[2], 0, 0, 0, 0, 1]
    return finish(node, ctx, flattenSolids(scaled), ghosts, matrix)
  }

  const resolveAnchor = async (ref, geom, fallbackNode, ctx) => {
    if (!ref) return math.frame([0, 0, 0], [0, 0, 1], [1, 0, 0])
    if (ref.frame) return ref.frame
    let target = geom
    if (ref.node && ref.node !== fallbackNode) {
      const evaluated = await evalValue(ref.node, ctx)
      target = evaluated.solids[0]
    }
    const direction = parseDirection(ref.direction) || [0, 0, 0]
    const basis = ref.basis && ref.basis.z ? ref.basis : directionBasis(math, direction)
    const bbox = engine.measurements.measureBoundingBox(target)
    return frameFromBBox(math, bbox, direction, basis)
  }

  const evalAttach = async (node, ctx) => {
    const { child, parent, childAnchor, parentAnchor, overlap = 0, flip = true, spin = 0 } = node.params
    const childResult = await evalValue(child, ctx)
    const parentResult = await evalValue(parent, ctx)
    const childGeom = childResult.solids[0]
    const parentGeom = parentResult.solids[0]
    const C = await resolveAnchor(childAnchor, childGeom, child, ctx)
    const P = await resolveAnchor(parentAnchor, parentGeom, parent, ctx)
    const multiply = (...ms) => ms.reduce((a, b) => mat4.multiply(mat4.create(), a, b))
    const M = multiply(
      math.frameToMat4(P),
      mat4.fromTranslation(mat4.create(), [0, 0, -overlap]),
      flip ? mat4.fromYRotation(mat4.create(), Math.PI) : mat4.create(),
      mat4.fromZRotation(mat4.create(), spin),
      mat4.invert(mat4.create(), math.frameToMat4(C)),
    )
    const placed = engine.transforms.transform(M, childGeom)
    // The parent is not part of the result, so its ghosts are dropped; child
    // ghosts follow the placed child, matching eager `withOverlays`.
    const ghosts = childResult.ghosts.map((g) => ({ ...g, matrix: mulMat(M, g.matrix) }))
    return finish(node, ctx, flattenSolids(placed), ghosts)
  }

  const evalAlignTo = async (node, ctx) => {
    const { child, parent, direction, inset = 0, inside = false } = node.params
    const d = parseDirection(direction) || [0, 0, 0]
    const childResult = await evalValue(child, ctx)
    const parentResult = await evalValue(parent, ctx)
    const childGeom = childResult.solids[0]
    const parentGeom = parentResult.solids[0]
    const [cmin, cmax] = engine.measurements.measureBoundingBox(childGeom)
    const [pmin, pmax] = engine.measurements.measureBoundingBox(parentGeom)
    const offset = [0, 1, 2].map((i) => {
      if (d[i] === 0) return (pmin[i] + pmax[i]) / 2 - (cmin[i] + cmax[i]) / 2
      if (d[i] > 0) return pmax[i] - inset - (inside ? cmax[i] : cmin[i])
      return pmin[i] + inset - (inside ? cmin[i] : cmax[i])
    })
    const placed = engine.transforms.translate(offset, childGeom)
    const matrix = mat4.fromTranslation(mat4.create(), offset)
    const ghosts = childResult.ghosts.map((g) => ({ ...g, matrix: mulMat(matrix, g.matrix) }))
    return finish(node, ctx, flattenSolids(placed), ghosts)
  }

  const evalDispatch = async (node, ctx) => {
    if (node.op === 'transforms.resize') return evalResize(node, ctx)
    const fn = resolveOp(engine, node.op)
    if (typeof fn !== 'function') throw new Error(`evaluate: unsupported op "${node.op}"`)
    const { solids, ghosts } = await evalChildren(node.children, ctx)
    const result = node.params === undefined ? fn(...solids) : fn(node.params, ...solids)
    const mapped = node.matrix ? ghosts.map((g) => ({ ...g, matrix: mulMat(node.matrix, g.matrix) })) : ghosts
    return finish(node, ctx, flattenSolids(result), mapped)
  }

  const evalNode = async (node, ctx) => {
    switch (node.op) {
      case 'literal': return finish(node, ctx, node.value === undefined ? [] : [node.value], [])
      case 'ghost': return evalGhost(node, ctx)
      case 'attach': return evalAttach(node, ctx)
      case 'alignTo': return evalAlignTo(node, ctx)
      case 'colorize': return evalColorize(node, ctx)
      default: return evalDispatch(node, ctx)
    }
  }

  return async (node, memo = new Map()) => {
    const specials = (memo && memo[SPECIALS]) || globalThis.__jscadBuild?.specials || null
    const result = await evalValue(node, { engine, memo, math, specials })
    return { solids: result.solids, ghosts: mergeGhosts(result.ghosts) }
  }
}

// Marks the one sync failure that is not a bug: a thenable in the subtree
// cannot be replayed on the caller's stack. Callers fall back to the async
// evaluator only for this error and let anything else propagate.
export class AsyncLeafError extends Error {
  constructor() {
    super('evaluateSync: async leaf')
    this.name = 'AsyncLeafError'
  }
}

// Synchronous twin of `createEvaluator`. Same op semantics on the caller's
// stack: measurements read a deferred subtree during the build and need the
// value, not a Promise, so a sync replay avoids the async hop. A thenable
// anywhere in the subtree (an async leaf) cannot be replayed without blocking,
// so `evalValue` throws `AsyncLeafError`; `measurements` falls back to the
// async evaluator only for that. Op-for-op this mirrors `createEvaluator`
// above, minus the awaits.
export const createSyncEvaluator = (engine) => {
  const math = engine.maths ? makeFrameMath(engine) : null
  const { mat4 } = engine.maths || {}
  const asyncLeaf = () => new AsyncLeafError()

  const evalValue = (value, ctx) => {
    if (isThenable(value)) throw asyncLeaf()
    if (Array.isArray(value) || isFluentArray(value)) {
      const solids = []
      const ghosts = []
      for (const item of value) {
        const result = evalValue(item, ctx)
        solids.push(...result.solids)
        ghosts.push(...result.ghosts)
      }
      return { solids, ghosts }
    }
    if (!isTreeNode(value)) return { solids: value === undefined || value === null ? [] : [value], ghosts: [] }
    const memo = ctx.memo.get(value)
    if (memo !== undefined) return { solids: flattenSolids(memo), ghosts: overlayGhosts(value, ctx) }
    return evalNode(value, ctx)
  }

  const evalChildren = (children, ctx) => {
    const solids = []
    const ghosts = []
    for (const child of children || []) {
      const result = evalValue(child, ctx)
      solids.push(...result.solids)
      ghosts.push(...result.ghosts)
    }
    return { solids, ghosts }
  }

  const finish = (node, ctx, solids, ghosts, matrixOverride) => {
    if (solids.length === 1) ctx.memo.set(node, solids[0])
    else if (solids.length > 1) ctx.memo.set(node, solids)
    const extra = overlayGhosts(node, ctx, matrixOverride)
    return { solids, ghosts: extra.length ? [...ghosts, ...extra] : ghosts }
  }

  const evalColorize = (node, ctx) => {
    const { solids, ghosts } = evalChildren(node.children, ctx)
    const result = engine.colors.colorize(node.color ?? node.params, ...solids)
    if (isThenable(result)) throw asyncLeaf()
    return finish(node, ctx, flattenSolids(result), ghosts)
  }

  const evalGhost = (node, ctx) => {
    const snapshots = snapshotsOf(node, ctx) || []
    return { solids: [], ghosts: snapshots.map((snapshot) => mapSnapshot(snapshot, node.matrix || null)) }
  }

  const evalResize = (node, ctx) => {
    const { solids, ghosts } = evalChildren(node.children, ctx)
    const geo = solids[0]
    if (geo === undefined || geo === null) return finish(node, ctx, [], ghosts)
    const bounds = engine.measurements.measureBoundingBox(geo)
    const curSize = [0, 1, 2].map((i) => bounds[1][i] - bounds[0][i])
    const factors = (node.params || []).map((s, i) => (s > 0 && curSize[i] > 0 ? s / curSize[i] : 1))
    const scaled = engine.transforms.scale(factors, geo)
    const matrix = [factors[0], 0, 0, 0, 0, factors[1], 0, 0, 0, 0, factors[2], 0, 0, 0, 0, 1]
    return finish(node, ctx, flattenSolids(scaled), ghosts, matrix)
  }

  const resolveAnchor = (ref, geom, fallbackNode, ctx) => {
    if (!ref) return math.frame([0, 0, 0], [0, 0, 1], [1, 0, 0])
    if (ref.frame) return ref.frame
    let target = geom
    if (ref.node && ref.node !== fallbackNode) {
      const evaluated = evalValue(ref.node, ctx)
      target = evaluated.solids[0]
    }
    const direction = parseDirection(ref.direction) || [0, 0, 0]
    const basis = ref.basis && ref.basis.z ? ref.basis : directionBasis(math, direction)
    const bbox = engine.measurements.measureBoundingBox(target)
    return frameFromBBox(math, bbox, direction, basis)
  }

  const evalAttach = (node, ctx) => {
    const { child, parent, childAnchor, parentAnchor, overlap = 0, flip = true, spin = 0 } = node.params
    const childResult = evalValue(child, ctx)
    const parentResult = evalValue(parent, ctx)
    const childGeom = childResult.solids[0]
    const parentGeom = parentResult.solids[0]
    const C = resolveAnchor(childAnchor, childGeom, child, ctx)
    const P = resolveAnchor(parentAnchor, parentGeom, parent, ctx)
    const multiply = (...ms) => ms.reduce((a, b) => mat4.multiply(mat4.create(), a, b))
    const M = multiply(
      math.frameToMat4(P),
      mat4.fromTranslation(mat4.create(), [0, 0, -overlap]),
      flip ? mat4.fromYRotation(mat4.create(), Math.PI) : mat4.create(),
      mat4.fromZRotation(mat4.create(), spin),
      mat4.invert(mat4.create(), math.frameToMat4(C)),
    )
    const placed = engine.transforms.transform(M, childGeom)
    const ghosts = childResult.ghosts.map((g) => ({ ...g, matrix: mulMat(M, g.matrix) }))
    return finish(node, ctx, flattenSolids(placed), ghosts)
  }

  const evalAlignTo = (node, ctx) => {
    const { child, parent, direction, inset = 0, inside = false } = node.params
    const d = parseDirection(direction) || [0, 0, 0]
    const childResult = evalValue(child, ctx)
    const parentResult = evalValue(parent, ctx)
    const childGeom = childResult.solids[0]
    const parentGeom = parentResult.solids[0]
    const [cmin, cmax] = engine.measurements.measureBoundingBox(childGeom)
    const [pmin, pmax] = engine.measurements.measureBoundingBox(parentGeom)
    const offset = [0, 1, 2].map((i) => {
      if (d[i] === 0) return (pmin[i] + pmax[i]) / 2 - (cmin[i] + cmax[i]) / 2
      if (d[i] > 0) return pmax[i] - inset - (inside ? cmax[i] : cmin[i])
      return pmin[i] + inset - (inside ? cmin[i] : cmax[i])
    })
    const placed = engine.transforms.translate(offset, childGeom)
    const matrix = mat4.fromTranslation(mat4.create(), offset)
    const ghosts = childResult.ghosts.map((g) => ({ ...g, matrix: mulMat(matrix, g.matrix) }))
    return finish(node, ctx, flattenSolids(placed), ghosts)
  }

  const evalDispatch = (node, ctx) => {
    if (node.op === 'transforms.resize') return evalResize(node, ctx)
    const fn = resolveOp(engine, node.op)
    if (typeof fn !== 'function') throw new Error(`evaluate: unsupported op "${node.op}"`)
    const { solids, ghosts } = evalChildren(node.children, ctx)
    const result = node.params === undefined ? fn(...solids) : fn(node.params, ...solids)
    if (isThenable(result)) throw asyncLeaf()
    const mapped = node.matrix ? ghosts.map((g) => ({ ...g, matrix: mulMat(node.matrix, g.matrix) })) : ghosts
    return finish(node, ctx, flattenSolids(result), mapped)
  }

  const evalNode = (node, ctx) => {
    switch (node.op) {
      case 'literal':
        if (isThenable(node.value)) throw asyncLeaf()
        return finish(node, ctx, node.value === undefined ? [] : [node.value], [])
      case 'ghost': return evalGhost(node, ctx)
      case 'attach': return evalAttach(node, ctx)
      case 'alignTo': return evalAlignTo(node, ctx)
      case 'colorize': return evalColorize(node, ctx)
      default: return evalDispatch(node, ctx)
    }
  }

  return (node, memo = new Map()) => {
    const specials = (memo && memo[SPECIALS]) || globalThis.__jscadBuild?.specials || null
    const result = evalValue(node, { engine, memo, math, specials })
    return { solids: result.solids, ghosts: mergeGhosts(result.ghosts) }
  }
}

// The `createBuildContext` `eager` seam: measurements call this and expect the
// evaluated geometry itself, not `{ solids, ghosts }`. A single solid unwraps
// to the geometry; several unwrap to an array for the raw measure* fn to spread.
export const bindEvaluator = (ctx, evaluate) => {
  ctx.eager = (node) => Promise.resolve(evaluate(node, ctx.memo)).then(({ solids }) => (solids.length === 1 ? solids[0] : solids))
  return ctx.eager
}
