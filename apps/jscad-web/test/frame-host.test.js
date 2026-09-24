import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFrameHost } from '../src_frame/frameHost.js'

const APP = 'https://app.example'
const BASE = 'https://run.example/assets/'
const RESPONSE = '__RESPONSE__'

const parentWindow = { name: 'parent' }

const setup = () => {
  const posted = []
  const workers = []
  const createWorker = () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn() }
    workers.push(worker)
    return worker
  }
  const host = createFrameHost({
    allowedOrigin: APP,
    bundleBase: BASE,
    createWorker,
    post: (message) => posted.push(message),
    parentWindow,
  })
  const send = (data, { origin = APP, source = parentWindow } = {}) =>
    host.handleMessage({ origin, source, data })
  return { host, posted, workers, send }
}

const init = (send, options = {}, id = 1) => send({ method: 'jscadInit', id, params: [options] })

// The id the worker saw for the nth request relayed to it.
const workerIdOf = (worker, n = 0) => worker.postMessage.mock.calls[n][0].id

const answer = (worker, n = 0, params = {}) =>
  worker.onmessage({ data: { method: RESPONSE, id: workerIdOf(worker, n), params } })

describe('frame host sender checks', () => {
  it('ignores a message from another origin', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] }, { origin: 'https://evil.example' })
    expect(workers).toEqual([])
    expect(posted).toEqual([])
  })

  it('ignores a same-origin message from a window that is not the parent', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] }, { source: { name: 'other tab' } })
    expect(workers).toEqual([])
    expect(posted).toEqual([])
  })

  it('relays a message from the parent on the app origin', () => {
    const { workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] })
    const [message] = workers[0].postMessage.mock.calls[0]
    expect(message.method).toBe('jscadMain')
    expect(message.params).toEqual([])
  })
})

describe('worker messages', () => {
  it('relays the answer under the app id, not the id the worker saw', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 7, params: [] })
    expect(workerIdOf(workers[0])).not.toBe(7)
    answer(workers[0], 0, { entities: [] })
    expect(posted).toEqual([{ method: RESPONSE, id: 7, params: { entities: [] } }])
  })

  it('does not show the worker a guessable id', () => {
    const { workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] })
    send({ method: 'jscadMain', id: 2, params: [] })
    const [a, b] = [workerIdOf(workers[0], 0), workerIdOf(workers[0], 1)]
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(b).not.toBe(a)
  })

  it('drops an answer for an id the frame did not issue and keeps the timer', () => {
    vi.useFakeTimers()
    try {
      const { posted, workers, send, host } = setup()
      init(send, { timeoutMs: 1000 }, 1)
      answer(workers[0])
      send({ method: 'jscadMain', id: 2, params: [] })
      workers[0].onmessage({ data: { method: RESPONSE, id: 3, params: {} } })
      workers[0].onmessage({ data: { method: RESPONSE, id: 2, params: {} } })
      expect(posted.filter((m) => m.id === 2 || m.id === 3)).toEqual([])
      expect(host.getPendingCount()).toBe(1)
      vi.advanceTimersByTime(1001)
      expect(posted.find((m) => m.id === 2)?.error?.name).toBe('TimeoutError')
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers each request once', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 2, params: [] })
    answer(workers[0])
    answer(workers[0])
    expect(posted.filter((m) => m.id === 2)).toHaveLength(1)
  })

  it('does not relay a control message the worker makes up', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] })
    workers[0].onmessage({ data: { method: 'frameWorkerTerminated', params: [{ reason: 'forged' }] } })
    workers[0].onmessage({ data: { method: 'anything', params: [] } })
    expect(posted).toEqual([])
  })
})


describe('worker creation failure', () => {
  const failingHost = (posted) => createFrameHost({
    allowedOrigin: APP,
    bundleBase: BASE,
    createWorker: () => { throw new Error('blob workers are blocked') },
    post: (message) => posted.push(message),
    parentWindow,
  })

  it('answers the request with the error', () => {
    const posted = []
    const host = failingHost(posted)
    host.handleMessage({ origin: APP, source: parentWindow, data: { method: 'jscadMain', id: 4, params: [] } })
    expect(posted).toEqual([
      { method: RESPONSE, id: 4, error: { name: 'Error', message: 'could not start the model worker: blob workers are blocked' } },
    ])
    expect(host.getPendingCount()).toBe(0)
  })

  it('drops a notification it cannot deliver', () => {
    const posted = []
    const host = failingHost(posted)
    host.handleMessage({ origin: APP, source: parentWindow, data: { method: 'onPing', params: [] } })
    expect(posted).toEqual([])
  })
})

describe('jscadInit rewriting', () => {
  it('names the frame bundles and drops the sender bundles', () => {
    const { workers, send } = setup()
    init(send, { bundles: { '@jscad/modeling': 'https://evil.example/x.js' }, useParamsProxy: true })
    const [message] = workers[0].postMessage.mock.calls[0]
    expect(message.params[0].bundles['@jscad/modeling']).toBe(BASE + 'bundle.jscad_modeling.js')
    expect(message.params[0].appOrigin).toBe(APP)
    expect(message.params[0].useParamsProxy).toBe(true)
  })

  it('latches the engine across an init that omits it', () => {
    const { workers, send } = setup()
    init(send, { engine: 'manifold' }, 1)
    init(send, {}, 2)
    const [second] = workers[0].postMessage.mock.calls[1]
    expect(second.params[0].bundles['@jscad/modeling']).toBe(BASE + 'bundle.manifold_modeling.js')
  })

  it('rejects a malformed options param at once instead of arming a timeout', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadInit', id: 9, params: [null] })
    expect(posted).toEqual([
      { method: RESPONSE, id: 9, error: { name: 'TypeError', message: 'jscadInit expects an options object' } },
    ])
    expect(workers).toEqual([])
  })

  it('rejects an array of options the same way', () => {
    const { posted, send } = setup()
    send({ method: 'jscadInit', id: 9, params: [['manifold']] })
    expect(posted[0].error.name).toBe('TypeError')
  })

  it('treats a missing options param as an empty one', () => {
    const { workers, send } = setup()
    send({ method: 'jscadInit', id: 1, params: [] })
    const [message] = workers[0].postMessage.mock.calls[0]
    expect(message.params[0].bundles['@jscad/modeling']).toBe(BASE + 'bundle.jscad_modeling.js')
  })
})

