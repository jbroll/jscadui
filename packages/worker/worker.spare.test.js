import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, jscadScript } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

describe('jscadScript with runMain: false', () => {
  afterEach(() => {
    self.postMessage.mockClear()
    workerState.main = undefined
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
