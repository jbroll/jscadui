import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, jscadScript, lastRunStreamed } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

describe('jscadMain streaming', () => {
  afterEach(() => {
    self.postMessage.mockClear()
    workerState.main = undefined
    workerState.useParamsProxy = undefined
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

  it('tags the batches and the streamed result with the runId it was given', async () => {
    workerState.main = () => {
      globalThis.__jscadStream.emit([{ type: 'mesh', vertices: new Float32Array(9) }])
      return []
    }

    const result = await jscadMain({ params: {}, runId: 3 })

    expect(result.runId).toBe(3)
    const call = self.postMessage.mock.calls.find(([message]) => message.method === 'jscadCells')
    expect(call[0].params[0].runId).toBe(3)
  })

  it.each([true, false])('passes the runId of a load through to the main it runs (params proxy %s)', async (useParamsProxy) => {
    workerState.useParamsProxy = useParamsProxy
    const script = `module.exports = { main: () => {
      globalThis.__jscadStream.emit([{ type: 'mesh', vertices: new Float32Array(9) }])
      return []
    } }`

    const result = await jscadScript({ script, url: 'http://project.local/grid.js', runId: 5 })

    expect(result.streamed).toBe(true)
    expect(result.runId).toBe(5)
    const call = self.postMessage.mock.calls.find(([message]) => message.method === 'jscadCells')
    expect(call[0].params[0].runId).toBe(5)
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

  it('leaves lastRunStreamed set when a stream:false re-run fails, so the next export re-runs again', async () => {
    workerState.main = () => {
      globalThis.__jscadStream.emit([{ type: 'mesh', vertices: new Float32Array(9) }])
      return []
    }
    await jscadMain({ params: {} })
    workerState.main = () => { throw new Error('boom') }

    await expect(jscadMain({ params: {}, stream: false })).rejects.toThrow('boom')

    expect(lastRunStreamed()).toBe(true)
    expect(workerState.solids).toEqual([])
  })

  it('clears lastRunStreamed when a streaming run fails', async () => {
    workerState.lastRunStreamed = true
    workerState.main = () => { throw new Error('boom') }

    await expect(jscadMain({ params: {} })).rejects.toThrow('boom')

    expect(lastRunStreamed()).toBe(false)
  })
})
