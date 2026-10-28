// The anchored jscad tree: '@jscad/modeling' resolves here, so model code and
// the worker's evaluator both get the tag-aware namespace. `{ anchors: true }`
// is the model-tree shorthand for the production tag ops; the anchors package
// is wrapped on top of this namespace elsewhere, so there is no import of it
// here. The raw engine comes from the plain '@jscad/modeling-for-manifold'
// bundle, kept external, for the same reason as the plain tree.
import * as raw from '@jscad/modeling-for-manifold'
import { createEvaluator, createModelTree, createSyncEvaluator } from '@jscadui/model-tree'

export {
  createBuildContext,
  withBuildContext,
  eagerEvaluate,
  memoFromSpecials,
  splitParts,
  createEvaluator,
  createModelTree,
} from '@jscadui/model-tree'

const tree = createModelTree(raw, { anchors: true })

export const {
  primitives, booleans, transforms, extrusions, expansions, hulls,
  minkowski, modifiers, colors, geometries, text, measurements, maths, curves, utils,
} = tree

export const evaluate = createEvaluator(raw)
export const evaluateSync = createSyncEvaluator(raw)
