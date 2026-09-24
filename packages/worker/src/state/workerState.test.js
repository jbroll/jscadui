import { describe, it, expect } from 'vitest'
import { WorkerState } from './workerState.js'

describe('WorkerState lastRunStreamed', () => {
  it('resets on reset()', () => {
    const state = new WorkerState()
    state.lastRunStreamed = true
    state.reset()
    expect(state.lastRunStreamed).toBe(false)
  })

  it('resets on clearGeometry(), so a failing run after a streamed one is not mistaken for streamed', () => {
    const state = new WorkerState()
    state.lastRunStreamed = true
    state.clearGeometry()
    expect(state.lastRunStreamed).toBe(false)
  })
})
