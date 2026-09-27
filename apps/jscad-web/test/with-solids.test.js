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
      expect(args).toEqual({ params: { foo: 'bar' }, stream: false, solidsOnly: true })
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

  it('serializes two concurrent re-runs so they share no progress or solids', async () => {
    const events = []
    const deferred = () => {
      let resolve
      const promise = new Promise((r) => { resolve = r })
      return { promise, resolve }
    }
    const gateA = deferred()
    // Both re-runs share the worker's globals, like the real frame worker.
    let solids = []
    const deps = (name, gate) => ({
      lastRunStreamed: () => true,
      postProgress: () => events.push(`${name}:progress`),
      releaseSolids: () => { events.push(`${name}:release`); solids = [] },
      currentParams: () => ({ run: name }),
      jscadMain: async ({ params }) => {
        events.push(`${name}:main-start`)
        await gate.promise
        events.push(`${name}:main-end`)
        solids = [`${params.run}-solids`]
      },
      currentSolids: () => solids,
    })
    const withA = createWithSolids(deps('a', gateA))
    const gateB = deferred()
    const withB = createWithSolids(deps('b', gateB))
    const runA = withA((s) => { events.push(`a:use:${s}`); return s })
    const runB = withB((s) => { events.push(`b:use:${s}`); return s })
    // Let both start, then let A's main finish while B waits for the lock.
    await Promise.resolve()
    await Promise.resolve()
    gateA.resolve()
    const [solidsA, solidsB] = await Promise.all([runA, (async () => { gateB.resolve(); return runB })()])
    expect(solidsA).toEqual(['a-solids'])
    expect(solidsB).toEqual(['b-solids'])
    expect(events.indexOf('b:main-start')).toBeGreaterThan(events.indexOf('a:release'))
  })

  it('lets a later re-run proceed after an earlier one fails', async () => {
    let calls = 0
    const withSolids = createWithSolids({
      lastRunStreamed: () => true,
      postProgress: () => {},
      releaseSolids: () => {},
      currentParams: () => ({}),
      jscadMain: async () => { if (++calls === 1) throw new Error('boom') },
      currentSolids: () => [`solids-${calls}`],
    })
    await expect(withSolids((s) => s)).rejects.toThrow('boom')
    await expect(withSolids((s) => s)).resolves.toEqual(['solids-2'])
  })
})
