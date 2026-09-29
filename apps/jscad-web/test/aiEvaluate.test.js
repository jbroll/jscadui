import { describe, expect, it, vi } from 'vitest'
import index from '@jscadui/agent-loop/api/index.json'
import { createEvaluate } from '../src/aiEvaluate.js'

const workerApi = (jscadScript) => ({
  jscadSetFiles: vi.fn(async () => {}),
  jscadScript: vi.fn(jscadScript),
})

describe('createEvaluate', () => {
  it('answers a scratch run (no main) without drawing or checking caps, current model untouched', async () => {
    const api = workerApi(async () => ({
      scratch: true,
      console: ['expected volume 42'],
      message: 'no main(): nothing rendered, current model unchanged',
    }))
    const handleEntities = vi.fn()
    const res = await createEvaluate(api, handleEntities)('console.log(1)', 'main.js')
    expect(res).toEqual({
      ok: true,
      scratch: true,
      console: ['expected volume 42'],
      message: 'no main(): nothing rendered, current model unchanged',
    })
    expect(handleEntities).not.toHaveBeenCalled()
  })

  it('omits console from a scratch answer when the run logged nothing', async () => {
    const api = workerApi(async () => ({ scratch: true, console: [], message: 'no main(): nothing rendered, current model unchanged' }))
    const res = await createEvaluate(api, vi.fn())('1', 'main.js')
    expect(res).not.toHaveProperty('console')
  })

  it('still draws and answers the entity count for a normal script', async () => {
    const api = workerApi(async () => ({ entities: [{}] }))
    const handleEntities = vi.fn()
    const res = await createEvaluate(api, handleEntities)('module.exports = { main: () => [] }', 'main.js')
    expect(res).toEqual({ entityCount: 1 })
    expect(handleEntities).toHaveBeenCalledOnce()
  })

  it('loads the API index only to hint an error', async () => {
    const loadIndex = vi.fn(async () => index)
    const ok = workerApi(async () => ({ entities: [{}] }))
    await createEvaluate(ok, vi.fn(), () => 'fluent', loadIndex)('1', 'main.js')
    expect(loadIndex).not.toHaveBeenCalled()
    const failing = workerApi(async () => {
      throw new TypeError('jf.measureVolume is not a function')
    })
    const res = await createEvaluate(failing, vi.fn(), () => 'fluent', loadIndex)('1', 'main.js')
    expect(res.error.message).toContain('measureVolume is a method of FluentGeom3')
  })

  it('still answers the error when the index cannot load', async () => {
    const failing = workerApi(async () => {
      throw new TypeError('jf.measureVolume is not a function')
    })
    const res = await createEvaluate(failing, vi.fn(), () => 'fluent', async () => {
      throw new Error('offline')
    })('1', 'main.js')
    expect(res).toEqual({ ok: false, error: { name: 'TypeError', message: 'jf.measureVolume is not a function' } })
  })
})
