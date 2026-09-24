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
    expect(runs.finish()).toEqual({ cells: 0, vertices: 0, triangles: 0 })
    expect(draw).toHaveBeenCalledWith([], null)
  })

  it('draws pending batches at once on finish and reports totals', () => {
    const { runs, draw } = setup()
    runs.begin(() => false)
    runs.accept([cell(1, 6)])
    expect(runs.finish()).toEqual({ cells: 1, vertices: 6, triangles: 0 })
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

  it('returns null from finish for a stale run', () => {
    const { runs } = setup()
    let stale = false
    runs.begin(() => stale)
    runs.accept([cell()])
    stale = true
    expect(runs.finish()).toBeNull()
  })
})
