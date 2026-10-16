import { describe, it, expect } from 'vitest'
import { pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { createRequire } from 'module'

const nodeRequire = createRequire(import.meta.url)
// The manifold-3d package ships its own wasm; point the bundle entry at it so
// startInit() resolves against a real file instead of a served asset.
const wasmDir = dirname(nodeRequire.resolve('manifold-3d'))
globalThis.self ??= {}
globalThis.self.__BUNDLE_BASE__ ??= pathToFileURL(join(wasmDir, '/')).href

describe('manifold modeling bundle (the worker @jscad/modeling)', () => {
  it('exposes the WASM heap the frame recycler reads', async () => {
    const twin = await import('../src_bundle/bundle.model_tree_anchored_manifold.js')
    expect(typeof twin.getModule).toBe('function')
    await twin.ready
    expect(typeof twin.getModule().HEAPU8?.length).toBe('number')
  })
})
