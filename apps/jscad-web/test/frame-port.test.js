import { describe, it, expect, vi } from 'vitest'
import { framePort } from '../src/framePort.js'

const fakeIframe = () => {
  const contentWindow = { postMessage: vi.fn() }
  return { contentWindow, src: 'https://jscad-run.rkroll.com/' }
}

describe('framePort', () => {
  it('posts to the frame window with the transfer list', () => {
    const iframe = fakeIframe()
    const port = framePort(iframe, 'https://jscad-run.rkroll.com', {
      addEventListener: () => {},
      removeEventListener: () => {},
    })
    const buffer = new ArrayBuffer(8)
    port.postMessage({ method: 'jscadMain', id: 1, params: [] }, [buffer])
    // A sandboxed frame's origin is opaque, so no explicit targetOrigin matches.
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledWith(
      { method: 'jscadMain', id: 1, params: [] },
      '*',
      [buffer],
    )
  })

  it('delivers only messages whose source is the frame window', () => {
    const iframe = fakeIframe()
    let hostListener
    const port = framePort(iframe, 'https://jscad-run.rkroll.com', {
      addEventListener: (type, fn) => { hostListener = fn },
      removeEventListener: () => {},
    })
    const seen = []
    port.addEventListener('message', (event) => seen.push(event.data))
    hostListener({ source: iframe.contentWindow, data: { method: '__RESPONSE__', id: 1 } })
    hostListener({ source: { other: true }, data: { method: '__RESPONSE__', id: 2 } })
    expect(seen).toEqual([{ method: '__RESPONSE__', id: 1 }])
  })

  it('stops delivering after the listener is removed', () => {
    const iframe = fakeIframe()
    let hostListener
    const removed = []
    const port = framePort(iframe, 'https://jscad-run.rkroll.com', {
      addEventListener: (type, fn) => { hostListener = fn },
      removeEventListener: (type, fn) => removed.push(fn),
    })
    const fn = () => {}
    port.addEventListener('message', fn)
    port.removeEventListener('message', fn)
    expect(removed).toEqual([hostListener])
  })

  it('refuses an iframe whose src does not match the run origin', () => {
    const iframe = fakeIframe()
    const host = { addEventListener: () => {}, removeEventListener: () => {} }
    expect(() => framePort(iframe, 'https://elsewhere.example', host)).toThrowError(/does not match origin/)
  })
})
