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

// The engine and the tree/fluent/anchor wrappers throw errors the agent reads;
// the large bundles stay fully minified to keep the frame download small.
const NAMED_FRAME_BUNDLES = [
  'bundle.jscad_modeling.js',
  'bundle.model-tools.js',
  'bundle.jscad-fluent.js',
  ...TREE_BUNDLES,
  'bundle.jscad-anchors.js',
  'bundle.frame-worker.js',
]

test('every frame bundle that throws agent-visible errors keeps its identifiers', () => {
  const build = read('../build.js')
  expect(build).toMatch(/const FRAME_ESBUILD = \{ minify: false, minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false \}/)
  const calls = build.split(/\n(?=await build)/)
  for (const name of NAMED_FRAME_BUNDLES) {
    const call = calls.find((c) => c.includes(`'${name}'`))
    expect(call, name).toMatch(/\.\.\.FRAME_ESBUILD/)
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

// The worker's WASM gate (packages/worker/worker.js) and the frame's fluent
// option checks (src_frame/optionWarnings.js) await the modeling bundle's
// `ready` before user code runs. The manifold tree bundles start WASM init,
// so they must export the promise; without it every manifold run races init
// on a cold worker ("Manifold WASM not initialized").
test('manifold tree bundles export the WASM ready promise', () => {
  for (const name of ['bundle.model_tree_manifold.js', 'bundle.model_tree_anchored_manifold.js']) {
    const src = read(`../src_bundle/${name}`)
    expect(src, name).toMatch(/export const ready = startInit\(\)/)
  }
})
