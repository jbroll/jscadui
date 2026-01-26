import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { initMessaging, messageProxy, withTransferable } from './index.js'

/**
 * Creates a mock for _self (Worker or Window) with postMessage and event listener support
 */
const createMockSelf = () => {
  const listeners = new Map()
  return {
    postMessage: vi.fn(),
    addEventListener: vi.fn((event, handler) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
    }),
    removeEventListener: vi.fn((event, handler) => {
      if (listeners.has(event)) {
        const handlers = listeners.get(event)
        const idx = handlers.indexOf(handler)
        if (idx !== -1) handlers.splice(idx, 1)
      }
    }),
    // Helper to simulate receiving a message
    simulateMessage: data => {
      const messageHandlers = listeners.get('message') || []
      messageHandlers.forEach(handler => handler({ data }))
    },
    getListeners: event => listeners.get(event) || [],
  }
}

// Note: reqMap is module-level and shared across tests
// Use messaging.getRpcJobCount() to track pending requests

describe('withTransferable', () => {
  it('should attach transferable metadata via Symbol', () => {
    const params = { data: 'test' }
    const transferable = [new ArrayBuffer(8)]

    const result = withTransferable(params, transferable)

    expect(result).toBe(params)
    expect(result[Symbol.for('__transferable__')]).toBe(transferable)
  })

  it('should work with ArrayBuffer', () => {
    const buffer = new ArrayBuffer(16)
    const params = { buffer }
    const result = withTransferable(params, [buffer])

    expect(result[Symbol.for('__transferable__')]).toEqual([buffer])
  })

  it('should work with TypedArray', () => {
    const typedArray = new Uint8Array(8)
    const params = { arr: typedArray }
    const result = withTransferable(params, [typedArray])

    expect(result[Symbol.for('__transferable__')]).toEqual([typedArray])
  })

  it('should preserve existing properties', () => {
    const params = { a: 1, b: 'test', nested: { c: 3 } }
    const result = withTransferable(params, [])

    expect(result.a).toBe(1)
    expect(result.b).toBe('test')
    expect(result.nested.c).toBe(3)
  })
})

