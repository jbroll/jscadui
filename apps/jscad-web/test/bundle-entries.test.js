import { test, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const TREE_BUNDLES = [
  'bundle.model_tree_jscad.js',
  'bundle.model_tree_manifold.js',
  'bundle.model_tree_anchored_jscad.js',
  'bundle.model_tree_anchored_manifold.js',
]

test('build.js registers the five tree bundles', () => {
  const build = read('../build.js')
  for (const name of [...TREE_BUNDLES, 'bundle.jscad-anchors.js']) {
    expect(build.includes(`'${name}'`), name).toBe(true)
  }
})

// loadBoundEvaluate (packages/worker/src/treeApi.js) reads `.evaluate` off the
// active tree bundle, so every tree entry must export one bound to its engine.
test('every tree bundle exports the engine-bound evaluate the worker loads', () => {
  for (const name of TREE_BUNDLES) {
    const src = read(`../src_bundle/${name}`)
    expect(src, name).toMatch(/export const evaluate = createEvaluator\(/)
  }
})
