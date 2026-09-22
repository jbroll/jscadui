import { describe, it, expect, vi } from 'vitest'

import { initMessaging } from '../index.js'

const RESPONSE = '__RESPONSE__'

const createTarget = () => {
  const listeners = []
  return {
    postMessage: vi.fn(),
    addEventListener: (type, handler) => { if (type === 'message') listeners.push(handler) },
    removeEventListener: (event, handler) => {
      const idx = listeners.indexOf(handler)
      if (idx !== -1) listeners.splice(idx, 1)
    },
    receive: data => { for (const handler of listeners) handler({ data }) },
  }
}

const idOfLastSend = target => target.postMessage.mock.calls.at(-1)[0].id

describe('per-endpoint reqMap', () => {
  it('does not resolve one endpoint request from another endpoint response', async () => {
    const a = createTarget()
    const b = createTarget()
    const mA = initMessaging(a, {})
    const mB = initMessaging(b, {})

    const pending = mA.sendCmd('work')
    const id = idOfLastSend(a)

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    b.receive({ method: RESPONSE, id, params: 'stolen' })
    expect(error).toHaveBeenCalledWith(expect.stringContaining(`req ${id} not found`), id, expect.anything(), expect.anything())
    error.mockRestore()

    expect(mA.getRpcJobCount()).toBe(1)
    a.receive({ method: RESPONSE, id, params: 'mine' })
    await expect(pending).resolves.toBe('mine')

    mA.destroy()
    mB.destroy()
  })

  it('counts jobs per endpoint', () => {
    const a = createTarget()
    const b = createTarget()
    const mA = initMessaging(a, {})
    const mB = initMessaging(b, {})

    const settled = [mA.sendCmd('one'), mA.sendCmd('two'), mB.sendCmd('three')]
    settled.forEach(p => p.catch(() => {}))

    expect(mA.getRpcJobCount()).toBe(2)
    expect(mB.getRpcJobCount()).toBe(1)

    mA.destroy()
    expect(mA.getRpcJobCount()).toBe(0)
    expect(mB.getRpcJobCount()).toBe(1)
    mB.destroy()
  })

  it('reports job counts to its own onJobCount only', () => {
    const a = createTarget()
    const b = createTarget()
    const countsA = []
    const countsB = []
    const mA = initMessaging(a, {}, { onJobCount: n => countsA.push(n) })
    const mB = initMessaging(b, {}, { onJobCount: n => countsB.push(n) })

    mA.sendCmd('one').catch(() => {})
    expect(countsA).toEqual([1])
    expect(countsB).toEqual([])

    mA.destroy()
    mB.destroy()
  })
})

describe('unknown method', () => {
  it('answers a request with an error instead of leaving it pending', async () => {
    const target = createTarget()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const messaging = initMessaging(target, { known: () => 1 })

    await messaging.listener({ data: { method: 'nosuch', params: [], id: 7 } })

    expect(target.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: RESPONSE, id: 7, error: expect.objectContaining({ message: 'no handler for type: nosuch' }) }),
    )
    error.mockRestore()
    messaging.destroy()
  })

  it('does not answer a notification with an unknown method', async () => {
    const target = createTarget()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const messaging = initMessaging(target, {})

    await messaging.listener({ data: { method: 'nosuch', params: [] } })

    expect(target.postMessage).not.toHaveBeenCalled()
    error.mockRestore()
    messaging.destroy()
  })
})
