import { describe, it, expect, afterEach } from 'vitest'
import { createWithSolids } from '../src_frame/withSolids.js'

describe('createWithSolids', () => {
  afterEach(() => {
    delete globalThis.__jscadProgress
  })

  it('uses the current solids without re-running when the last run was not streamed', async () => {
    const jscadMain = () => { throw new Error('should not re-run') }
    const withSolids = createWithSolids({
      lastRunStreamed: () => false,
      postProgress: () => {},
      releaseSolids: () => { throw new Error('should not release') },
      currentParams: () => ({}),
      jscadMain,
      currentSolids: () => ['solid-a'],
    })
    const result = await withSolids((solids) => solids)
    expect(result).toEqual(['solid-a'])
    expect(globalThis.__jscadProgress).toBeUndefined()
  })

  it('re-runs the grid without streaming, wires progress, and releases solids after', async () => {
    let released = false
    let progressDuringRun = null
    const currentParams = () => ({ foo: 'bar' })
    const jscadMain = async (args) => {
      expect(args).toEqual({ params: { foo: 'bar' }, stream: false })
      progressDuringRun = globalThis.__jscadProgress
    }
    const withSolids = createWithSolids({
      lastRunStreamed: () => true,
      postProgress: () => 'progress',
      releaseSolids: () => { released = true },
      currentParams,
      jscadMain,
      currentSolids: () => ['solid-b'],
    })
    const result = await withSolids((solids) => solids)
    expect(typeof progressDuringRun).toBe('function')
    expect(progressDuringRun()).toBe('progress')
    expect(result).toEqual(['solid-b'])
    expect(released).toBe(true)
    expect(globalThis.__jscadProgress).toBe(null)
  })

  it('releases solids and clears progress even when the run fails', async () => {
    let released = false
    const withSolids = createWithSolids({
      lastRunStreamed: () => true,
      postProgress: () => {},
      releaseSolids: () => { released = true },
      currentParams: () => ({}),
      jscadMain: async () => { throw new Error('boom') },
      currentSolids: () => ['solid-c'],
    })
    await expect(withSolids((solids) => solids)).rejects.toThrow('boom')
    expect(released).toBe(true)
    expect(globalThis.__jscadProgress).toBe(null)
  })
})
