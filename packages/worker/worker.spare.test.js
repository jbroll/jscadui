import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, jscadScript, lastRunStreamed } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

describe('jscadScript with runMain: false', () => {
  afterEach(() => {
    self.postMessage.mockClear()
    workerState.main = undefined
    workerState.useParamsProxy = undefined
  })

  it('loads the module and sets main without running it, then a following jscadMain runs main', async () => {
    const script = `module.exports = { main: () => { throw new Error('main should not run yet') } }`

    const result = await jscadScript({ script, url: 'http://project.local/spare.js', runMain: false })

    expect(result).toEqual({ def: [], params: {} })
    expect(typeof workerState.main).toBe('function')

    workerState.main = () => [{ type: 'mesh', vertices: new Float32Array(9) }]
    const mainResult = await jscadMain({ params: {} })
    expect(mainResult.entities).toHaveLength(1)
  })

  it('resets lastRunStreamed like a normal load', async () => {
    workerState.lastRunStreamed = true

    await jscadScript({ script: `module.exports = { main: () => [] }`, url: 'http://project.local/spare2.js', runMain: false })

    expect(lastRunStreamed()).toBe(false)
  })

  it('leaves a legacy getParameterDefinitions script in the legacy proxy branch, same as a normal load', async () => {
    workerState.useParamsProxy = true
    globalThis.__seenSize = undefined
    const script = `module.exports = {
      getParameterDefinitions: () => [{ name: 'size', type: 'int', initial: 20, caption: 'Size' }],
      main: (p) => { globalThis.__seenSize = p.size; return [] }
    }`

    await jscadScript({ script, url: 'http://project.local/legacy.js', runMain: false })
    expect(workerState.legacyProxyDefs).toBeTruthy()

    await jscadMain({ params: {} })

    // The legacy branch injects the declared defaults into the proxy; the
    // non-legacy (hierarchical discovery) branch would leave p.size undefined.
    expect(globalThis.__seenSize).toBe(20)
    delete globalThis.__seenSize
  })

  it('leaves a non-legacy params-proxy script able to run main after a runMain:false load', async () => {
    workerState.useParamsProxy = true
    const script = `module.exports = {
      main: (p) => { p.size; return [{ type: 'mesh', vertices: new Float32Array(9) }] }
    }`

    await jscadScript({ script, url: 'http://project.local/hierarchical.js', runMain: false })
    expect(workerState.legacyProxyDefs).toBeFalsy()

    const mainResult = await jscadMain({ params: {} })
    expect(mainResult.entities).toHaveLength(1)
  })
})

describe('trapped result', () => {
  afterEach(() => {
    self.postMessage.mockClear()
    workerState.main = undefined
    globalThis.__allWasmTrap = undefined
  })

  it('resolves with trapped: true when globalThis.__allWasmTrap is set during the run', async () => {
    workerState.main = () => {
      globalThis.__allWasmTrap = 'x'
      return []
    }

    const result = await jscadMain({ params: {}, stream: false })

    expect(result.trapped).toBe(true)
  })

  it('rejects with name RuntimeError for a WebAssembly.RuntimeError from main', async () => {
    workerState.main = () => { throw new WebAssembly.RuntimeError('unreachable') }

    await expect(jscadMain({ params: {}, stream: false })).rejects.toMatchObject({ name: 'RuntimeError' })
  })
})
