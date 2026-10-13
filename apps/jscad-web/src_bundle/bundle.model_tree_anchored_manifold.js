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
startInit()

const tree = createModelTree(manifold, { anchors: true })

export const {
  primitives, booleans, transforms, extrusions, expansions, hulls,
  minkowski, modifiers, colors, geometries, text, measurements, maths, curves, utils,
} = tree

export const evaluate = createEvaluator(manifold)
