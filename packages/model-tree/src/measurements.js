import { resolveGeometry, resolveGeometryAsync } from './resolve.js'
import { createSyncEvaluator, AsyncLeafError } from './evaluator.js'

export const MEASUREMENT_NAMES = [
  'measureArea', 'measureBoundingBox', 'measureBoundingSphere', 'measureCenter',
  'measureCenterOfMass', 'measureDimensions', 'measureEpsilon', 'measureVolume',
  'measureAggregateArea', 'measureAggregateBoundingBox', 'measureAggregateEpsilon',
  'measureAggregateVolume',
]

const isTreeNode = (value) => Boolean(value && value.isTreeNode === true)
const isThenable = (value) => Boolean(value && typeof value.then === 'function')
const isDeferred = (value) => isTreeNode(value) || isThenable(value)

const flattenOperands = (values, out = []) => {
  for (const value of values) {
    if (Array.isArray(value)) flattenOperands(value, out)
    else if (value !== undefined && value !== null) out.push(value)
  }
  return out
}

// A single measured node records the geometry and the value the same way the
// async path does, so a later `memoFromSpecials` or repeated read is a hit.
const record = (ctx, operands, value) => {
  if (operands.length === 1) {
    const entry = ctx.specials.get(operands[0])
    if (entry) entry.value = value
  }
  return value
}

// Real geometry needs no evaluation, so the engine's own fn answers on the
// caller's stack. model-tools measures evaluated solids through this namespace
// (the frame's '@jscad/modeling' alias), and an async wrapper would put a
// Promise in the result, which postMessage refuses to clone (DataCloneError).
//
// A deferred subtree with no async leaf replays synchronously too, so model
// code that reads a measurement as data (10-slicer, 11-balloons) gets numbers
// instead of a Promise. A thenable anywhere in the subtree is the one failure
// the async eager path exists for, so only `AsyncLeafError` falls back; any
// other error is a real bug and propagates rather than being hidden behind a
// second evaluation.
const createMeasurement = (raw, syncEvaluate) => (...args) => {
  const operands = flattenOperands(args)
  if (!operands.some(isDeferred)) return raw(...operands)
  const ctx = globalThis.__jscadBuild
  if (!ctx) return Promise.reject(new Error('measure* outside build context'))
  if (!operands.some(isThenable)) {
    try {
      const geometries = operands.map((operand) => resolveGeometry(operand, ctx, syncEvaluate))
      return record(ctx, operands, raw(...geometries))
    } catch (err) {
      if (!(err instanceof AsyncLeafError)) throw err
    }
  }
  return (async () => {
    const geometries = []
    for (const operand of operands) geometries.push(await resolveGeometryAsync(operand, ctx))
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
