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
    expect(workers[0].postMessage).toHaveBeenCalledWith({ method: 'jscadMain', id: 1, params: [] }, [])
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
    workers[0].onmessage({ data: { method: RESPONSE, id: 1, params: {} } })

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
    workers[0].onmessage({ data: { method: RESPONSE, id: 1, params: {} } })
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