describe('per-request timeouts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not let a later request clear an earlier request timer', () => {
    const { posted, workers, send } = setup()
    init(send, { timeoutMs: 1000 }, 1)
    answer(workers[0])

    send({ method: 'jscadScript', id: 2, params: [] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 3, params: [] })
    vi.advanceTimersByTime(500)

    const timedOut = posted.find((m) => m.id === 2)
    expect(timedOut?.error?.name).toBe('TimeoutError')
  })

  it('rejects the other in-flight requests when the worker is killed', () => {
    const { posted, send } = setup()
    init(send, { timeoutMs: 1000 }, 1)
    send({ method: 'jscadScript', id: 2, params: [] })
    send({ method: 'jscadMain', id: 3, params: [] })

    vi.advanceTimersByTime(1001)

    // id 1 expires first and takes the worker with it.
    expect(posted.find((m) => m.id === 1)?.error?.name).toBe('TimeoutError')
    expect(posted.find((m) => m.id === 2)?.error?.name).toBe('AbortError')
    expect(posted.find((m) => m.id === 3)?.error?.name).toBe('AbortError')
    expect(posted.filter((m) => m.method === 'frameWorkerTerminated')).toHaveLength(1)
  })

  it('clears the timer when the worker answers', () => {
    const { posted, workers, send, host } = setup()
    init(send, { timeoutMs: 1000 }, 1)
    answer(workers[0])
    vi.advanceTimersByTime(2000)
    expect(host.getPendingCount()).toBe(0)
    expect(posted.filter((m) => m.error)).toEqual([])
  })

  it('starts a fresh worker for the request after a kill', () => {
    const { workers, send } = setup()
    init(send, { timeoutMs: 1000 }, 1)
    vi.advanceTimersByTime(1001)
    expect(workers[0].terminate).toHaveBeenCalled()

    send({ method: 'jscadMain', id: 2, params: [] })
    expect(workers).toHaveLength(2)
    expect(workers[1].postMessage).toHaveBeenCalled()
  })
})

describe('streamed cells and progress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const cells = { method: 'jscadCells', params: [{ entities: [] }] }
  const progress = { method: 'jscadProgress', params: [] }

  it('relays cells while a jscadMain is pending', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] })
    workers[0].onmessage({ data: cells })
    expect(posted).toEqual([cells])
  })

  it('relays cells while a jscadScript is pending, since a load runs main', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadScript', id: 1, params: [] })
    workers[0].onmessage({ data: cells })
    expect(posted).toEqual([cells])
  })

  it('drops cells while only another request is pending', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadExportData', id: 1, params: [] })
    workers[0].onmessage({ data: cells })
    expect(posted).toEqual([])
  })

  it('drops cells and progress with nothing pending', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] })
    answer(workers[0])
    posted.length = 0
    workers[0].onmessage({ data: cells })
    workers[0].onmessage({ data: progress })
    expect(posted).toEqual([])
  })

  it.each(['jscadExportData', 'jscadMeasure', 'jscadCheck'])('relays progress while a %s is pending', (method) => {
    const { posted, workers, send } = setup()
    send({ method, id: 1, params: [] })
    workers[0].onmessage({ data: progress })
    expect(posted).toEqual([progress])
  })

  it.each(['jscadMain', 'jscadScript', 'jscadInit'])('drops progress while only a %s is pending', (method) => {
    const { posted, workers, send } = setup()
    send({ method, id: 1, params: [] })
    posted.length = 0
    workers[0].onmessage({ data: progress })
    expect(posted).toEqual([])
  })

  it('drops a cells message that carries an id', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] })
    workers[0].onmessage({ data: { ...cells, id: 'x' } })
    expect(posted).toEqual([])
  })

  it('restarts the kill timer on each relayed message', () => {
    const { posted, workers, send } = setup()
    init(send, { timeoutMs: 1000 }, 1)
    answer(workers[0])
    send({ method: 'jscadMain', id: 2, params: [] })
    vi.advanceTimersByTime(900)
    workers[0].onmessage({ data: cells })
    vi.advanceTimersByTime(900)
    workers[0].onmessage({ data: cells })
    vi.advanceTimersByTime(900)
    expect(posted.find((m) => m.id === 2)).toBeUndefined()
    vi.advanceTimersByTime(101)
    expect(posted.find((m) => m.id === 2)?.error?.name).toBe('TimeoutError')
  })

  it('restarts the kill timer on relayed progress during an export', () => {
    const { posted, workers, send } = setup()
    init(send, { timeoutMs: 1000 }, 1)
    answer(workers[0])
    send({ method: 'jscadExportData', id: 2, params: [] })
    vi.advanceTimersByTime(900)
    workers[0].onmessage({ data: progress })
    vi.advanceTimersByTime(900)
    expect(posted.find((m) => m.id === 2)).toBeUndefined()
    vi.advanceTimersByTime(101)
    expect(posted.find((m) => m.id === 2)?.error?.name).toBe('TimeoutError')
  })
})

const methodsOf = (worker) => worker.postMessage.mock.calls.map(([m]) => m.method)
const lastSent = (worker) => worker.postMessage.mock.calls.at(-1)[0]
const answerLast = (worker, params = {}) =>
  worker.onmessage({ data: { method: RESPONSE, id: lastSent(worker).id, params } })
const failLast = (worker, name, message = name) =>
  worker.onmessage({ data: { method: RESPONSE, id: lastSent(worker).id, error: { name, message } } })

// A host whose active worker ran a script, with the spare's setup answered.
const withSpare = ({ timeoutMs } = {}) => {
  const ctx = setup()
  const { workers, send } = ctx
  init(send, timeoutMs ? { timeoutMs } : {}, 1)
  answer(workers[0], 0)
  send({ method: 'jscadSetFiles', id: 2, params: [{ files: { 'main.js': 'x' } }] })
  answer(workers[0], 1)
  send({ method: 'jscadScript', id: 3, params: [{ script: 'main', url: 'main.js' }] })
  answer(workers[0], 2, { def: [], params: {} })
  answer(workers[1], 0)
  answer(workers[1], 1)
  ctx.posted.length = 0
  return ctx
}

