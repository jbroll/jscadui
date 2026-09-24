import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// worker.js registers self.addEventListener at import time, so self must
// exist before the dynamic import; Node has no self global by default.
globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain, jscadScript, lastRunStreamed, currentSolids } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')
const { JscadToCommon } = await import('@jscadui/format-jscad')
const { meshHash } = await import('@jscadui/format-common')

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
    expect(call[1]).toContain(call[0].params[0].entities[0].vertices.buffer)
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

describe('jscadMain with held meshes', () => {
  const triangle = (x) => ({ polygons: [{ vertices: [[x, 0, 0], [x + 1, 0, 0], [x, 1, 0]] }] })
  const convert = (solid) => JscadToCommon.prepare([solid], []).all[0]

  afterEach(() => {
    self.postMessage = vi.fn()
    workerState.main = undefined
    JscadToCommon.clearCache()
  })

  it('posts a held part of a streamed run as a ref with no buffers to transfer', async () => {
    const solids = [triangle(0), triangle(1), triangle(2)]
    const hashOfPart2 = meshHash(convert(solids[1]))
    JscadToCommon.clearCache()
    workerState.main = () => solids

    await jscadMain({ params: {}, runId: 1, held: [hashOfPart2] })

    const calls = self.postMessage.mock.calls.filter(([message]) => message.method === 'jscadCells')
    expect(calls).toHaveLength(3)
    const [message, transfer] = calls[1]
    const [entity] = message.params[0].entities
    expect(entity).toMatchObject({ type: 'mesh', hash: hashOfPart2, ref: true })
    expect(entity.vertices).toBeUndefined()
    expect(transfer).toEqual([])
    expect(calls[0][0].params[0].entities[0].vertices).toBeInstanceOf(Float32Array)
    expect(calls[0][1].length).toBeGreaterThan(0)
  })

  it('returns a held mesh as a ref in the whole result', async () => {
    const solid = triangle(0)
    const hash = meshHash(convert(solid))
    JscadToCommon.clearCache()
    workerState.main = () => [solid]

    const result = await jscadMain({ params: {}, held: [hash] })

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({ type: 'mesh', hash, ref: true })
    expect(result.entities[0].vertices).toBeUndefined()
  })

  it.each([true, false])('passes held from a load through to the main it runs (params proxy %s)', async (useParamsProxy) => {
    workerState.useParamsProxy = useParamsProxy
    const hash = meshHash(convert(triangle(0)))
    JscadToCommon.clearCache()
    const script = `module.exports = { main: () => [{ polygons: [{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }] }] }`
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await jscadScript({ script, url: 'http://project.local/part.js', held: [hash] })

    log.mockRestore()
    workerState.useParamsProxy = undefined
    expect(result.entities[0]).toMatchObject({ hash, ref: true })
  })

  it('reconverts the same model on a second run after the first run transferred its buffers', async () => {
    const solids = [triangle(0), triangle(1)]
    const received = []
    self.postMessage = vi.fn((message, transfer) => received.push(structuredClone(message, { transfer })))
    workerState.main = () => solids

    await jscadMain({ params: {}, runId: 1 })
    await expect(jscadMain({ params: {}, runId: 2 })).resolves.toBeDefined()

    const second = received.slice(2).map(message => message.params[0].entities[0])
    expect(second).toHaveLength(2)
    expect(second.every(entity => entity.vertices.length === 9)).toBe(true)
  })
})

describe('jscadMain streaming repeated geometry', () => {
  const tri = { polygons: [{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }] }
  let received

  beforeEach(() => {
    received = []
    self.postMessage = vi.fn((message, transfer) => received.push(structuredClone(message, { transfer })))
  })

  afterEach(() => {
    self.postMessage = vi.fn()
    workerState.main = undefined
  })

  const cells = () => received.filter(message => message.method === 'jscadCells').map(message => message.params[0].entities[0])

  it('posts a solid and its translated copy, which share polygons, in two batches', async () => {
    workerState.main = () => [tri, { ...tri, transforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] }]

    await expect(jscadMain({ params: {}, runId: 1 })).resolves.toBeDefined()

    expect(cells()).toHaveLength(2)
    expect(cells().every(entity => entity.vertices.length === 9)).toBe(true)
  })

  it('posts the same manifold solid twice in two batches', async () => {
    const vertices = new Float32Array(9)
    const indices = new Uint16Array([0, 1, 2])
    class ManifoldLike {
      type = 'mesh'
      isManifoldGeom3 = true
      manifold = Object.create({ numTri() {} })
      get vertices() { return vertices }
      get indices() { return indices }
    }
    const m = new ManifoldLike()
    workerState.main = () => [m, m]

    await expect(jscadMain({ params: {}, runId: 1 })).resolves.toBeDefined()

    expect(cells()).toHaveLength(2)
    expect(cells().every(entity => entity.vertices.length === 9 && entity.indices.length === 3)).toBe(true)
  })

  it('leaves the arrays of the solids it keeps attached after streaming the parts', async () => {
    const solids = [
      { type: 'mesh', vertices: new Float32Array(9) },
      { type: 'mesh', vertices: new Float32Array(9) },
    ]
    workerState.main = () => solids

    await jscadMain({ params: {}, runId: 1 })

    expect(currentSolids().map(solid => solid.vertices.byteLength)).toEqual([36, 36])
  })
})
