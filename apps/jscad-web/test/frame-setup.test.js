// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFrame } from '../src/frameSetup.js'

const RUN = 'https://run.example'
const RESPONSE = '__RESPONSE__'

const boot = async (options = {}) => {
  const errors = []
  const jobs = []
  const terminated = vi.fn()
  const pending = createFrame({
    onError: (e) => errors.push(e),
    onEntities: () => {},
    onJobCount: (n) => jobs.push(n),
    onTerminated: terminated,
    runOrigin: RUN,
    ...options,
  })
  const frameEl = document.querySelector('iframe')
  const sent = []
  frameEl.contentWindow.postMessage = (message) => sent.push(message)
  frameEl.dispatchEvent(new Event('load'))
  const { workerApi } = await pending
  const fromFrame = (data) =>
    window.dispatchEvent(new MessageEvent('message', { data, source: frameEl.contentWindow }))
  const answer = (message, params = {}) => fromFrame({ method: RESPONSE, id: message.id, params })
  const fail = (message, name, text) => fromFrame({ method: RESPONSE, id: message.id, error: { name, message: text } })
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { workerApi, frameEl, sent, errors, jobs, terminated, fromFrame, answer, fail, flush }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('frame reload', () => {
  it('rejects the requests the old frame was holding', async () => {
    const { workerApi, frameEl, jobs, terminated } = await boot()
    const run = workerApi.jscadScript({ script: 'x' })

    frameEl.dispatchEvent(new Event('load'))

    await expect(run).rejects.toThrow(`compute frame at ${RUN} reloaded`)
    expect(jobs.at(-1)).toBe(0)
    expect(terminated).toHaveBeenCalledOnce()
  })
})

// Answer every request the frame has been sent and not yet answered, until
// nothing new arrives.
const settleAll = async (frame, params = () => ({})) => {
  const answered = new Set()
  for (let round = 0; round < 20; round++) {
    await frame.flush()
    const open = frame.sent.filter((m) => m.id && !answered.has(m.id))
    if (open.length === 0) return
    for (const m of open) {
      answered.add(m.id)
      frame.answer(m, params(m))
    }
  }
}

const methods = (sent) => sent.map((m) => m.method)

const loadModel = async (frame) => {
  const { workerApi } = frame
  const init = workerApi.jscadInit({ engine: 'manifold', useParamsProxy: true, timeoutMs: 1000 })
  const alias = workerApi.jscadInit({ alias: [{ name: 'lib', path: '/lib' }] })
  const files = workerApi.jscadSetFiles({ files: { 'a.js': 'x' } })
  const script = workerApi.jscadScript({ script: 'main', url: 'http://project.local/a.js' })
  const main = workerApi.jscadMain({ params: { size: 3 } })
  await settleAll(frame)
  await Promise.all([init, alias, files, script, main])
  frame.sent.length = 0
}

const terminate = (frame) =>
  frame.fromFrame({ method: 'frameWorkerTerminated', params: [{ reason: 'model exceeded 1000 ms' }] })

describe('worker restart', () => {
  it('replays the loaded model before the next request', async () => {
    const frame = await boot()
    await loadModel(frame)

    terminate(frame)
    const exported = frame.workerApi.jscadExportData({ format: 'stla' })
    await settleAll(frame, (m) => (m.method === 'jscadExportData' ? { data: ['solid'] } : {}))

    await expect(exported).resolves.toEqual({ data: ['solid'] })
    expect(methods(frame.sent)).toEqual([
      'jscadInit', 'jscadInit', 'jscadSetFiles', 'jscadScript', 'jscadMain', 'jscadExportData',
    ])
    expect(frame.sent[0].params[0]).toEqual({ engine: 'manifold', useParamsProxy: true, timeoutMs: 1000 })
    expect(frame.sent[1].params[0]).toEqual({ alias: [{ name: 'lib', path: '/lib' }] })
    expect(frame.sent[4].params[0]).toEqual({ params: { size: 3 } })
  })

  it('fails an export loudly after a script that did not finish', async () => {
    const frame = await boot()
    await loadModel(frame)

    const slow = frame.workerApi.jscadScript({ script: 'slow' })
    await frame.flush()
    frame.fail(frame.sent.at(-1), 'TimeoutError', 'model exceeded 1000 ms')
    await expect(slow).rejects.toThrow('model exceeded')
    frame.sent.length = 0

    terminate(frame)
    const next = frame.workerApi.jscadExportData({ format: 'stla' })
    next.catch(() => {})
    await settleAll(frame)
    await expect(next).rejects.toThrow('the model stopped and could not be reloaded')
    expect(methods(frame.sent)).toEqual(['jscadInit', 'jscadInit', 'jscadSetFiles'])
  })

  it('fails an export loudly when the replayed script fails', async () => {
    const frame = await boot()
    await loadModel(frame)

    terminate(frame)
    await frame.flush()
    for (const m of frame.sent) {
      if (m.method === 'jscadScript') frame.fail(m, 'TimeoutError', 'model exceeded 1000 ms')
      else frame.answer(m)
      await frame.flush()
    }
    await settleAll(frame)
    frame.sent.length = 0

    terminate(frame)
    const next = frame.workerApi.jscadExportData({ format: 'stla' })
    next.catch(() => {})
    await settleAll(frame)
    await expect(next).rejects.toThrow('the model stopped and could not be reloaded')
    expect(methods(frame.sent)).toEqual(['jscadInit', 'jscadInit', 'jscadSetFiles'])
  })

  it('replays after a frame reload too', async () => {
    const frame = await boot()
    await loadModel(frame)

    frame.frameEl.dispatchEvent(new Event('load'))
    const next = frame.workerApi.jscadMain({ params: { size: 4 } })
    await settleAll(frame)
    await next
    expect(methods(frame.sent)).toEqual([
      'jscadInit', 'jscadInit', 'jscadSetFiles', 'jscadScript', 'jscadMain', 'jscadMain',
    ])
  })

  it('runs again once a new script loads', async () => {
    const frame = await boot()
    await loadModel(frame)
    const slow = frame.workerApi.jscadScript({ script: 'slow' })
    await frame.flush()
    frame.fail(frame.sent.at(-1), 'TimeoutError', 'model exceeded 1000 ms')
    await expect(slow).rejects.toThrow()
    terminate(frame)
    await settleAll(frame)

    const again = frame.workerApi.jscadScript({ script: 'fixed' })
    await settleAll(frame)
    await again
    const exported = frame.workerApi.jscadExportData({ format: 'stla' })
    await settleAll(frame)
    await expect(exported).resolves.toEqual({})
  })

  it('sends requests straight through when nothing needs replaying', async () => {
    const frame = await boot()
    frame.workerApi.jscadMain({ params: {} }).catch(() => {})
    expect(methods(frame.sent)).toEqual(['jscadMain'])
  })
})