describe('warm spare', () => {
  it('is created after the first script answer and holds the setup but no script', () => {
    const { workers, send, posted } = setup()
    init(send, { engine: 'manifold' }, 1)
    answer(workers[0], 0)
    send({ method: 'jscadSetFiles', id: 2, params: [{ files: { 'main.js': 'x' } }] })
    answer(workers[0], 1)
    send({ method: 'jscadScript', id: 3, params: [{ script: 'main' }] })
    expect(workers).toHaveLength(1)
    answer(workers[0], 2, { def: [], params: {} })

    expect(workers).toHaveLength(2)
    expect(methodsOf(workers[1])).toEqual(['jscadInit', 'jscadSetFiles'])
    const [spareInit] = workers[1].postMessage.mock.calls[0]
    expect(spareInit.params[0].bundles['@jscad/modeling']).toBe(BASE + 'bundle.manifold_modeling.js')
    expect(spareInit.params[0].appOrigin).toBe(APP)
    expect(workers[1].postMessage.mock.calls[1][0].params).toEqual([{ files: { 'main.js': 'x' } }])
    expect(posted.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('mirrors later setup to the spare and drops its answers', () => {
    const { workers, send, posted, host } = withSpare()
    send({ method: 'jscadClearTempCache', id: 4, params: [] })
    send({ method: 'jscadClearFileCache', id: 5, params: [{ files: ['a.js'], root: '/' }] })
    send({ method: 'jscadMain', id: 6, params: [{ params: {} }] })
    expect(methodsOf(workers[1]).slice(2)).toEqual(['jscadClearTempCache', 'jscadClearFileCache'])
    expect(host.getPendingCount()).toBe(3)
    answerLast(workers[1])
    workers[1].onmessage({ data: { method: RESPONSE, id: workers[1].postMessage.mock.calls[2][0].id, params: {} } })
    expect(posted).toEqual([])
  })

  it('keeps its own copy of file buffers the active worker takes by transfer', () => {
    const { workers, send } = withSpare()
    const bytes = new Uint8Array([1, 2, 3])
    send({ method: 'jscadSetFiles', id: 4, params: [{ files: { 'a.stl': bytes } }] })
    const [toActive, transfer] = workers[0].postMessage.mock.calls.at(-1)
    const [toSpare, spareTransfer] = workers[1].postMessage.mock.calls.at(-1)
    expect(transfer).toEqual([bytes.buffer])
    expect(spareTransfer).toBeUndefined()
    expect(toSpare.params[0].files['a.stl']).toEqual(bytes)
    expect(toSpare.params[0].files['a.stl'].buffer).not.toBe(toActive.params[0].files['a.stl'].buffer)
  })

  it('drops cells the spare sends', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [] })
    workers[1].onmessage({ data: { method: 'jscadCells', params: [{ entities: [] }] } })
    expect(posted).toEqual([])
  })
})

describe('trap retirement', () => {
  it('relays a RuntimeError, retires the worker and loads the script into the promoted spare', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: { size: 2 } }] })
    failLast(workers[0], 'RuntimeError', 'unreachable')

    expect(posted).toEqual([{ method: RESPONSE, id: 4, error: { name: 'RuntimeError', message: 'unreachable' } }])
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(workers).toHaveLength(3)
    expect(methodsOf(workers[2])).toEqual(['jscadInit', 'jscadSetFiles'])

    send({ method: 'jscadMain', id: 5, params: [{ params: { size: 3 } }] })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ script: 'main', url: 'main.js', runMain: false }] })
    answerLast(workers[1], { def: [], params: {} })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadMain', params: [{ params: { size: 3 } }] })
    answerLast(workers[1], { entities: [] })

    expect(posted.slice(1)).toEqual([{ method: RESPONSE, id: 5, params: { entities: [] } }])
    expect(posted.filter((m) => m.method === 'frameWorkerTerminated')).toEqual([])
  })

  it('retires on a trapped result the same way', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    answerLast(workers[0], { entities: [], trapped: true })

    expect(posted).toEqual([{ method: RESPONSE, id: 4, params: { entities: [], trapped: true } }])
    expect(workers[0].terminate).toHaveBeenCalled()
    send({ method: 'jscadMain', id: 5, params: [{ params: {} }] })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ runMain: false }] })
  })

  it('runs the last main without streaming before an export on the promoted worker', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: { size: 2 }, stream: true, runId: 9 }] })
    answerLast(workers[0], { entities: [], trapped: true })

    send({ method: 'jscadExportData', id: 5, params: [{ format: 'stla' }] })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ script: 'main', runMain: false }] })
    answerLast(workers[1], { def: [], params: {} })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadMain', params: [{ params: { size: 2 }, stream: false, runId: 9 }] })
    answerLast(workers[1], { entities: [] })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadExportData', params: [{ format: 'stla' }] })
    answerLast(workers[1], { data: ['solid'] })

    expect(posted.slice(1)).toEqual([{ method: RESPONSE, id: 5, params: { data: ['solid'] } }])
  })

  it('answers the request with the error when the reload fails', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    failLast(workers[0], 'RuntimeError')
    send({ method: 'jscadMeasure', id: 5, params: [{}] })
    failLast(workers[1], 'SyntaxError', 'bad script')

    expect(posted.slice(1)).toEqual([{ method: RESPONSE, id: 5, error: { name: 'SyntaxError', message: 'bad script' } }])
    expect(methodsOf(workers[1]).at(-1)).toBe('jscadScript')
  })

  it('holds later requests until the reload finishes and keeps their order', () => {
    const { workers, send, posted, host } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    failLast(workers[0], 'RuntimeError')
    send({ method: 'jscadMain', id: 5, params: [{ params: { a: 1 } }] })
    send({ method: 'jscadGetExportFormats', id: 6, params: [] })
    expect(host.getPendingCount()).toBe(2)
    expect(methodsOf(workers[1]).slice(2)).toEqual(['jscadScript'])
    answerLast(workers[1], { def: [], params: {} })
    expect(methodsOf(workers[1]).slice(3)).toEqual(['jscadMain', 'jscadGetExportFormats'])
    expect(posted).toHaveLength(1)
  })

  it('answers file setup still pending on the trapped worker with the promoted worker answer', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    send({ method: 'jscadSetFiles', id: 5, params: [{ files: { 'main.js': 'y' } }] })
    const copy = workers[1].postMessage.mock.calls.findLast(([m]) => m.method === 'jscadSetFiles')[0]
    workers[0].onmessage({ data: { method: RESPONSE, id: workerIdOf(workers[0], 3), error: { name: 'RuntimeError', message: 'unreachable' } } })

    expect(posted.find((m) => m.id === 5)).toBeUndefined()
    workers[1].onmessage({ data: { method: RESPONSE, id: copy.id, params: 'set' } })
    expect(posted.find((m) => m.id === 5)).toEqual({ method: RESPONSE, id: 5, params: 'set' })
  })

  it('relays a script to the promoted worker without reloading the old one', () => {
    const { workers, send } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    failLast(workers[0], 'RuntimeError')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'next' }] })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ script: 'next' }] })
    answerLast(workers[1], { def: [], params: {} })
    send({ method: 'jscadMain', id: 6, params: [{ params: {} }] })
    expect(methodsOf(workers[1]).slice(2)).toEqual(['jscadScript', 'jscadMain'])
  })
})