describe('initMessaging', () => {
  let mockSelf
  let messaging

  beforeEach(() => {
    mockSelf = createMockSelf()
  })

  afterEach(() => {
    messaging?.destroy()
  })

  describe('setup and teardown', () => {
    it('should return object with expected methods', () => {
      messaging = initMessaging(mockSelf, {})

      expect(messaging).toHaveProperty('sendCmd')
      expect(messaging).toHaveProperty('sendNotify')
      expect(messaging).toHaveProperty('sendResponse')
      expect(messaging).toHaveProperty('sendError')
      expect(messaging).toHaveProperty('listener')
      expect(messaging).toHaveProperty('destroy')
      expect(messaging).toHaveProperty('getRpcJobCount')
      expect(messaging).toHaveProperty('self')
    })

    it('should add event listener to _self', () => {
      messaging = initMessaging(mockSelf, {})

      expect(mockSelf.addEventListener).toHaveBeenCalledWith('message', messaging.listener)
    })

    it('should remove event listener on destroy()', () => {
      messaging = initMessaging(mockSelf, {})
      messaging.destroy()

      expect(mockSelf.removeEventListener).toHaveBeenCalledWith('message', messaging.listener)
    })

    it('should use controller for service worker when postMessage is not on _self', () => {
      const controller = { postMessage: vi.fn() }
      const swSelf = {
        controller,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }

      messaging = initMessaging(swSelf, {})
      messaging.sendNotify('test', ['param'])

      expect(controller.postMessage).toHaveBeenCalled()
    })
  })

  describe('sendCmd - Request/Response', () => {
    it('should return a Promise', () => {
      messaging = initMessaging(mockSelf, {})

      const result = messaging.sendCmd('testMethod', ['arg1'])

      expect(result).toBeInstanceOf(Promise)
    })

    it('should send message with method, params, and id', () => {
      messaging = initMessaging(mockSelf, {})
      messaging.sendCmd('testMethod', ['arg1', 'arg2'])

      expect(mockSelf.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'testMethod',
          params: ['arg1', 'arg2'],
          id: expect.any(Number),
        }),
        [],
      )
    })

    it('should resolve when response is received', async () => {
      messaging = initMessaging(mockSelf, {})

      const promise = messaging.sendCmd('testMethod', [])
      const sentMessage = mockSelf.postMessage.mock.calls[0][0]

      // Simulate response
      mockSelf.simulateMessage({
        method: '__RESPONSE__',
        params: 'result-data',
        id: sentMessage.id,
      })

      const result = await promise
      expect(result).toBe('result-data')
    })

    it('should handle multiple concurrent requests with different IDs', async () => {
      messaging = initMessaging(mockSelf, {})

      const promise1 = messaging.sendCmd('method1', ['a'])
      const promise2 = messaging.sendCmd('method2', ['b'])
      const promise3 = messaging.sendCmd('method3', ['c'])

      const calls = mockSelf.postMessage.mock.calls
      const id1 = calls[0][0].id
      const id2 = calls[1][0].id
      const id3 = calls[2][0].id

      // Ensure IDs are unique
      expect(new Set([id1, id2, id3]).size).toBe(3)

      // Respond in reverse order
      mockSelf.simulateMessage({ method: '__RESPONSE__', params: 'result3', id: id3 })
      mockSelf.simulateMessage({ method: '__RESPONSE__', params: 'result1', id: id1 })
      mockSelf.simulateMessage({ method: '__RESPONSE__', params: 'result2', id: id2 })

      expect(await promise1).toBe('result1')
      expect(await promise2).toBe('result2')
      expect(await promise3).toBe('result3')
    })

    it('should pass transferable objects to postMessage', () => {
      messaging = initMessaging(mockSelf, {})
      const buffer = new ArrayBuffer(8)

      messaging.sendCmd('testMethod', [], [buffer])

      expect(mockSelf.postMessage).toHaveBeenCalledWith(expect.any(Object), [buffer])
    })

    it('should extract buffer from TypedArray in transferable', () => {
      messaging = initMessaging(mockSelf, {})
      const typedArray = new Uint8Array(8)

      messaging.sendCmd('testMethod', [], [typedArray])

      expect(mockSelf.postMessage).toHaveBeenCalledWith(expect.any(Object), [typedArray.buffer])
    })
  })

  describe('sendNotify - Fire and forget', () => {
    it('should send message without id', () => {
      messaging = initMessaging(mockSelf, {})
      messaging.sendNotify('notifyMethod', ['data'])

      const sentMessage = mockSelf.postMessage.mock.calls[0][0]
      expect(sentMessage.method).toBe('notifyMethod')
      expect(sentMessage.params).toEqual(['data'])
      expect(sentMessage.id).toBeUndefined()
    })

    it('should return undefined', () => {
      messaging = initMessaging(mockSelf, {})
      const result = messaging.sendNotify('notifyMethod', ['data'])

      expect(result).toBeUndefined()
    })

    it('should pass transferable objects', () => {
      messaging = initMessaging(mockSelf, {})
      const buffer = new ArrayBuffer(8)

      messaging.sendNotify('notifyMethod', [], [buffer])

      expect(mockSelf.postMessage).toHaveBeenCalledWith(expect.any(Object), [buffer])
    })
  })

  describe('sendResponse', () => {
    it('should send response with __RESPONSE__ method and id', () => {
      messaging = initMessaging(mockSelf, {})
      messaging.sendResponse({ result: 'data' }, 42)

      expect(mockSelf.postMessage).toHaveBeenCalledWith(
        {
          method: '__RESPONSE__',
          params: { result: 'data' },
          id: 42,
        },
        [],
      )
    })

    it('should extract and use transferable from result', () => {
      messaging = initMessaging(mockSelf, {})
      const buffer = new ArrayBuffer(8)
      const result = withTransferable({ data: 'test' }, [buffer])

      messaging.sendResponse(result, 42)

      expect(mockSelf.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { data: 'test' },
        }),
        [buffer],
      )
      // The transferable symbol should be removed from result
      expect(result[Symbol.for('__transferable__')]).toBeUndefined()
    })
  })

  describe('sendError', () => {
    it('should send error with serialized message, name, and stack', () => {
      messaging = initMessaging(mockSelf, {})
      const error = new Error('test error')
      error.name = 'TestError'

      messaging.sendError(error, 42)

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        method: '__RESPONSE__',
        error: {
          message: 'test error',
          name: 'TestError',
          stack: expect.any(String),
        },
        id: 42,
      })
    })
  })

  describe('timeout handling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should reject with timeout after specified delay', async () => {
      messaging = initMessaging(mockSelf, {})

      const promise = messaging.sendCmd('testMethod', [], [], 1000)

      vi.advanceTimersByTime(1001)

      await expect(promise).rejects.toBe('timeout')
    })

    it('should not timeout if response arrives in time', async () => {
      messaging = initMessaging(mockSelf, {})

      const promise = messaging.sendCmd('testMethod', [], [], 1000)
      const sentMessage = mockSelf.postMessage.mock.calls[0][0]

      vi.advanceTimersByTime(500)

      mockSelf.simulateMessage({
        method: '__RESPONSE__',
        params: 'success',
        id: sentMessage.id,
      })

      vi.advanceTimersByTime(600)

      const result = await promise
      expect(result).toBe('success')
    })

    it('should clean up from reqMap on timeout', async () => {
      messaging = initMessaging(mockSelf, {})
      const baseline = messaging.getRpcJobCount()

      const promise = messaging.sendCmd('testMethod', [], [], 1000)
      expect(messaging.getRpcJobCount()).toBe(baseline + 1)

      vi.advanceTimersByTime(1001)

      // Catch the expected rejection
      await expect(promise).rejects.toBe('timeout')

      expect(messaging.getRpcJobCount()).toBe(baseline)
    })
  })

  describe('error handling', () => {
    it('should reject promise when error response is received', async () => {
      messaging = initMessaging(mockSelf, {})

      const promise = messaging.sendCmd('testMethod', [])
      const sentMessage = mockSelf.postMessage.mock.calls[0][0]

      mockSelf.simulateMessage({
        method: '__RESPONSE__',
        error: {
          message: 'Handler error',
          name: 'HandlerError',
          stack: 'Error: Handler error\n    at handler.js:10',
        },
        id: sentMessage.id,
      })

      await expect(promise).rejects.toThrow('Handler error')

      try {
        await promise
      } catch (e) {
        expect(e.name).toBe('HandlerError')
        expect(e.stack).toContain('handler.js')
      }
    })

    it('should serialize error when handler throws', async () => {
      const handlers = {
        failingMethod: () => {
          throw new Error('Handler failed')
        },
      }
      messaging = initMessaging(mockSelf, handlers)

      mockSelf.simulateMessage({
        method: 'failingMethod',
        params: [],
        id: 99,
      })

      // Wait for async handler processing
      await vi.waitFor(() => {
        expect(mockSelf.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            method: '__RESPONSE__',
            error: expect.objectContaining({
              message: 'Handler failed',
            }),
            id: 99,
          }),
        )
      })
    })
  })

  describe('handler invocation', () => {
    it('should call handler with params when message received', async () => {
      const handler = vi.fn().mockResolvedValue('handler-result')
      const handlers = { testHandler: handler }
      messaging = initMessaging(mockSelf, handlers)

      mockSelf.simulateMessage({
        method: 'testHandler',
        params: ['arg1', 'arg2'],
        id: 1,
      })

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledWith('arg1', 'arg2')
      })
    })

    it('should send response when handler returns value', async () => {
      const handlers = {
        testHandler: async () => 'handler-result',
      }
      messaging = initMessaging(mockSelf, handlers)

      mockSelf.simulateMessage({
        method: 'testHandler',
        params: [],
        id: 1,
      })

      await vi.waitFor(() => {
        expect(mockSelf.postMessage).toHaveBeenCalledWith(
          {
            method: '__RESPONSE__',
            params: 'handler-result',
            id: 1,
          },
          [],
        )
      })
    })

    it('should not send response for notification (no id)', async () => {
      const handler = vi.fn().mockResolvedValue('result')
      const handlers = { notifyHandler: handler }
      messaging = initMessaging(mockSelf, handlers)

      mockSelf.simulateMessage({
        method: 'notifyHandler',
        params: ['data'],
        // no id
      })

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled()
      })

      // Should not have sent a response
      expect(mockSelf.postMessage).not.toHaveBeenCalled()
    })

    it('should handle handler returning undefined', async () => {
      const handlers = {
        voidHandler: () => undefined,
      }
      messaging = initMessaging(mockSelf, handlers)

      mockSelf.simulateMessage({
        method: 'voidHandler',
        params: [],
        id: 1,
      })

      await vi.waitFor(() => {
        expect(mockSelf.postMessage).toHaveBeenCalledWith(
          {
            method: '__RESPONSE__',
            params: undefined,
            id: 1,
          },
          [],
        )
      })
    })

    it('should handle handler returning null', async () => {
      const handlers = {
        nullHandler: () => null,
      }
      messaging = initMessaging(mockSelf, handlers)

      mockSelf.simulateMessage({
        method: 'nullHandler',
        params: [],
        id: 1,
      })

      await vi.waitFor(() => {
        expect(mockSelf.postMessage).toHaveBeenCalledWith(
          {
            method: '__RESPONSE__',
            params: null,
            id: 1,
          },
          [],
        )
      })
    })

    it('should throw error when handler not found', async () => {
      messaging = initMessaging(mockSelf, {})
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // The listener throws an error when method is not found.
      // We need to catch this by wrapping the call
      try {
        await messaging.listener({
          data: {
            method: 'unknownMethod',
            params: [],
          },
        })
      } catch (e) {
        expect(e.message).toContain('no handler for type')
      }

      // The error is thrown inside the listener which logs to console
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('job tracking', () => {
    it('should call onJobCount callback on request', () => {
      const onJobCount = vi.fn()
      messaging = initMessaging(mockSelf, {}, { onJobCount })
      const baseline = messaging.getRpcJobCount()

      messaging.sendCmd('method1', [])
      expect(onJobCount).toHaveBeenCalledWith(baseline + 1)

      messaging.sendCmd('method2', [])
      expect(onJobCount).toHaveBeenCalledWith(baseline + 2)

      // Clean up pending requests to avoid unhandled rejections
      const calls = mockSelf.postMessage.mock.calls
      calls.forEach(call => {
        mockSelf.simulateMessage({
          method: '__RESPONSE__',
          params: 'cleanup',
          id: call[0].id,
        })
      })
    })

    it('should call onJobCount callback on response', async () => {
      const onJobCount = vi.fn()
      messaging = initMessaging(mockSelf, {}, { onJobCount })
      const baseline = messaging.getRpcJobCount()

      messaging.sendCmd('method1', [])
      const id = mockSelf.postMessage.mock.calls[0][0].id

      onJobCount.mockClear()

      mockSelf.simulateMessage({
        method: '__RESPONSE__',
        params: 'result',
        id,
      })

      expect(onJobCount).toHaveBeenCalledWith(baseline)
    })

    it('should call onJobCount callback on timeout', async () => {
      vi.useFakeTimers()
      const onJobCount = vi.fn()
      messaging = initMessaging(mockSelf, {}, { onJobCount })
      const baseline = messaging.getRpcJobCount()

      const promise = messaging.sendCmd('method1', [], [], 100)

      onJobCount.mockClear()
      vi.advanceTimersByTime(101)

      expect(onJobCount).toHaveBeenCalledWith(baseline)
      vi.useRealTimers()

      // Catch the expected rejection
      await expect(promise).rejects.toBe('timeout')
    })

    it('should return correct pending count via getRpcJobCount()', () => {
      messaging = initMessaging(mockSelf, {})
      const baseline = messaging.getRpcJobCount()

      messaging.sendCmd('method1', [])
      expect(messaging.getRpcJobCount()).toBe(baseline + 1)

      messaging.sendCmd('method2', [])
      expect(messaging.getRpcJobCount()).toBe(baseline + 2)

      const id = mockSelf.postMessage.mock.calls[0][0].id
      mockSelf.simulateMessage({
        method: '__RESPONSE__',
        params: 'result',
        id,
      })

      expect(messaging.getRpcJobCount()).toBe(baseline + 1)

      // Clean up remaining request
      const id2 = mockSelf.postMessage.mock.calls[1][0].id
      mockSelf.simulateMessage({
        method: '__RESPONSE__',
        params: 'result',
        id: id2,
      })
    })
  })

  describe('edge cases', () => {
    it('should ignore response for unknown ID', () => {
      messaging = initMessaging(mockSelf, {})
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockSelf.simulateMessage({
        method: '__RESPONSE__',
        params: 'orphan-result',
        id: 99999,
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      )
      consoleSpy.mockRestore()
    })

    it('should handle debug option', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      messaging = initMessaging(mockSelf, {}, { debug: '[TEST]' })

      messaging.sendCmd('testMethod', [])

      expect(consoleSpy).toHaveBeenCalledWith('[TEST]', 'sendCmd', expect.any(Number), 'testMethod', [])
      consoleSpy.mockRestore()
    })
  })
})

