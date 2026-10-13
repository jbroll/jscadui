// The plain jscad tree: deferred model construction over the raw engine.
//
// '@jscad/modeling' is remapped to the anchored tree, so the raw engine comes
// from '@jscad/modeling-for-manifold' (the plain modeling bundle) instead. Left
// external so the bundle shares that one engine copy rather than inlining a
// second.
import * as raw from '@jscad/modeling-for-manifold'
import { createEvaluator, createModelTree } from '@jscadui/model-tree'

export {
  createBuildContext,
  withBuildContext,
  eagerEvaluate,
  memoFromSpecials,
  splitParts,
  createEvaluator,
  createModelTree,
} from '@jscadui/model-tree'

const tree = createModelTree(raw)

export const {
  primitives, booleans, transforms, extrusions, expansions, hulls,
  minkowski, modifiers, colors, geometries, text, measurements, maths, curves, utils,
} = tree

// What loadBoundEvaluate reads off the active tree bundle.
export const evaluate = createEvaluator(raw)