describe('export after a promotion', () => {
  it('script answered, trap, export: runs the new script main instead of the old model params', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: { size: 2 } }] })
    answerLast(workers[0], { entities: [] })
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid', url: 'ALL.js' }] })
    answerLast(workers[0], { def: [], params: {}, trapped: true })
    expect(workers[0].terminate).toHaveBeenCalled()

    send({ method: 'jscadExportData', id: 6, params: [{ format: 'stla' }] })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ script: 'grid', url: 'ALL.js', runMain: true }] })
    answerLast(workers[1], { def: [], params: {} })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadExportData', params: [{ format: 'stla' }] })
    answerLast(workers[1], { data: ['solid'] })

    expect(posted.at(-1)).toEqual({ method: RESPONSE, id: 6, params: { data: ['solid'] } })
  })

  it('loads without running main for a run that brings its own params', () => {
    const { workers, send } = withSpare()
    send({ method: 'jscadScript', id: 4, params: [{ script: 'grid' }] })
    answerLast(workers[0], { def: [], params: {}, trapped: true })
    send({ method: 'jscadMain', id: 5, params: [{ params: {} }] })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ script: 'grid', runMain: false }] })
  })

  it('serves an export whose reload run traps, then retires on the next app run that traps', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: { size: 2 } }] })
    answerLast(workers[0], { entities: [], trapped: true })

    send({ method: 'jscadExportData', id: 5, params: [{ format: 'stla' }] })
    answerLast(workers[1], { def: [], params: {} })
    answerLast(workers[1], { entities: [], trapped: true })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadExportData' })
    answerLast(workers[1], { data: ['solid'] })

    expect(posted.at(-1)).toEqual({ method: RESPONSE, id: 5, params: { data: ['solid'] } })
    expect(workers[1].terminate).not.toHaveBeenCalled()
    send({ method: 'jscadMain', id: 6, params: [{ params: { size: 2 } }] })
    answerLast(workers[1], { entities: [], trapped: true })
    expect(workers[1].terminate).toHaveBeenCalled()
  })
})

describe('reload after a trap', () => {
  it('does not load the old script over one the app is loading', () => {
    const { workers, send } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    failLast(workers[0], 'RuntimeError')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'next' }] })
    send({ method: 'jscadMain', id: 6, params: [{ params: {} }] })

    const sent = workers[1].postMessage.mock.calls.slice(2).map(([m]) => m)
    expect(sent.map((m) => m.method)).toEqual(['jscadScript', 'jscadMain'])
    expect(sent[0].params).toEqual([{ script: 'next' }])
    expect(sent.some((m) => m.params?.[0]?.runMain === false)).toBe(false)
  })
})

describe('kill with a spare', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('still reports the kill, then serves the next request from the former spare', () => {
    const { workers, send, posted } = withSpare({ timeoutMs: 1000 })
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    vi.advanceTimersByTime(1001)

    expect(posted.find((m) => m.id === 4)?.error?.name).toBe('TimeoutError')
    expect(posted.filter((m) => m.method === 'frameWorkerTerminated')).toHaveLength(1)
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(workers).toHaveLength(3)

    send({ method: 'jscadMain', id: 5, params: [{ params: {} }] })
    expect(workers).toHaveLength(3)
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ runMain: false }] })
  })

  it('answers a request held for a reload when the promoted worker is killed', () => {
    const { workers, send, posted } = withSpare({ timeoutMs: 1000 })
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    failLast(workers[0], 'RuntimeError')
    answer(workers[2], 0)
    answer(workers[2], 1)
    send({ method: 'jscadMain', id: 5, params: [{ params: {} }] })
    vi.advanceTimersByTime(1001)
    expect(posted.find((m) => m.id === 5)?.error?.name).toBe('AbortError')
    expect(posted.filter((m) => m.method === 'frameWorkerTerminated')).toHaveLength(1)
  })

  it('discards a spare that times out without telling the app', () => {
    const { workers, send, posted } = setup()
    init(send, { timeoutMs: 1000 }, 1)
    answer(workers[0], 0)
    send({ method: 'jscadScript', id: 2, params: [{ script: 'main' }] })
    answer(workers[0], 1, { def: [], params: {} })
    vi.advanceTimersByTime(1001)
    expect(workers[1].terminate).toHaveBeenCalled()
    expect(posted.map((m) => m.id ?? m.method)).toEqual([1, 2])
  })
})

