// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initParamsController, runModelUpdate } from '../src/paramsUI.js'

const deps = (jscadMain, extra = {}) => ({
  workerApi: { jscadMain },
  handleEntities: vi.fn(),
  setError: vi.fn(),
  stopCurrentAnim: () => false,
  ...extra,
})

describe('runModelUpdate', () => {
  beforeEach(() => {
    initParamsController()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('begins a run before jscadMain is sent', async () => {
    const order = []
    const jscadMain = vi.fn(async () => { order.push('main'); return { entities: [] } })
    const d = deps(jscadMain, { beginRun: () => order.push('begin'), endRun: () => order.push('end') })
    await runModelUpdate(d)
    expect(order).toEqual(['begin', 'main'])
    expect(d.handleEntities).toHaveBeenCalledOnce()
  })

  it('tags jscadMain with the runId beginRun returns', async () => {
    const jscadMain = vi.fn(async () => ({ entities: [] }))
    await runModelUpdate(deps(jscadMain, { beginRun: () => 9 }))
    expect(jscadMain.mock.calls[0][0].runId).toBe(9)
  })

  it('ends the run when jscadMain throws', async () => {
    const error = new Error('model exceeded 1000 ms')
    const endRun = vi.fn()
    const d = deps(async () => { throw error }, { beginRun: vi.fn(), endRun })
    await runModelUpdate(d)
    expect(endRun).toHaveBeenCalledOnce()
    expect(d.setError).toHaveBeenCalledWith(error)
  })

  it('runs without the stream hooks', async () => {
    const d = deps(async () => ({ entities: [] }))
    await runModelUpdate(d)
    expect(d.handleEntities).toHaveBeenCalledOnce()
  })
})
