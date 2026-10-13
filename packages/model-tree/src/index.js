import { createNamespace } from './nodes.js'
import { createMeasurements } from './measurements.js'

const todo = (name) => () => { throw new Error(`${name}: not implemented`) }

export { createBuildContext, withBuildContext, eagerEvaluate, memoFromSpecials } from './context.js'

export const createModelTree = (engine, opts) => {
  const namespace = createNamespace(engine, opts)
  namespace.measurements = createMeasurements(engine)
  return namespace
}
export const createEvaluator = todo('createEvaluator')
export const bindEvaluator = todo('bindEvaluator')
export const splitParts = todo('splitParts')