describe('superseding a stale run', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const superseded = { name: 'SupersededError', message: 'superseded by a newer run' }

  it('answers a run pending 600 ms SupersededError and runs the new one on the promoted worker', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: { size: 1 } }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 5, params: [{ params: { size: 2 }, supersede: true }] })

    expect(posted).toEqual([{ method: RESPONSE, id: 4, error: superseded }])
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ script: 'main', runMain: false }] })
    answerLast(workers[1], { def: [], params: {} })
    expect(lastSent(workers[1]).params).toEqual([{ params: { size: 2 } }])
    answerLast(workers[1], { entities: [] })

    expect(posted.slice(1)).toEqual([{ method: RESPONSE, id: 5, params: { entities: [] } }])
    expect(posted.filter((m) => m.method === 'frameWorkerTerminated')).toEqual([])
  })

  it('relays a run superseding one pending 100 ms to the same worker and answers nothing early', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    vi.advanceTimersByTime(100)
    send({ method: 'jscadMain', id: 5, params: [{ params: {}, runId: 7, held: ['0123456789abcdef'], stream: true, supersede: true }] })

    expect(posted).toEqual([])
    expect(workers[0].terminate).not.toHaveBeenCalled()
    expect(lastSent(workers[0])).toMatchObject({ method: 'jscadMain' })
    expect(lastSent(workers[0]).params).toEqual([{ params: {}, runId: 7, held: ['0123456789abcdef'], stream: true }])
  })

  it('strips supersede from a script', () => {
    const { workers, send } = setup()
    send({ method: 'jscadScript', id: 1, params: [{ script: 'main', supersede: true }] })
    expect(lastSent(workers[0]).params).toEqual([{ script: 'main' }])
  })

  it('answers a younger run behind the stale one SupersededError too', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: { size: 1 } }] })
    vi.advanceTimersByTime(200)
    send({ method: 'jscadMain', id: 5, params: [{ params: { size: 2 } }] })
    vi.advanceTimersByTime(450)
    send({ method: 'jscadMain', id: 6, params: [{ params: { size: 3 }, supersede: true }] })

    expect(posted).toEqual([
      { method: RESPONSE, id: 4, error: superseded },
      { method: RESPONSE, id: 5, error: superseded },
    ])
    answerLast(workers[1], { def: [], params: {} })
    expect(lastSent(workers[1]).params).toEqual([{ params: { size: 3 } }])
    answerLast(workers[1], { entities: [] })
    expect(posted.slice(2)).toEqual([{ method: RESPONSE, id: 6, params: { entities: [] } }])
  })

  it('answers another request on the retired worker as a retire does', () => {
    const { send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    send({ method: 'jscadExportData', id: 5, params: [{ format: 'stla' }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 6, params: [{ params: {}, supersede: true }] })

    expect(posted.find((m) => m.id === 4).error).toEqual(superseded)
    expect(posted.find((m) => m.id === 5).error.name).toBe('AbortError')
  })

  it('sends a superseding script straight to the promoted worker', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadScript', id: 5, params: [{ script: 'next', supersede: true }] })

    expect(posted).toEqual([{ method: RESPONSE, id: 4, error: superseded }])
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ script: 'next' }] })
  })

  it('answers file setup the retired worker still held with the promoted worker answer', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadSetFiles', id: 5, params: [{ files: { 'main.js': 'y' } }] })
    send({ method: 'jscadScript', id: 6, params: [{ script: 'next', supersede: true }] })

    expect(posted.find((m) => m.id === 5)).toBeUndefined()
    const copy = workers[1].postMessage.mock.calls.findLast(([m]) => m.method === 'jscadSetFiles')[0]
    workers[1].onmessage({ data: { method: RESPONSE, id: copy.id, params: 'set' } })
    expect(posted.find((m) => m.id === 5)).toEqual({ method: RESPONSE, id: 5, params: 'set' })
  })

  it('answers file setup the promoted worker already finished at once', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadSetFiles', id: 5, params: [{ files: { 'main.js': 'y' } }] })
    const copy = workers[1].postMessage.mock.calls.findLast(([m]) => m.method === 'jscadSetFiles')[0]
    workers[1].onmessage({ data: { method: RESPONSE, id: copy.id, params: 'set' } })
    send({ method: 'jscadScript', id: 6, params: [{ script: 'next', supersede: true }] })

    expect(posted.find((m) => m.id === 5)).toEqual({ method: RESPONSE, id: 5, params: 'set' })
  })

  it('keeps only the newest superseding run queued behind the reload', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: { size: 1 } }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 5, params: [{ params: { size: 2 }, supersede: true }] })
    vi.advanceTimersByTime(500)
    send({ method: 'jscadMain', id: 6, params: [{ params: { size: 3 }, supersede: true }] })
    vi.advanceTimersByTime(500)
    send({ method: 'jscadMain', id: 7, params: [{ params: { size: 4 }, supersede: true }] })

    expect(posted).toEqual([
      { method: RESPONSE, id: 4, error: superseded },
      { method: RESPONSE, id: 5, error: superseded },
      { method: RESPONSE, id: 6, error: superseded },
    ])
    answerLast(workers[1], { def: [], params: {} })
    expect(methodsOf(workers[1]).slice(2)).toEqual(['jscadScript', 'jscadMain'])
    expect(lastSent(workers[1]).params).toEqual([{ params: { size: 4 } }])
    answerLast(workers[1], { entities: [] })
    expect(posted.at(-1)).toEqual({ method: RESPONSE, id: 7, params: { entities: [] } })
  })

  it('keeps a queued run that a queued export will read', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 5, params: [{ params: { size: 2 }, supersede: true }] })
    send({ method: 'jscadExportData', id: 6, params: [{ format: 'stla' }] })
    send({ method: 'jscadMain', id: 7, params: [{ params: { size: 3 }, supersede: true }] })

    expect(posted.map((m) => m.id)).toEqual([4])
    answerLast(workers[1], { def: [], params: {} })
    expect(methodsOf(workers[1]).slice(2)).toEqual(['jscadScript', 'jscadMain', 'jscadExportData', 'jscadMain'])
  })

  it('keeps a script queued behind the reload when a run supersedes', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 5, params: [{ params: {}, supersede: true }] })
    send({ method: 'jscadScript', id: 6, params: [{ script: 'next' }] })
    send({ method: 'jscadMain', id: 7, params: [{ params: {}, supersede: true }] })

    expect(posted.map((m) => m.id)).toEqual([4, 5])
    answerLast(workers[1], { def: [], params: {} })
    expect(methodsOf(workers[1]).slice(2)).toEqual(['jscadScript', 'jscadScript', 'jscadMain'])
  })

  it('does not abandon a pending load for a run', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadScript', id: 4, params: [{ script: 'next' }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 5, params: [{ params: {}, supersede: true }] })

    expect(posted).toEqual([])
    expect(workers[0].terminate).not.toHaveBeenCalled()
    expect(lastSent(workers[0])).toMatchObject({ method: 'jscadMain' })
  })

  it('does not abandon a run for a request without supersede', () => {
    const { workers, send, posted } = withSpare()
    send({ method: 'jscadMain', id: 4, params: [{ params: {} }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 5, params: [{ params: {} }] })
    expect(posted).toEqual([])
    expect(workers[0].terminate).not.toHaveBeenCalled()
  })

  it('answers the new request when no worker can replace the retired one', () => {
    const posted = []
    let made = 0
    const host = createFrameHost({
      allowedOrigin: APP,
      bundleBase: BASE,
      createWorker: () => {
        if (made++) throw new Error('out of memory')
        return { postMessage: vi.fn(), terminate: vi.fn() }
      },
      post: (message) => posted.push(message),
      parentWindow,
    })
    const send = (data) => host.handleMessage({ origin: APP, source: parentWindow, data })
    send({ method: 'jscadScript', id: 1, params: [{ script: 'main' }] })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadScript', id: 2, params: [{ script: 'next', supersede: true }] })

    expect(posted).toEqual([
      { method: RESPONSE, id: 1, error: superseded },
      { method: RESPONSE, id: 2, error: { name: 'Error', message: 'could not start the model worker: out of memory' } },
    ])
  })
})

