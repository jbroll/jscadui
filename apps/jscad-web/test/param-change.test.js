// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initParamsController, runModelUpdate, runParamChange } from '../src/paramsUI.js'
import { ViewState } from '../src/viewState.js'

const runnerDeps = (jscadMain, extra = {}) => ({
  workerApi: { jscadMain },
  onEntities: vi.fn(),
  stopCurrentAnim: () => false,
  paramChange: () => () => false,
  beginStream: () => 1,
  endStream: vi.fn(),
  held: () => [],
  getMainOptions: (params, runId) => ({ params, runId, supersede: true }),
  noteParams: vi.fn(),
  noteRunParams: vi.fn(),
  ...extra,
})

const pendingMain = () => {
  const runs = []
  const jscadMain = vi.fn(() => new Promise((resolve, reject) => runs.push({ resolve, reject })))
  return { jscadMain, runs }
}

const supersededError = () => Object.assign(new Error('superseded by a newer run'), { name: 'SupersededError' })

describe('runParamChange work token', () => {
  beforeEach(() => {
    initParamsController()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('holds a second change 100 ms into a run until the first settles', async () => {
    const { jscadMain, runs } = pendingMain()
    const d = runnerDeps(jscadMain)
    const first = runParamChange(d, { size: 1 })
    vi.advanceTimersByTime(100)
    await runParamChange(d, { size: 2 })
    expect(jscadMain).toHaveBeenCalledOnce()

    runs[0].resolve({ entities: [] })
    await first
    expect(jscadMain).toHaveBeenCalledTimes(2)
    runs[1].resolve({ entities: [] })
    await vi.waitFor(() => expect(d.onEntities).toHaveBeenCalledTimes(2))
  })

  it('coalesces rapid changes to the latest params', async () => {
    const { jscadMain, runs } = pendingMain()
    const d = runnerDeps(jscadMain)
    const first = runParamChange(d, { size: 1 })
    vi.advanceTimersByTime(100)
    runParamChange(d, { size: 2 })
    vi.advanceTimersByTime(10)
    runParamChange(d, { size: 3 })
    runs[0].resolve({ entities: [] })
    await first
    expect(jscadMain).toHaveBeenCalledTimes(2)
    expect(jscadMain.mock.calls[1][0].params).toEqual({ size: 3 })
    runs[1].resolve({ entities: [] })
    await vi.waitFor(() => expect(d.onEntities).toHaveBeenCalledOnce())
  })

  it('does not draw a run a newer one replaced', async () => {
    const { jscadMain, runs } = pendingMain()
    const stales = []
    const d = runnerDeps(jscadMain, { paramChange: () => {
      const isStale = vi.fn(() => false)
      stales.push(isStale)
      return isStale
    } })
    const first = runParamChange(d, { size: 1 })
    vi.advanceTimersByTime(600)
    const second = runParamChange(d, { size: 2 })
    stales[0].mockReturnValue(true)
    runs[0].resolve({ entities: ['old'] })
    await first
    expect(d.onEntities).not.toHaveBeenCalled()
    runs[1].resolve({ entities: ['new'] })
    await second
    expect(d.onEntities).toHaveBeenCalledExactlyOnceWith({ entities: ['new'] }, {})
  })

  it('sets no error and ends the stream when the frame answers SupersededError', async () => {
    const { jscadMain, runs } = pendingMain()
    const d = runnerDeps(jscadMain)
    const first = runParamChange(d, { size: 1 })
    vi.advanceTimersByTime(600)
    const second = runParamChange(d, { size: 2 })
    runs[0].reject(supersededError())
    runs[1].resolve({ entities: [] })
    await Promise.all([first, second])
    expect(d.endStream).toHaveBeenCalledOnce()
    expect(d.onEntities).toHaveBeenCalledOnce()
  })
})

describe('paramChangeCallback and runModelUpdate together', () => {
  beforeEach(() => {
    initParamsController()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  const modelDeps = (jscadMain, extra = {}) => ({
    workerApi: { jscadMain },
    handleEntities: vi.fn(),
    setError: vi.fn(),
    stopCurrentAnim: () => false,
    ...extra,
  })

  it('runs a model update queued while a param change is in flight', async () => {
    const { jscadMain, runs } = pendingMain()
    const rd = runnerDeps(jscadMain)
    const md = modelDeps(jscadMain)
    const first = runParamChange(rd, { size: 1 })
    vi.advanceTimersByTime(100)
    runModelUpdate(md)
    runs[0].resolve({ entities: ['params'] })
    await first
    expect(jscadMain).toHaveBeenCalledTimes(2)
    runs[1].resolve({ entities: ['model'] })
    await vi.waitFor(() => expect(md.handleEntities).toHaveBeenCalledOnce())
    expect(rd.onEntities).toHaveBeenCalledOnce()
  })

  it('runs a param change queued while a model update is in flight', async () => {
    const { jscadMain, runs } = pendingMain()
    const rd = runnerDeps(jscadMain)
    const md = modelDeps(jscadMain)
    const first = runModelUpdate(md)
    vi.advanceTimersByTime(100)
    runParamChange(rd, { size: 9 })
    runs[0].resolve({ entities: ['model'] })
    await first
    expect(jscadMain).toHaveBeenCalledTimes(2)
    runs[1].resolve({ entities: ['params'] })
    await vi.waitFor(() => expect(rd.onEntities).toHaveBeenCalledOnce())
    expect(md.handleEntities).toHaveBeenCalledOnce()
  })
})

describe('view state toggles', () => {
  const dom = () => {
    document.body.innerHTML = ['dark-mode', 'show-axis', 'show-grid', 'smooth-render', 'zoom-to-fit', 'modeling-engine', 'render-engine']
      .map((id) => `<input id="${id}">`)
      .join('')
  }

  const viewer = () => ({
    setBg: vi.fn(),
    setMeshColor: vi.fn(),
    setScene: vi.fn(),
    setCamera: vi.fn(),
    getCamera: () => ({ fov: 50, aspect: 1 }),
  })

  beforeEach(() => { dom(); localStorage.clear() })
  afterEach(() => { document.body.innerHTML = '' })

  it('smooth render redraws the scene instead of re-running the model', () => {
    const view = new ViewState()
    const engine = viewer()
    view.setEngine(engine)
    view.setModel([{ id: 'solid' }])
    const hooks = { onZoomToFit: vi.fn(), onModelingEngineChange: vi.fn(), onRenderEngineChange: vi.fn() }
    Object.assign(view, hooks)

    view.setSmoothRender(true)

    expect(engine.setScene).toHaveBeenCalledWith(expect.anything(), { smooth: true })
    // A toggle must fire no model-requesting hook: viewState's only hooks are
    // the zoom fit and the two engine changes, and none may run a model.
    expect(hooks.onZoomToFit).not.toHaveBeenCalled()
    expect(hooks.onModelingEngineChange).not.toHaveBeenCalled()
    expect(hooks.onRenderEngineChange).not.toHaveBeenCalled()
  })

  it('zoom to fit moves the camera instead of re-running the model', () => {
    const view = new ViewState()
    view.setEngine(viewer())
    const onZoomToFit = vi.fn()
    const onModelingEngineChange = vi.fn()
    const onRenderEngineChange = vi.fn()
    view.onZoomToFit = onZoomToFit
    view.onModelingEngineChange = onModelingEngineChange
    view.onRenderEngineChange = onRenderEngineChange

    view.setZoomToFit(true)

    expect(onZoomToFit).toHaveBeenCalledOnce()
    expect(onModelingEngineChange).not.toHaveBeenCalled()
    expect(onRenderEngineChange).not.toHaveBeenCalled()
  })
})
