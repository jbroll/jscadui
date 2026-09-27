import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

describe('jscadMain staleness guard', () => {
  beforeEach(() => {
    workerState.reset()
    workerState.main = undefined
    workerState.useParamsProxy = undefined
  })

  afterEach(() => {
    self.postMessage.mockClear()
    workerState.reset()
  })

  it('rejects a run superseded by a newer script', async () => {
    workerState.main = async () => {
      workerState.nextGeneration()
      return []
    }

    await expect(jscadMain({ params: {}, stream: false })).rejects.toThrow(/superseded/)
  })
})
