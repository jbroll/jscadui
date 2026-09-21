import { describe, it, expect, afterEach, vi } from 'vitest'
import { createFrame } from './frameSetup.js'

const RUN = 'http://localhost:5121'

// The frame is a DOM object and a postMessage peer, neither of which the node
// test environment has. Only what createFrame and framePort touch is faked.
const fakeDom = () => {
  let fireLoad
  const el = {
    src: '',
    hidden: false,
    contentWindow: { postMessage: vi.fn() },
    setAttribute: vi.fn(),
    addEventListener: (type, fn) => { if (type === 'load') fireLoad = fn },
    removeEventListener: () => {},
    remove: () => {},
  }
  globalThis.document = { createElement: () => el, body: { appendChild: () => {} } }
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} }
  return { el, load: () => fireLoad() }
}

const build = (overrides = {}) => createFrame({
  onError: () => {},
  onProgress: () => {},
  onEntities: () => {},
  onJobCount: () => {},
  runOrigin: RUN,
  loadTimeoutMs: 20,
  ...overrides,
})

afterEach(() => {
  delete globalThis.document
  delete globalThis.window
})

describe('createFrame', () => {
  it('reports a frame that never loads instead of waiting on it', async () => {
    fakeDom()
    const errors = []
    await build({ onError: (err) => errors.push(err) })

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('did not load')
    expect(errors[0].message).toContain(RUN)
  })

  it('fails a call against a frame that never loaded rather than hanging', async () => {
    const { el } = fakeDom()
    const { workerApi } = await build()

    const started = Date.now()
    await expect(workerApi.jscadInit({ engine: 'jscad' })).rejects.toThrow(/did not load/)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(el.contentWindow.postMessage).not.toHaveBeenCalled()
  })

  it('sandboxes the frame without allow-same-origin', async () => {
    const { el, load } = fakeDom()
    const framePromise = build()
    load()
    const { workerApi } = await framePromise

    const sandbox = el.setAttribute.mock.calls.filter(([name]) => name === 'sandbox')
    expect(sandbox).toEqual([['sandbox', 'allow-scripts']])
    workerApi.destroy()
  })

  it('relays once the frame loads', async () => {
    const { el, load } = fakeDom()
    const framePromise = build()
    load()
    const { workerApi } = await framePromise

    const pending = workerApi.jscadInit({ engine: 'jscad' })
    pending.catch(() => {})
    expect(el.contentWindow.postMessage).toHaveBeenCalled()
    workerApi.destroy()
  })
})
