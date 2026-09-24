// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initParamsController, runModelUpdate } from '../src/paramsUI.js'

const deps = (jscadMain, extra = {}) => ({
  workerApi: { jscadMain },
  handleEntities: vi.fn(),
  setError: vi.fn(),
  stopCurrentAnim: () => false,
  ...extra,
})

describe('runModelUpdate', () => {
  beforeEach(() => {
    initParamsController()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('begins a run before jscadMain is sent', async () => {
    const order = []
    const jscadMain = vi.fn(async () => { order.push('main'); return { entities: [] } })
    const d = deps(jscadMain, { beginRun: () => order.push('begin'), endRun: () => order.push('end') })
    await runModelUpdate(d)
    expect(order).toEqual(['begin', 'main'])
    expect(d.handleEntities).toHaveBeenCalledOnce()
  })

  it('tags jscadMain with the runId beginRun returns', async () => {
    const jscadMain = vi.fn(async () => ({ entities: [] }))
    await runModelUpdate(deps(jscadMain, { beginRun: () => 9 }))
    expect(jscadMain.mock.calls[0][0].runId).toBe(9)
  })

  it('sends the hashes the held dep returns', async () => {
    const jscadMain = vi.fn(async () => ({ entities: [] }))
    await runModelUpdate(deps(jscadMain, { beginRun: () => 9, held: () => ['0123456789abcdef'] }))
    expect(jscadMain.mock.calls[0][0].held).toEqual(['0123456789abcdef'])
  })

  it('ends the run when jscadMain throws', async () => {
    const error = new Error('model exceeded 1000 ms')
    const endRun = vi.fn()
    const d = deps(async () => { throw error }, { beginRun: vi.fn(), endRun })
    await runModelUpdate(d)
    expect(endRun).toHaveBeenCalledOnce()
    expect(d.setError).toHaveBeenCalledWith(error)
  })

  it('runs without the stream hooks', async () => {
    const d = deps(async () => ({ entities: [] }))
    await runModelUpdate(d)
    expect(d.handleEntities).toHaveBeenCalledOnce()
  })

  it('asks the frame to supersede an older run', async () => {
    const jscadMain = vi.fn(async () => ({ entities: [] }))
    await runModelUpdate(deps(jscadMain))
    expect(jscadMain.mock.calls[0][0].supersede).toBe(true)
  })
})

describe('an update during a run', () => {
  beforeEach(() => {
    initParamsController()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  const pendingMain = () => {
    const runs = []
    const jscadMain = vi.fn(() => new Promise((resolve, reject) => runs.push({ resolve, reject })))
    return { jscadMain, runs }
  }

  const supersededError = () => Object.assign(new Error('superseded by a newer run'), { name: 'SupersededError' })

  it('sends a second update 600 ms into a run before the first settles', async () => {
    const { jscadMain, runs } = pendingMain()
    const d = deps(jscadMain)
    const first = runModelUpdate(d)
    vi.advanceTimersByTime(600)
    const second = runModelUpdate(d)
    expect(jscadMain).toHaveBeenCalledTimes(2)

    runs[0].reject(supersededError())
    runs[1].resolve({ entities: [] })
    await Promise.all([first, second])
    expect(jscadMain).toHaveBeenCalledTimes(2)
    expect(d.handleEntities).toHaveBeenCalledOnce()
  })

  it('holds a second update 100 ms into a run until the first settles', async () => {
    const { jscadMain, runs } = pendingMain()
    const d = deps(jscadMain)
    const first = runModelUpdate(d)
    vi.advanceTimersByTime(100)
    await runModelUpdate(d)
    expect(jscadMain).toHaveBeenCalledOnce()

    runs[0].resolve({ entities: [] })
    await first
    expect(jscadMain).toHaveBeenCalledTimes(2)
    runs[1].resolve({ entities: [] })
    await vi.waitFor(() => expect(d.handleEntities).toHaveBeenCalledTimes(2))
  })

  it('sets no error when the frame answers SupersededError', async () => {
    const { jscadMain, runs } = pendingMain()
    const endRun = vi.fn()
    const d = deps(jscadMain, { endRun })
    const first = runModelUpdate(d)
    vi.advanceTimersByTime(600)
    const second = runModelUpdate(d)
    runs[0].reject(supersededError())
    runs[1].resolve({ entities: [] })
    await Promise.all([first, second])
    expect(d.setError).not.toHaveBeenCalled()
    expect(endRun).toHaveBeenCalledOnce()
  })

  it('does not draw a run a newer one replaced', async () => {
    const { jscadMain, runs } = pendingMain()
    const d = deps(jscadMain)
    const first = runModelUpdate(d)
    vi.advanceTimersByTime(600)
    const second = runModelUpdate(d)
    runs[0].resolve({ entities: ['old'] })
    await first
    expect(d.handleEntities).not.toHaveBeenCalled()
    runs[1].resolve({ entities: ['new'] })
    await second
    expect(d.handleEntities).toHaveBeenCalledExactlyOnceWith({ entities: ['new'] }, {})
  })
})
