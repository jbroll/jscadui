import { eagerEvaluate } from './context.js'
import { createSyncEvaluator } from './evaluator.js'

export const MEASUREMENT_NAMES = [
  'measureArea', 'measureBoundingBox', 'measureBoundingSphere', 'measureCenter',
  'measureCenterOfMass', 'measureDimensions', 'measureEpsilon', 'measureVolume',
  'measureAggregateArea', 'measureAggregateBoundingBox', 'measureAggregateEpsilon',
  'measureAggregateVolume',
]

const isTreeNode = (value) => Boolean(value && value.isTreeNode === true)

const flattenOperands = (values, out = []) => {
  for (const value of values) {
    if (Array.isArray(value)) flattenOperands(value, out)
    else if (value !== undefined && value !== null) out.push(value)
  }
  return out
}

// A node forces evaluation; a `literal` leaf (or a real value passed straight
// through) is already geometry. Evaluated geometry is cached by node identity
// so repeated reads of the same node never re-enter the evaluator.
const geometryOf = async (operand, ctx) => {
  if (!isTreeNode(operand)) return operand
  if (operand.op === 'literal') return operand.value
  const cached = ctx.specials.get(operand)
  if (cached && cached.geometry !== undefined) return cached.geometry
  const geometry = await eagerEvaluate(operand)
  ctx.specials.set(operand, { node: operand, geometry, value: undefined })
  ctx.memo.set(operand, geometry)
  return geometry
}

const isThenable = (value) => Boolean(value && typeof value.then === 'function')
const isDeferred = (value) => isTreeNode(value) || isThenable(value)

// A single measured node records the geometry and the value the same way the
// async path does, so a later `memoFromSpecials` or repeated read is a hit.
const record = (ctx, operands, value) => {
  if (operands.length === 1) {
    const entry = ctx.specials.get(operands[0])
    if (entry) entry.value = value
  }
  return value
}

// The sync fast path's geometry resolver: same cache contract as `geometryOf`,
// but replays the subtree on the caller's stack via `syncEvaluate`.
const syncGeometryOf = (operand, ctx, syncEvaluate) => {
  if (!isTreeNode(operand)) return operand
  if (operand.op === 'literal') return operand.value
  const cached = ctx.specials.get(operand)
  if (cached && cached.geometry !== undefined) return cached.geometry
  const { solids } = syncEvaluate(operand, ctx.memo)
  const geometry = solids.length === 1 ? solids[0] : solids
  ctx.specials.set(operand, { node: operand, geometry, value: undefined })
  ctx.memo.set(operand, geometry)
  return geometry
}

// Real geometry needs no evaluation, so the engine's own fn answers on the
// caller's stack. model-tools measures evaluated solids through this namespace
// (the frame's '@jscad/modeling' alias), and an async wrapper would put a
// Promise in the result, which postMessage refuses to clone (DataCloneError).
//
// A deferred subtree with no async leaf replays synchronously too, so model
// code that reads a measurement as data (10-slicer, 11-balloons) gets numbers
// instead of a Promise. A thenable anywhere in the subtree, or any op the sync
// evaluator cannot resolve, falls back to the async eager path, which is the
// reference implementation and rethrows whatever is genuinely broken.
const createMeasurement = (raw, syncEvaluate) => (...args) => {
  const operands = flattenOperands(args)
  if (!operands.some(isDeferred)) return raw(...operands)
  const ctx = globalThis.__jscadBuild
  if (!ctx) return Promise.reject(new Error('measure* outside build context'))
  if (!operands.some(isThenable)) {
    try {
      const geometries = operands.map((operand) => syncGeometryOf(operand, ctx, syncEvaluate))
      return record(ctx, operands, raw(...geometries))
    } catch {
      // fall through to the async path
    }
  }
  return (async () => {
    const geometries = []
    for (const operand of operands) geometries.push(await geometryOf(operand, ctx))
    return record(ctx, operands, raw(...geometries))
  })()
}

export const createMeasurements = (engine) => {
  const raw = (engine && engine.measurements) || {}
  const syncEvaluate = createSyncEvaluator(engine)
  const out = {}
  for (const name of MEASUREMENT_NAMES) out[name] = createMeasurement(raw[name], syncEvaluate)
  return out
}