describe('messageProxy', () => {
  let mockSelf
  let proxy

  beforeEach(() => {
    mockSelf = createMockSelf()
  })

  afterEach(() => {
    proxy?.destroy()
  })

  describe('proxy creation', () => {
    it('should return a Proxy object', () => {
      proxy = messageProxy(mockSelf, {})

      expect(proxy).toBeDefined()
      expect(typeof proxy).toBe('object')
    })

    it('should expose getRpcJobCount()', () => {
      proxy = messageProxy(mockSelf, {})

      expect(typeof proxy.getRpcJobCount).toBe('function')
      // Note: reqMap is shared at module level, so we just verify it returns a number
      expect(typeof proxy.getRpcJobCount()).toBe('number')
    })

    it('should expose destroy()', () => {
      proxy = messageProxy(mockSelf, {})

      expect(typeof proxy.destroy).toBe('function')
    })

    it('should expose onmessage listener', () => {
      proxy = messageProxy(mockSelf, {})

      expect(typeof proxy.onmessage).toBe('function')
    })
  })

  describe('method call routing', () => {
    it('should route method calls to sendCmd', async () => {
      proxy = messageProxy(mockSelf, {})

      proxy.someMethod('arg1', 'arg2')

      expect(mockSelf.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'someMethod',
          params: ['arg1', 'arg2'],
          id: expect.any(Number),
        }),
        [],
      )
    })

    it('should return Promise from method call', () => {
      proxy = messageProxy(mockSelf, {})

      const result = proxy.testMethod()

      expect(result).toBeInstanceOf(Promise)
    })

    it('should cache created methods', () => {
      proxy = messageProxy(mockSelf, {})

      const method1 = proxy.testMethod
      const method2 = proxy.testMethod

      expect(method1).toBe(method2)
    })
  })

  describe('on* methods (notifications)', () => {
    it('should route on* methods to sendNotify (fire-and-forget)', () => {
      proxy = messageProxy(mockSelf, {})

      proxy.onProgress('50%')

      const sentMessage = mockSelf.postMessage.mock.calls[0][0]
      expect(sentMessage.method).toBe('onProgress')
      expect(sentMessage.params).toEqual(['50%'])
      expect(sentMessage.id).toBeUndefined()
    })

    it('should recognize onX pattern (capital letter after on)', () => {
      proxy = messageProxy(mockSelf, {})

      proxy.onSomething('data')

      const sentMessage = mockSelf.postMessage.mock.calls[0][0]
      expect(sentMessage.id).toBeUndefined()
    })

    it('should recognize on pattern (two letters)', () => {
      proxy = messageProxy(mockSelf, {})

      proxy.on('event', 'data')

      const sentMessage = mockSelf.postMessage.mock.calls[0][0]
      expect(sentMessage.method).toBe('on')
      expect(sentMessage.id).toBeUndefined()
    })

    it('should NOT treat lowercase third char as notification', () => {
      proxy = messageProxy(mockSelf, {})

      proxy.onclick('element')

      const sentMessage = mockSelf.postMessage.mock.calls[0][0]
      // lowercase 'c' after 'on' means it's NOT a notification pattern
      expect(sentMessage.id).toBeDefined()
    })
  })

  describe('then property blocking', () => {
    it('should return undefined for then property', () => {
      proxy = messageProxy(mockSelf, {})

      expect(proxy.then).toBeUndefined()
    })

    it('should allow proxy to be used with async/await', async () => {
      proxy = messageProxy(mockSelf, {})

      // This should not throw - proxy should not be treated as a thenable
      const result = await Promise.resolve(proxy)
      expect(result).toBe(proxy)
    })
  })

  describe('integration with initMessaging', () => {
    it('should resolve when response received', async () => {
      proxy = messageProxy(mockSelf, {})

      const promise = proxy.compute(10, 20)
      const sentMessage = mockSelf.postMessage.mock.calls[0][0]

      mockSelf.simulateMessage({
        method: '__RESPONSE__',
        params: 30,
        id: sentMessage.id,
      })

      const result = await promise
      expect(result).toBe(30)
    })

    it('should handle incoming messages via handlers', async () => {
      const handler = vi.fn().mockResolvedValue('handled')
      proxy = messageProxy(mockSelf, { incomingMethod: handler })

      mockSelf.simulateMessage({
        method: 'incomingMethod',
        params: ['incoming-data'],
        id: 1,
      })

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledWith('incoming-data')
      })
    })

    it('should call onJobCount when configured', () => {
      const onJobCount = vi.fn()
      proxy = messageProxy(mockSelf, {}, { onJobCount })
      const baseline = proxy.getRpcJobCount()

      proxy.testMethod()

      expect(onJobCount).toHaveBeenCalledWith(baseline + 1)

      // Clean up pending request
      const id = mockSelf.postMessage.mock.calls[0][0].id
      mockSelf.simulateMessage({
        method: '__RESPONSE__',
        params: 'cleanup',
        id,
      })
    })
  })

  describe('debug option', () => {
    it('should pass debug option to initMessaging', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      proxy = messageProxy(mockSelf, {}, { debug: '[PROXY]' })

      proxy.testMethod('arg')

      expect(consoleSpy).toHaveBeenCalledWith('[PROXY]', 'sendCmd', expect.any(Number), 'testMethod', ['arg'])
      consoleSpy.mockRestore()
    })
  })
})

