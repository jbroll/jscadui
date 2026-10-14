import { createNamespace } from './nodes.js'
import { createMeasurements } from './measurements.js'
import { productionTagOps } from './tags.js'

export { createBuildContext, withBuildContext, eagerEvaluate, memoFromSpecials } from './context.js'
export { splitParts } from './splitter.js'
export { createEvaluator, createSyncEvaluator, bindEvaluator } from './evaluator.js'
export { productionTagOps, makeFrameMath, frameFromBBox, directionBasis, ghostOf, mergeGhosts } from './tags.js'

// `{ anchors: true }` is the bundles' shorthand for the production tag ops:
// matrix-known transforms map frames, keep-group ops carry, anchored booleans
// merge, drop-group ops drop (Task 2's factory applies the group table).
export const createModelTree = (engine, opts = {}) => {
  const resolved = opts.anchors && engine.maths ? { ...opts, tagOps: productionTagOps(engine) } : opts
  const namespace = createNamespace(engine, resolved)
  namespace.measurements = createMeasurements(engine)
  return namespace
}