describe('worker load failure', () => {
  it('answers with the load error rather than waiting out the timeout', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadScript', id: 4, params: [] })
    workers[0].onerror({ message: 'importScripts failed', preventDefault: () => {} })

    expect(posted.find((m) => m.id === 4)?.error).toEqual({
      name: 'AbortError',
      message: 'worker terminated before this request finished: importScripts failed',
    })
    expect(posted.find((m) => m.method === 'frameWorkerTerminated').params[0].reason).toBe('importScripts failed')
  })

  it('answers a request whose reply could not be deserialized', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadExportData', id: 5, params: [] })
    workers[0].onmessageerror({})
    expect(posted.find((m) => m.id === 5)?.error?.name).toBe('AbortError')
  })
})

describe('grid runs', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const superseded = { name: 'SupersededError', message: 'superseded by a newer run' }
  const sent = (worker) => worker.postMessage.mock.calls.map(([m]) => m)

  // Answers every setup and load the worker was sent, so a worker that joined a run reaches its jscadMain.
  const loadAll = (worker) => {
    for (const message of sent(worker)) {
      if (message.id && ['jscadInit', 'jscadSetFiles', 'jscadScript'].includes(message.method)) {
        worker.onmessage({ data: { method: RESPONSE, id: message.id, params: { def: [], params: {} } } })
      }
    }
  }

  let claims = 0
  const claimOn = (worker, key, { runId = 7, url = `./${key}.scad` } = {}) => {
    const id = `claim-${++claims}`
    worker.onmessage({ data: { method: 'jscadClaim', id, params: [{ key, url, runId }] } })
    return sent(worker).find((m) => m.method === '__CLAIM__' && m.params[0].id === id)?.params[0].won
  }

  const lastOf = (worker, method) => sent(worker).findLast((m) => m.method === method)
  const answerLastOf = (worker, method, params = { entities: [] }) =>
    worker.onmessage({ data: { method: RESPONSE, id: lastOf(worker, method).id, params } })

  // A grid script loaded, the spare set up, and app run 4 (runId 7) in flight on the active worker.
  const gridRun = ({ poolSize = 3, timeoutMs } = {}) => {
    const ctx = setup()
    const { workers, send } = ctx
    init(send, { poolSize, ...(timeoutMs ? { timeoutMs } : {}) }, 1)
    answer(workers[0], 0)
    send({ method: 'jscadSetFiles', id: 2, params: [{ files: { 'ALL.js': 'grid' } }] })
    answer(workers[0], 1)
    send({ method: 'jscadScript', id: 3, params: [{ script: 'grid', url: 'ALL.js', runMain: false }] })
    answer(workers[0], 2, { def: [], params: {} })
    loadAll(workers[1])
    send({ method: 'jscadMain', id: 4, params: [{ params: {}, runId: 7 }] })
    ctx.posted.length = 0
    return ctx
  }

  it('tells each worker it may claim leaves and strips poolSize', () => {
    const { workers, send } = setup()
    init(send, { poolSize: 2 })
    expect(workers[0].postMessage.mock.calls[0][0].params[0]).toMatchObject({ claims: true })
    expect(workers[0].postMessage.mock.calls[0][0].params[0].poolSize).toBeUndefined()
  })

  it('fans a run out on its first claim, reloading each joining worker first', () => {
    const { workers } = gridRun()
    expect(claimOn(workers[0], '0')).toBe(true)
    expect(workers).toHaveLength(4)
    expect(lastOf(workers[1], 'jscadScript')).toMatchObject({ params: [{ script: 'grid', url: 'ALL.js', runMain: false }] })
    loadAll(workers[1])
    expect(lastOf(workers[1], 'jscadMain').params).toEqual([{ params: {}, runId: 7 }])
    loadAll(workers[2])
    expect(lastOf(workers[2], 'jscadMain').params).toEqual([{ params: {}, runId: 7 }])
    expect(lastOf(workers[3], 'jscadMain')).toBeUndefined()
  })

  it('fans out nothing when the pool holds one worker', () => {
    const { workers } = gridRun({ poolSize: 1 })
    expect(claimOn(workers[0], '0')).toBe(true)
    expect(claimOn(workers[0], '1')).toBe(true)
    expect(workers).toHaveLength(2)
    expect(methodsOf(workers[1])).toEqual(['jscadInit', 'jscadSetFiles'])
  })

  it('gives a late joiner only the keys nobody claimed', () => {
    const { workers } = gridRun()
    claimOn(workers[0], '0')
    claimOn(workers[0], '1')
    loadAll(workers[1])
    expect(claimOn(workers[1], '0')).toBe(false)
    expect(claimOn(workers[1], '2')).toBe(true)
    expect(claimOn(workers[0], '2')).toBe(false)
  })

  it('ignores a claim from a worker outside the run', () => {
    const { workers } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[3])
    expect(claimOn(workers[3], '1')).toBe(false)
    expect(claimOn(workers[0], '1')).toBe(true)
  })

  it('answers the app once, after its last member answers', () => {
    const { workers, posted, host } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[1])
    loadAll(workers[2])
    answerLastOf(workers[0], 'jscadMain', { entities: [], streamed: true, runId: 7 })
    answerLastOf(workers[1], 'jscadMain')
    expect(posted.filter((m) => m.id === 4)).toEqual([])
    expect(host.getPendingCount()).toBe(1)
    answerLastOf(workers[2], 'jscadMain')
    expect(posted.filter((m) => m.id === 4)).toEqual([
      { method: RESPONSE, id: 4, params: { entities: [], streamed: true, runId: 7, lost: [] } },
    ])
    expect(host.getPendingCount()).toBe(0)
  })

  it('relays cells from every member while the run is open', () => {
    const { workers, posted } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[1])
    const cells = { method: 'jscadCells', params: [{ entities: [], runId: 7 }] }
    workers[1].onmessage({ data: cells })
    workers[3].onmessage({ data: cells })
    expect(posted).toEqual([cells])
  })

  it('replaces a member that traps and leaves the flag out of the answer', () => {
    const { workers, posted } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[1])
    loadAll(workers[2])
    expect(claimOn(workers[1], '1')).toBe(true)
    answerLastOf(workers[1], 'jscadMain', { entities: [], trapped: true })
    expect(workers[1].terminate).toHaveBeenCalled()
    loadAll(workers[3])
    expect(lastOf(workers[3], 'jscadMain').params).toEqual([{ params: {}, runId: 7 }])
    answerLastOf(workers[0], 'jscadMain')
    answerLastOf(workers[2], 'jscadMain')
    answerLastOf(workers[3], 'jscadMain')
    expect(posted.find((m) => m.id === 4).params).toEqual({ entities: [], streamed: true, runId: 7, lost: [] })
  })

  it('reports the leaf a timed-out member was running as lost, and the run goes on', () => {
    const { workers, posted } = gridRun({ timeoutMs: 1000 })
    claimOn(workers[0], '0')
    loadAll(workers[1])
    loadAll(workers[2])
    loadAll(workers[3])
    claimOn(workers[1], '1', { url: './slow.scad' })
    vi.advanceTimersByTime(600)
    claimOn(workers[0], '2')
    claimOn(workers[2], '3')
    vi.advanceTimersByTime(500)
    expect(workers[1].terminate).toHaveBeenCalled()
    loadAll(workers[3])
    answerLastOf(workers[0], 'jscadMain')
    answerLastOf(workers[2], 'jscadMain')
    answerLastOf(workers[3], 'jscadMain')
    expect(posted.find((m) => m.id === 4).params.lost).toEqual([{ url: './slow.scad', reason: 'TimeoutError' }])
    expect(posted.filter((m) => m.method === 'frameWorkerTerminated')).toEqual([])
  })

  it('tells the app its worker stopped only when no worker is left to finish the grid', () => {
    const posted = []
    const workers = []
    const host = createFrameHost({
      allowedOrigin: APP,
      bundleBase: BASE,
      parentWindow,
      post: (message) => posted.push(message),
      createWorker: () => {
        if (workers.length) throw new Error('out of memory')
        const worker = { postMessage: vi.fn(), terminate: vi.fn() }
        workers.push(worker)
        return worker
      },
    })
    const send = (data) => host.handleMessage({ origin: APP, source: parentWindow, data })
    init(send, { poolSize: 2, timeoutMs: 1000 }, 1)
    answer(workers[0], 0)
    send({ method: 'jscadMain', id: 2, params: [{ params: {}, runId: 7 }] })
    claimOn(workers[0], '0')
    vi.advanceTimersByTime(1001)
    expect(posted.filter((m) => m.method === 'frameWorkerTerminated')).toHaveLength(1)
    expect(posted.find((m) => m.id === 2)?.error?.name).toBe('AbortError')
  })

  it('supersedes a grid run at once, retiring members on an old leaf and draining the rest', () => {
    const { workers, posted, send } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[1])
    loadAll(workers[2])
    loadAll(workers[3])
    vi.advanceTimersByTime(400)
    claimOn(workers[1], '1')
    vi.advanceTimersByTime(200)
    send({ method: 'jscadMain', id: 5, params: [{ params: { size: 2 }, runId: 8, supersede: true }] })

    expect(posted.find((m) => m.id === 4)).toEqual({ method: RESPONSE, id: 4, error: superseded })
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(workers[1].terminate).not.toHaveBeenCalled()
    expect(workers[2].terminate).not.toHaveBeenCalled()
    expect(claimOn(workers[1], '2')).toBe(false)
    workers[1].onmessage({ data: { method: 'jscadCells', params: [{ entities: [], runId: 7 }] } })
    expect(posted.filter((m) => m.method === 'jscadCells')).toEqual([])
  })

  it('leaves a grid load alone when a run supersedes it', () => {
    const { workers, posted, send } = gridRun()
    answerLastOf(workers[0], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runId: 9 }] })
    claimOn(workers[0], '0', { runId: 9 })
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 6, params: [{ params: {}, runId: 10, supersede: true }] })
    expect(posted.find((m) => m.id === 5)).toBeUndefined()
    expect(workers[0].terminate).not.toHaveBeenCalled()
  })

  it('sends a load that fans out the load itself', () => {
    const { workers, send } = gridRun()
    answerLastOf(workers[0], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runId: 9 }] })
    claimOn(workers[0], '0', { runId: 9 })
    expect(lastOf(workers[1], 'jscadScript').params).toEqual([{ script: 'grid2', url: 'ALL.js', runId: 9 }])
  })

  it('reloads the current script on an idle worker that holds an older one', () => {
    const { workers, send } = gridRun({ poolSize: 2 })
    claimOn(workers[0], '0')
    loadAll(workers[1])
    answerLastOf(workers[0], 'jscadMain')
    answerLastOf(workers[1], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runMain: false }] })
    answerLastOf(workers[0], 'jscadScript', { def: [], params: {} })
    send({ method: 'jscadMain', id: 6, params: [{ params: {}, runId: 8 }] })
    claimOn(workers[0], '0', { runId: 8 })
    expect(lastSent(workers[1])).toMatchObject({ method: 'jscadScript', params: [{ script: 'grid2', runMain: false }] })
  })

  it('loads the script the app sent last on a joiner of a run that fans out during a grid load', () => {
    const { workers, send } = gridRun()
    answerLastOf(workers[0], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runId: 9 }] })
    claimOn(workers[0], '0', { runId: 9 })
    loadAll(workers[3])
    vi.advanceTimersByTime(600)
    send({ method: 'jscadMain', id: 6, params: [{ params: {}, runId: 10, supersede: true }] })
    claimOn(workers[0], '1', { runId: 10 })
    expect(lastOf(workers[3], 'jscadScript').params).toEqual([{ script: 'grid2', url: 'ALL.js', runId: 9, runMain: false }])
  })

  const failLastOf = (worker, method, name = 'SyntaxError') =>
    worker.onmessage({ data: { method: RESPONSE, id: lastOf(worker, method).id, error: { name, message: name } } })

  it('loads the last good script on a joiner after a load fails', () => {
    const { workers, send } = gridRun()
    answerLastOf(workers[0], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'bad', url: 'ALL.js', runMain: false }] })
    failLastOf(workers[0], 'jscadScript')
    send({ method: 'jscadMain', id: 6, params: [{ params: {}, runId: 8 }] })
    claimOn(workers[0], '0', { runId: 8 })
    expect(lastOf(workers[1], 'jscadScript').params[0]).toMatchObject({ script: 'grid', runMain: false })
  })

  it('loads the last good script on a joiner after a grid load fails', () => {
    const { workers, send } = gridRun()
    answerLastOf(workers[0], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'bad', url: 'ALL.js', runId: 9 }] })
    claimOn(workers[0], '0', { runId: 9 })
    for (const worker of workers.slice(0, 3)) failLastOf(worker, 'jscadScript')
    send({ method: 'jscadMain', id: 6, params: [{ params: {}, runId: 10 }] })
    claimOn(workers[0], '0', { runId: 10 })
    expect(lastOf(workers[1], 'jscadScript').params[0]).toMatchObject({ script: 'grid', runMain: false })
  })

  it('runs a run held behind a reload against the script loaded when it arrived', () => {
    const { workers, send } = gridRun()
    answerLastOf(workers[0], 'jscadMain', { entities: [], trapped: true })
    send({ method: 'jscadMain', id: 5, params: [{ params: {}, runId: 8 }] })
    send({ method: 'jscadScript', id: 6, params: [{ script: 'grid2', url: 'ALL.js', runMain: false }] })
    answerLastOf(workers[1], 'jscadScript', { def: [], params: {} })
    claimOn(workers[1], '0', { runId: 8 })
    expect(lastOf(workers[2], 'jscadScript').params[0]).toMatchObject({ script: 'grid', runMain: false })
  })

  it('closes a superseded run that has not claimed yet, so it never fans out', () => {
    const { workers, posted, send } = gridRun()
    vi.advanceTimersByTime(100)
    send({ method: 'jscadMain', id: 5, params: [{ params: {}, runId: 8, supersede: true }] })
    expect(claimOn(workers[0], '0')).toBe(false)
    expect(workers).toHaveLength(2)
    workers[0].onmessage({ data: { method: 'jscadCells', params: [{ entities: [], runId: 7 }] } })
    expect(posted.filter((m) => m.method === 'jscadCells' || m.id === 4)).toEqual([])
  })

  it('does not report a leaf whose cells streamed as lost when its member dies', () => {
    const { workers, posted } = gridRun()
    claimOn(workers[0], '0')
    loadAll(workers[1])
    loadAll(workers[2])
    claimOn(workers[1], '1')
    workers[1].onmessage({ data: { method: 'jscadCells', params: [{ entities: [], runId: 7 }] } })
    workers[1].onerror({ message: 'gone', preventDefault: () => {} })
    loadAll(workers[3])
    expect(lastOf(workers[3], 'jscadMain')).toBeUndefined()
    answerLastOf(workers[0], 'jscadMain')
    answerLastOf(workers[2], 'jscadMain')
    expect(posted.find((m) => m.id === 4).params.lost).toEqual([])
  })

  it('does not retire a member holding a pending load when a run supersedes the grid', () => {
    const { workers, posted, send } = gridRun()
    claimOn(workers[0], '0')
    vi.advanceTimersByTime(600)
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runMain: false }] })
    send({ method: 'jscadMain', id: 6, params: [{ params: {}, runId: 8, supersede: true }] })
    expect(posted.find((m) => m.id === 4)).toEqual({ method: RESPONSE, id: 4, error: superseded })
    expect(workers[0].terminate).not.toHaveBeenCalled()
    expect(posted.find((m) => m.id === 5)).toBeUndefined()
  })

  it('merges the params every member discovered into the answer to a load', () => {
    const { workers, posted, send } = gridRun({ poolSize: 2 })
    answerLastOf(workers[0], 'jscadMain')
    send({ method: 'jscadScript', id: 5, params: [{ script: 'grid2', url: 'ALL.js', runId: 9 }] })
    claimOn(workers[0], '0', { runId: 9 })
    const param = (path, value) => ({ path, parent: path.split('.')[0], name: path.split('.')[1], type: 'number', default: value })
    const state = (...discovered) => ({ discovered, types: {}, classes: {} })
    answerLastOf(workers[0], 'jscadScript', { def: [], params: {}, entities: [], streamed: true, runId: 9, proxyState: state(param('a.size', 1)) })
    answerLastOf(workers[1], 'jscadScript', { def: [], params: {}, entities: [], proxyState: state(param('b.size', 2)) })

    const { params } = posted.find((m) => m.id === 5)
    expect(params.proxyState.discovered.map((p) => p.path)).toEqual(['a.size', 'b.size'])
    expect(Object.keys(params.proxyState.tree.children)).toEqual(['a', 'b'])
    expect(params.params).toEqual({ 'a.size': 1, 'b.size': 2 })
    expect(params.def.map((d) => d.name)).toEqual(['_group_a', 'a.size', '_group_b', 'b.size'])
  })
})