describe('cross-instance behavior', () => {
  it('should maintain separate state for different initMessaging instances', () => {
    const mockSelf1 = createMockSelf()
    const mockSelf2 = createMockSelf()

    const messaging1 = initMessaging(mockSelf1, {})
    const messaging2 = initMessaging(mockSelf2, {})

    messaging1.sendCmd('method1', [])
    messaging2.sendCmd('method2', [])

    // Each should have sent to their respective mock
    expect(mockSelf1.postMessage).toHaveBeenCalledTimes(1)
    expect(mockSelf2.postMessage).toHaveBeenCalledTimes(1)

    expect(mockSelf1.postMessage.mock.calls[0][0].method).toBe('method1')
    expect(mockSelf2.postMessage.mock.calls[0][0].method).toBe('method2')

    messaging1.destroy()
    messaging2.destroy()
  })

  it('should use incrementing IDs across all instances (shared sequence)', () => {
    const mockSelf1 = createMockSelf()
    const mockSelf2 = createMockSelf()

    const messaging1 = initMessaging(mockSelf1, {})
    const messaging2 = initMessaging(mockSelf2, {})

    messaging1.sendCmd('method1', [])
    const id1 = mockSelf1.postMessage.mock.calls[0][0].id

    messaging2.sendCmd('method2', [])
    const id2 = mockSelf2.postMessage.mock.calls[0][0].id

    // IDs should be different (incrementing from shared seq)
    expect(id2).toBeGreaterThan(id1)

    messaging1.destroy()
    messaging2.destroy()
  })
})

