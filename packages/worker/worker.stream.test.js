import { describe, it, expect, vi, afterEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, jscadScript, lastRunStreamed, currentSolids } = await import('./worker.js')
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

  it('streams the parts of a multi-part model one batch per solid, in order', async () => {
    const solids = [
      { type: 'mesh', vertices: new Float32Array(9) },
      { type: 'mesh', vertices: new Float32Array(9) },
      { type: 'mesh', vertices: new Float32Array(9) },
    ]
    workerState.main = () => solids

    const result = await jscadMain({ params: {}, runId: 7 })

    const calls = self.postMessage.mock.calls.filter(([message]) => message.method === 'jscadCells')
    expect(calls).toHaveLength(3)
    calls.forEach(([message]) => {
      expect(message.params[0].entities).toHaveLength(1)
      expect(message.params[0].runId).toBe(7)
    })

    expect(result.streamed).toBe(true)
    expect(result.runId).toBe(7)
    expect(result.entities).toEqual([])
    expect(currentSolids()).toHaveLength(3)
    expect(lastRunStreamed()).toBe(false)
  })

  it('returns the whole result for a multi-part model with no runId', async () => {
    workerState.main = () => [
      { type: 'mesh', vertices: new Float32Array(9) },
      { type: 'mesh', vertices: new Float32Array(9) },
      { type: 'mesh', vertices: new Float32Array(9) },
    ]

    const result = await jscadMain({ params: {} })

    expect(self.postMessage.mock.calls.some(([message]) => message.method === 'jscadCells')).toBe(false)
    expect(result.streamed).toBeUndefined()
    expect(result.entities).toHaveLength(3)
  })

  it('returns the whole result for a single-part model even with a runId', async () => {
    workerState.main = () => [{ type: 'mesh', vertices: new Float32Array(9) }]

    const result = await jscadMain({ params: {}, runId: 7 })

    expect(self.postMessage.mock.calls.some(([message]) => message.method === 'jscadCells')).toBe(false)
    expect(result.streamed).toBeUndefined()
    expect(result.entities).toHaveLength(1)
  })

  it('evaluates a manifold solid before posting its batch', async () => {
    const calls = []
    const numTri = vi.fn(() => calls.push('numTri'))
    const manifoldSolid = { type: 'mesh', vertices: new Float32Array(9), isManifoldGeom3: true, manifold: { numTri } }
    workerState.main = () => [manifoldSolid, { type: 'mesh', vertices: new Float32Array(9) }]
    const originalPost = self.postMessage
    self.postMessage = vi.fn((message) => {
      if (message.method === 'jscadCells') calls.push('post')
      originalPost(message)
    })

    await jscadMain({ params: {}, runId: 7 })

    self.postMessage = originalPost
    expect(numTri).toHaveBeenCalled()
    expect(calls.indexOf('numTri')).toBeLessThan(calls.indexOf('post'))
  })
})
