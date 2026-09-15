import { describe, it, expect, vi, beforeEach } from 'vitest'

// The @jscad/modeling alias always resolves to the jscad-anchors wrapper (it
// keeps one URL across engines), which does not re-export the underlying
// modeling bundle's `ready`/`setUseGpuNormals`. Only @jscad/modeling-for-anchors
// resolves to a bundle that needs WASM init (Manifold). Awaiting the wrong
// alias's `.ready` is a no-op, so script execution races WASM instantiation.
const ANCHORS_URL = 'fs:/anchors.cjs'
const MANIFOLD_URL = 'fs:/manifold.js'

const order = []
let resolveReady
let readyPromise

vi.mock('@jscadui/require', () => {
  const requireCache = { bundleAlias: {}, alias: {} }
  const requireFn = (urlOrSource) => {
    const url = typeof urlOrSource === 'string' ? urlOrSource : urlOrSource.url
    if (url === MANIFOLD_URL) {
      return { ready: readyPromise, setUseGpuNormals: () => {} }
    }
    if (url === ANCHORS_URL) {
      return {} // the anchors wrapper: no `.ready`
    }
    // the model script itself
    return {
      main: () => {
        order.push('main')
        return []
      },
    }
  }
  return {
    require: requireFn,
    requireCache,
    readFileWeb: () => '',
    clearAllCaches: () => {},
    clearFileCache: () => {},
    jscadClearTempCache: () => {},
    resolveUrl: (url) => ({ url }),
  }
})

describe('jscadScript waits for the modeling bundle that actually needs WASM init', () => {
  beforeEach(() => {
    // worker.js registers a top-level `self.addEventListener` (it normally runs
    // inside a Worker); stub it so the module can be imported under vitest.
    vi.stubGlobal('self', typeof EventTarget !== 'undefined' ? new EventTarget() : { addEventListener: () => {} })
    order.length = 0
    readyPromise = new Promise((resolve) => {
      resolveReady = () => {
        order.push('ready-resolved')
        resolve()
      }
    })
  })

  it('does not run the script main before @jscad/modeling-for-anchors is ready', async () => {
    const { jscadInit, jscadScript } = await import('./worker.js')

    jscadInit({
      bundles: { '@jscad/modeling': ANCHORS_URL, '@jscad/modeling-for-anchors': MANIFOLD_URL },
      useParamsProxy: true,
    })

    const scriptPromise = jscadScript({ script: 'ignored', url: 'model.js', base: 'fs:/', root: 'fs:/' })

    // Give any microtask-scheduled work a chance to run before resolving ready.
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(order).toEqual([])

    resolveReady()
    await scriptPromise

    expect(order).toEqual(['ready-resolved', 'main'])
  })
})
