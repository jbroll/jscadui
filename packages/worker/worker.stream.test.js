import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, lastRunStreamed } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

describe('jscadMain streaming', () => {
  afterEach(() => {
    self.postMessage.mockClear()
    workerState.main = undefined
  })

  it('streams a batch through self.postMessage and marks the result', async () => {
    const vertices = new Float32Array(9)
    workerState.main = () => {
      globalThis.__jscadStream.emit([{ type: 'mesh', vertices }])
      return []
    }

    const result = await jscadMain({ params: {} })

    expect(result.streamed).toBe(true)
    expect(result.entities).toEqual([])
    expect(globalThis.__jscadStream).toBeNull()
    expect(lastRunStreamed()).toBe(true)

    const call = self.postMessage.mock.calls.find(([message]) => message.method === 'jscadCells')
    expect(call[0].params[0].entities).toHaveLength(1)
    expect(call[1]).toContain(vertices.buffer)
  })

  it('runs with no hook when stream is false, leaving lastRunStreamed as-is', async () => {
    workerState.lastRunStreamed = true
    workerState.main = () => {
      expect(globalThis.__jscadStream).toBeNull()
      return []
    }

    await jscadMain({ params: {}, stream: false })

    expect(lastRunStreamed()).toBe(true)
    expect(self.postMessage).not.toHaveBeenCalled()
  })
})
