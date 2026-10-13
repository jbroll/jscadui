import { eagerEvaluate } from './context.js'

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

const createMeasurement = (raw) => async (...args) => {
  const ctx = globalThis.__jscadBuild
  if (!ctx) throw new Error('measure* outside build context')
  const operands = flattenOperands(args)
  const geometries = []
  for (const operand of operands) geometries.push(await geometryOf(operand, ctx))
  const value = raw(...geometries)
  if (operands.length === 1) {
    const entry = ctx.specials.get(operands[0])
    if (entry) entry.value = value
  }
  return value
}

export const createMeasurements = (engine) => {
  const raw = (engine && engine.measurements) || {}
  const out = {}
  for (const name of MEASUREMENT_NAMES) out[name] = createMeasurement(raw[name])
  return out
}
