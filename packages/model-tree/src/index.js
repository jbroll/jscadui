import { createNamespace } from './nodes.js'

const todo = (name) => () => { throw new Error(`${name}: not implemented`) }

export const createModelTree = (engine, opts) => createNamespace(engine, opts)
export const createEvaluator = todo('createEvaluator')
export const createBuildContext = todo('createBuildContext')
export const withBuildContext = todo('withBuildContext')
export const bindEvaluator = todo('bindEvaluator')
export const eagerEvaluate = todo('eagerEvaluate')
export const memoFromSpecials = todo('memoFromSpecials')
export const splitParts = todo('splitParts')