describe('transferable extraction', () => {
  let mockSelf
  let messaging

  beforeEach(() => {
    mockSelf = createMockSelf()
    messaging = initMessaging(mockSelf, {})
  })

  afterEach(() => {
    messaging?.destroy()
  })

  it('should extract buffer from TypedArray for sendCmd', () => {
    const float32 = new Float32Array([1, 2, 3, 4])
    messaging.sendCmd('test', [], [float32])

    expect(mockSelf.postMessage).toHaveBeenCalledWith(expect.any(Object), [float32.buffer])
  })

  it('should extract buffer from TypedArray for sendNotify', () => {
    const uint8 = new Uint8Array([1, 2, 3])
    messaging.sendNotify('test', [], [uint8])

    expect(mockSelf.postMessage).toHaveBeenCalledWith(expect.any(Object), [uint8.buffer])
  })

  it('should pass ArrayBuffer directly', () => {
    const buffer = new ArrayBuffer(16)
    messaging.sendCmd('test', [], [buffer])

    expect(mockSelf.postMessage).toHaveBeenCalledWith(expect.any(Object), [buffer])
  })

  it('should handle mixed transferables', () => {
    const buffer = new ArrayBuffer(8)
    const uint8 = new Uint8Array(4)

    messaging.sendCmd('test', [], [buffer, uint8])

    expect(mockSelf.postMessage).toHaveBeenCalledWith(expect.any(Object), [buffer, uint8.buffer])
  })

  it('should handle empty transferable array', () => {
    messaging.sendCmd('test', [], [])

    expect(mockSelf.postMessage).toHaveBeenCalledWith(expect.any(Object), [])
  })

  it('should handle undefined transferable', () => {
    messaging.sendCmd('test', [], undefined)

    expect(mockSelf.postMessage).toHaveBeenCalledWith(expect.any(Object), [])
  })
})
