import { describe, it, expect, vi } from 'vitest'
import { sealMessageListeners } from '../src_frame/sealMessages.js'

// A stand-in for EventTarget -> WorkerGlobalScope, so the real EventTarget
// prototype in the test process stays untouched.
const makeScope = () => {
  class Target {
    constructor() { this.listeners = [] }
    addEventListener(type, fn) { this.listeners.push([type, fn]) }
    dispatch(type, event) {
      for (const [t, fn] of this.listeners) if (t === type) fn(event)
      if (type === 'message') this._onmessage?.(event)
    }
  }
  class Scope extends Target {}
  Object.defineProperty(Scope.prototype, 'onmessage', {
    get() { return this._onmessage ?? null },
    set(fn) { this._onmessage = fn },
    configurable: true,
  })
  return { Target, Scope, scope: new Scope() }
}

describe('sealMessageListeners', () => {
  it('keeps the listener attached before sealing', () => {
    const { scope } = makeScope()
    const own = vi.fn()
    scope.addEventListener('message', own)
    sealMessageListeners(scope)
    scope.dispatch('message', { data: 1 })
    expect(own).toHaveBeenCalledOnce()
  })

  it('ignores a message listener added afterwards, however it is called', () => {
    const { Target, scope } = makeScope()
    sealMessageListeners(scope)
    const spy = vi.fn()
    scope.addEventListener('message', spy)
    Target.prototype.addEventListener.call(scope, 'message', spy)
    scope.onmessage = spy
    scope.dispatch('message', { data: 1 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('cannot be undone', () => {
    const { Target, Scope, scope } = makeScope()
    sealMessageListeners(scope)
    expect(() => Object.defineProperty(Target.prototype, 'addEventListener', { value: () => {} })).toThrow(TypeError)
    expect(() => Object.defineProperty(Scope.prototype, 'onmessage', { set: () => {} })).toThrow(TypeError)
  })

  it('leaves other event types and other targets alone', () => {
    const { Scope, scope } = makeScope()
    sealMessageListeners(scope)
    const onError = vi.fn()
    scope.addEventListener('error', onError)
    scope.dispatch('error', {})
    expect(onError).toHaveBeenCalledOnce()

    const other = new Scope()
    const onMessage = vi.fn()
    other.addEventListener('message', onMessage)
    other.dispatch('message', {})
    expect(onMessage).toHaveBeenCalledOnce()
  })
})
