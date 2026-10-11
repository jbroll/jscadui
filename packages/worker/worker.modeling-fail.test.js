import { afterEach, describe, expect, it, vi } from 'vitest'

globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, jscadScript } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')
const { requireCache } = await import('@jscadui/require')

// A missing bundle URL makes require's readFileWeb throw in Node (no XHR),
// the same way a failed bundle fetch fails in the frame.
const MISSING = '/missing-modeling-bundle.js'

describe('modeling bundle require failures', () => {
  afterEach(() => {
    delete requireCache.bundleAlias['@jscad/modeling']
    workerState.reset()
    vi.restoreAllMocks()
  })

  it('warns the cause when the modeling bundle cannot be required for GPU normals', async () => {
    requireCache.bundleAlias['@jscad/modeling'] = MISSING
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    workerState.useParamsProxy = undefined
    workerState.main = () => []

    await jscadMain({ useGpuNormals: true, stream: false, solidsOnly: true })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('modeling'), expect.any(Error))
  })

  it('warns the cause when the modeling bundle cannot be required for WASM setup', async () => {
    requireCache.bundleAlias['@jscad/modeling'] = MISSING
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await jscadScript({ script: 'module.exports = { main: () => [] }', url: 'http://project.local/m.js', runMain: false })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('modeling'), expect.any(Error))
  })
})
