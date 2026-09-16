import { describe, it, expect, vi } from 'vitest'

import { messageProxy } from '../index.js'

const createTarget = origin => {
  const listeners = []
  const target = {
    origin,
    peer: null,
    postMessage: vi.fn(data => target.peer?.receive(data, target.origin)),
    addEventListener: vi.fn((event, handler) => {
      if (event === 'message') listeners.push(handler)
    }),
    removeEventListener: vi.fn((event, handler) => {
      const idx = listeners.indexOf(handler)
      if (idx !== -1) listeners.splice(idx, 1)
    }),
    receive: (data, fromOrigin) => {
      for (const handler of listeners) handler({ data, origin: fromOrigin })
    },
  }
  return target
}

const createPair = (appOrigin, senderOrigin) => {
  const app = createTarget(appOrigin)
  const sender = createTarget(senderOrigin)
  app.peer = sender
  sender.peer = app
  return { app, sender }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('messageProxy allowedOrigin', () => {
  it('ignores a message from a different origin without calling the handler or responding', async () => {
    const { app, sender } = createPair('https://app.test', 'https://evil.test')
    let called = 0
    const proxy = messageProxy(
      app,
      {
        run: async () => {
          called++
          return 'ok'
        },
      },
      { allowedOrigin: 'https://app.test' },
    )

    sender.postMessage({ method: 'run', params: [], id: 1 })
    await flush()

    expect(called).toBe(0)
    expect(app.postMessage).not.toHaveBeenCalled()
    proxy.destroy()
  })

  it('handles a message from the allowed origin', async () => {
    const { app, sender } = createPair('https://app.test', 'https://app.test')
    let called = 0
    const proxy = messageProxy(
      app,
      {
        run: async () => {
          called++
          return 'ok'
        },
      },
      { allowedOrigin: 'https://app.test' },
    )

    sender.postMessage({ method: 'run', params: [], id: 1 })
    await flush()

    expect(called).toBe(1)
    expect(app.postMessage).toHaveBeenCalledWith({ method: '__RESPONSE__', params: 'ok', id: 1 }, [])
    proxy.destroy()
  })
})
