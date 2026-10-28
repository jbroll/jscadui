// The manifold tree: same deferred nodes over the Manifold engine.
//
// Point the WASM at the file copied next to the bundle and start
// initialization. '@jscad/modeling-for-manifold' stays
// external because @jscadui/manifold imports it for maths/curves/text/utils;
// at runtime it is the one shared plain modeling copy.
import { setWasmUrl, startInit } from '@jscadui/manifold'
import * as manifold from '@jscadui/manifold'
import { createEvaluator, createModelTree, createSyncEvaluator } from '@jscadui/model-tree'
import { bundleFileUrl } from './bundleBase.js'

export {
  createBuildContext,
  withBuildContext,
  eagerEvaluate,
  memoFromSpecials,
  splitParts,
  createEvaluator,
  createModelTree,
} from '@jscadui/model-tree'

setWasmUrl(bundleFileUrl('./manifold.wasm', self))
// Exported for the worker's WASM gate and the frame's fluent option checks,
// which await the modeling bundle's `ready` before user code runs.
export const ready = startInit()

const tree = createModelTree(manifold)

export const {
  primitives, booleans, transforms, extrusions, expansions, hulls,
  minkowski, modifiers, colors, geometries, text, measurements, maths, curves, utils,
} = tree

export const evaluate = createEvaluator(manifold)
export const evaluateSync = createSyncEvaluator(manifold)
