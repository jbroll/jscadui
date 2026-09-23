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
