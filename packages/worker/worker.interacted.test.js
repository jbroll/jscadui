import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.self = { addEventListener() {}, postMessage: vi.fn() }

const { jscadMain } = await import('./worker.js')
const { workerState } = await import('./src/state/workerState.js')

describe('jscadMain user-set params', () => {
  let seen
  beforeEach(() => {
    workerState.reset()
    workerState.useParamsProxy = true
    seen = []
    workerState.main = (params) => {
      params.size = { type: 'number', default: 20 }
      seen.push(params.size)
      return []
    }
  })

  afterEach(() => workerState.reset())

  it('a re-run without userInteractedPaths keeps the values the last run set, as the solids re-run of a streamed model does', async () => {
    await jscadMain({ params: { size: 40 }, userInteractedPaths: ['size'], stream: false })
    await jscadMain({ params: { size: 40 }, stream: false, solidsOnly: true })
    expect(seen).toEqual([40, 40])
  })

  it('drops a user-set path the model no longer declares', async () => {
    await jscadMain({ params: { size: 40, gone: 1 }, userInteractedPaths: ['size', 'gone'], stream: false })
    expect([...workerState.userInteracted]).toEqual(['size'])
  })
})
