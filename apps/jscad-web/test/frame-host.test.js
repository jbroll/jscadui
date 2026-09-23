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
