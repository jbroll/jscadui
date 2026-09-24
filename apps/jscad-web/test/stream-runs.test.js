import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStreamRuns } from '../src/streamRuns.js'

const cell = (x = 0, n = 3) => ({ type: 'mesh', vertices: new Float32Array(n * 3).fill(x) })

const setup = () => {
  const draw = vi.fn()
  const onCells = vi.fn()
  const onError = vi.fn()
  const runs = createStreamRuns({ draw, onCells, onError })
  return { runs, draw, onCells, onError }
}

describe('stream runs', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('drops a batch when no run is streaming', () => {
    const { runs, draw } = setup()
    expect(runs.accept([cell()])).toBe(false)
    vi.runAllTimers()
    expect(draw).not.toHaveBeenCalled()
  })

  it('drops a batch from a stale run', () => {
    const { runs, draw } = setup()
    runs.begin(() => true)
    expect(runs.accept([cell()])).toBe(false)
    vi.runAllTimers()
    expect(draw).not.toHaveBeenCalled()
  })

  it('merges batches that arrive close together into one draw', () => {
    const { runs, draw, onCells } = setup()
    runs.begin(() => false)
    runs.accept([cell(1)])
    runs.accept([cell(2)])
    expect(onCells).toHaveBeenLastCalledWith(2)
    expect(draw).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(draw.mock.calls[0][0]).toHaveLength(2)
  })

  it('keeps a running bounding box of everything accepted', () => {
    const { runs, draw } = setup()
    runs.begin(() => false)
    runs.accept([cell(1)])
    runs.accept([cell(5)])
    vi.advanceTimersByTime(250)
    expect(draw.mock.calls[0][1]).toEqual({ min: { x: 1, y: 1, z: 1 }, max: { x: 5, y: 5, z: 5 } })
  })

  it('replaces the previous model on finish even with no batches', () => {
    const { runs, draw } = setup()
    runs.begin(() => false)
    expect(runs.finish()).toEqual({ cells: 0, vertices: 0, triangles: 0, lost: 0 })
    expect(draw).toHaveBeenCalledWith([], null)
  })

  it('draws pending batches at once on finish and reports totals', () => {
    const { runs, draw } = setup()
    runs.begin(() => false)
    runs.accept([cell(1, 6)])
    expect(runs.finish()).toEqual({ cells: 1, vertices: 6, triangles: 0, lost: 0 })
    expect(draw).toHaveBeenCalledTimes(1)
    expect(runs.accept([cell()])).toBe(false)
  })

  it('ends the run with the cap error and keeps what was drawn', () => {
    const { runs, draw, onError } = setup()
    runs.begin(() => false)
    runs.accept([cell()])
    const tooMany = Array.from({ length: 2001 }, () => cell())
    expect(runs.accept(tooMany)).toBe(false)
    expect(onError.mock.calls[0][0].message).toMatch(/entity cap/)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(draw.mock.calls[0][0]).toHaveLength(1)
    expect(runs.finish()).toBeNull()
  })

  it('caps the run total, not just each batch', () => {
    const { runs, onError } = setup()
    runs.begin(() => false)
    const batch = Array.from({ length: 2000 }, () => cell())
    for (let i = 0; i < 10; i++) expect(runs.accept(batch)).toBe(true)
    expect(runs.accept([cell()])).toBe(false)
    expect(onError.mock.calls[0][0].message).toMatch(/entity cap/)
  })

  it('drops non-object entries from a batch before checking or drawing', () => {
    const { runs, draw, onCells } = setup()
    runs.begin(() => false)
    expect(() => runs.accept([null, cell(), 7])).not.toThrow()
    expect(onCells).toHaveBeenLastCalledWith(1)
    vi.advanceTimersByTime(250)
    expect(draw.mock.calls[0][0]).toHaveLength(1)
  })

  it.each([
    ['a fake length', { type: 'mesh', vertices: { length: 1e12 } }],
    ['a plain array', { type: 'mesh', vertices: [0, 0, 0, 1, 1, 1, 2, 2, 2] }],
    ['plain-array indices', { type: 'mesh', vertices: new Float32Array(9), indices: [0, 1, 2] }],
    ['plain-array normals', { type: 'mesh', vertices: new Float32Array(9), normals: [0, 0, 1] }],
    ['plain-array colors', { type: 'mesh', vertices: new Float32Array(9), colors: [1, 0, 0, 1] }],
  ])('fails the run on a buffer field with %s', (_, entity) => {
    const { runs, draw, onCells, onError } = setup()
    runs.begin(() => false)
    expect(runs.accept([cell(), entity])).toBe(false)
    expect(onError.mock.calls[0][0].name).toBe('ModelError')
    expect(onCells).not.toHaveBeenCalled()
    expect(draw).not.toHaveBeenCalled()
    expect(runs.finish()).toBeNull()
  })

  it('accepts buffer fields that are absent or undefined', () => {
    const { runs, onError } = setup()
    runs.begin(() => false)
    expect(runs.accept([{ type: 'mesh', vertices: new Float32Array(9), indices: undefined, colors: undefined }])).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it('pushes nothing and ends the run when counting a batch throws', () => {
    const { runs, draw, onCells, onError } = setup()
    runs.begin(() => false)
    runs.accept([cell(1)])
    const entity = cell(2)
    let reads = 0
    // Passes the buffer check on the first read, throws when counted.
    Object.defineProperty(entity, 'indices', {
      get() {
        if (reads++) throw new Error('bad getter')
        return undefined
      },
      enumerable: false,
    })
    expect(runs.accept([entity])).toBe(false)
    expect(onError.mock.calls[0][0].message).toBe('bad getter')
    expect(onCells).toHaveBeenCalledTimes(1)
    expect(draw.mock.calls[0][0]).toHaveLength(1)
    expect(runs.finish()).toBeNull()
  })

  it('drops a batch tagged with another run', () => {
    const { runs, draw, onCells } = setup()
    runs.begin(() => false, 2)
    expect(runs.accept([cell()], 1)).toBe(false)
    expect(runs.accept([cell()])).toBe(false)
    expect(onCells).not.toHaveBeenCalled()
    expect(runs.accept([cell()], 2)).toBe(true)
    vi.advanceTimersByTime(250)
    expect(draw.mock.calls[0][0]).toHaveLength(1)
  })

  it('leaves the current run alone when another run finishes or ends', () => {
    const { runs, draw } = setup()
    runs.begin(() => false, 2)
    runs.accept([cell()], 2)
    expect(runs.finish(1)).toBeNull()
    runs.end(1)
    expect(draw).not.toHaveBeenCalled()
    expect(runs.accept([cell()], 2)).toBe(true)
    expect(runs.finish(2)).toEqual({ cells: 2, vertices: 6, triangles: 0, lost: 0 })
    expect(draw.mock.calls[0][0]).toHaveLength(2)
  })

  it('ends its own run, drawing what is pending', () => {
    const { runs, draw } = setup()
    runs.begin(() => false, 2)
    runs.accept([cell()], 2)
    runs.end(2)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(runs.accept([cell()], 2)).toBe(false)
  })

  it('discards the run without drawing what is pending', () => {
    const { runs, draw } = setup()
    runs.begin(() => false, 2)
    runs.accept([cell()], 2)
    runs.discard()
    vi.runAllTimers()
    expect(draw).not.toHaveBeenCalled()
    expect(runs.accept([cell()], 2)).toBe(false)
    expect(runs.finish(2)).toBeNull()
  })

  it('counts the bytes of a resolved ref toward the caps', () => {
    const draw = vi.fn()
    const onError = vi.fn()
    const held = cell(1)
    // Reports 200 MB without allocating it; the per-batch cap is 256 MB.
    Object.defineProperty(held.vertices, 'byteLength', { value: 200 * 1024 * 1024 })
    const resolve = (entities) => entities.map((e) => (e.ref ? held : e))
    const runs = createStreamRuns({ draw, onCells: vi.fn(), onError, resolve })
    runs.begin(() => false, 1)
    const ref = { type: 'mesh', hash: '0123456789abcdef', ref: true }
    expect(runs.accept([ref, ref], 1)).toBe(false)
    expect(onError.mock.calls[0][0].message).toMatch(/buffer cap/)
  })

  it('draws a resolved ref and counts its geometry', () => {
    const draw = vi.fn()
    const held = cell(1, 6)
    const resolve = (entities) => entities.map((e) => (e.ref ? held : e))
    const runs = createStreamRuns({ draw, onCells: vi.fn(), onError: vi.fn(), resolve })
    runs.begin(() => false, 1)
    expect(runs.accept([{ type: 'mesh', hash: '0123456789abcdef', ref: true }], 1)).toBe(true)
    expect(runs.finish(1)).toEqual({ cells: 1, vertices: 6, triangles: 0, lost: 0 })
    expect(draw.mock.calls[0][0][0]).toBe(held)
  })

  it('ends the run when a ref does not resolve', () => {
    const { draw, onCells } = setup()
    const onError = vi.fn()
    const error = Object.assign(new Error('unknown mesh 0123456789abcdef'), { name: 'ModelError' })
    const runs = createStreamRuns({ draw, onCells, onError, resolve: () => { throw error } })
    runs.begin(() => false, 1)
    expect(runs.accept([{ type: 'mesh', hash: '0123456789abcdef', ref: true }], 1)).toBe(false)
    expect(onError).toHaveBeenCalledWith(error)
    expect(runs.finish(1)).toBeNull()
  })

  it('returns null from finish for a stale run', () => {
    const { runs } = setup()
    let stale = false
    runs.begin(() => stale)
    runs.accept([cell()])
    stale = true
    expect(runs.finish()).toBeNull()
  })

  it('reports leaves that ran out of time as an error, keeping the cells already drawn', () => {
    const { runs, draw, onError } = setup()
    runs.begin(() => false, 1)
    runs.accept([cell(1)], 1)
    const totals = runs.finish(1, [{ url: './slow.scad', reason: 'TimeoutError' }, { url: './slower.scad', reason: 'TimeoutError' }])
    expect(draw).toHaveBeenCalledTimes(1)
    expect(totals).toMatchObject({ cells: 1, lost: 2 })
    const [error] = onError.mock.calls[0]
    expect(error.name).toBe('TimeoutError')
    expect(error.message).toBe('2 grid model(s) stopped: ./slow.scad (TimeoutError) ./slower.scad (TimeoutError)')
  })

  it('names each lost leaf by its own reason, and calls it a timeout only when every leaf timed out', () => {
    const { runs, onError } = setup()
    runs.begin(() => false, 1)
    runs.finish(1, [{ url: './a.scad', reason: 'TimeoutError' }, { url: './b.scad', reason: 'WorkerError' }])
    const [error] = onError.mock.calls[0]
    expect(error.name).toBe('Error')
    expect(error.message).toBe('2 grid model(s) stopped: ./a.scad (TimeoutError) ./b.scad (WorkerError)')
  })

  it('reports nothing for a run that lost no leaf', () => {
    const { runs, onError } = setup()
    runs.begin(() => false, 1)
    runs.accept([cell(1)], 1)
    expect(runs.finish(1, []).lost).toBe(0)
    expect(onError).not.toHaveBeenCalled()
  })
})
