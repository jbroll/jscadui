// The anchored manifold tree: '@jscad/modeling' resolves here for the manifold
// engine. Same WASM setup and external engine import as the plain manifold tree,
// with the anchors tag ops applied.
import { setWasmUrl, startInit } from '@jscadui/manifold'
import * as manifold from '@jscadui/manifold'
import { createEvaluator, createModelTree } from '@jscadui/model-tree'
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

const tree = createModelTree(manifold, { anchors: true })

export const {
  primitives, booleans, transforms, extrusions, expansions, hulls,
  minkowski, modifiers, colors, geometries, text, measurements, maths, curves, utils,
} = tree

export const evaluate = createEvaluator(manifold)

// Forwarded for the worker's heap reporting: each claim carries
// getModule().HEAPU8.length, which the frame uses to recycle a worker whose
// WASM heap passed its budget. Without this the twin reports 0 and no grid
// worker is ever recycled.
export { getModule } from '@jscadui/manifold'
