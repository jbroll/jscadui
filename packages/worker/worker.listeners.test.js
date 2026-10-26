import { afterEach, describe, expect, it, vi } from 'vitest'

const listeners = {}
globalThis.self = { addEventListener: (type, fn) => (listeners[type] = fn), postMessage: () => {} }

await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

describe('the worker error listeners', () => {
  afterEach(() => {
    workerState.solids = []
    vi.restoreAllMocks()
  })

  it('keeps the model when a stray rejection or error reaches the worker', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const marker = [{ id: 'loaded-solid' }]
    workerState.solids = marker

    listeners.unhandledrejection({ reason: new Error('x') })
    listeners.error({ error: new Error('y') })

    expect(workerState.solids).toBe(marker)
  })
})
