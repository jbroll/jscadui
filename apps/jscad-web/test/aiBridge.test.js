// Local tool bridge against fakes: every tool name must reach the right
// dependency, failures must become error results, and nothing may throw.
import { describe, expect, it, vi } from 'vitest'
import { handleToolRequest } from '../src/aiBridge.js'

const deps = (overrides = {}) => ({
  evaluate: vi.fn(async () => ({ entityCount: 1 })),
  setParams: vi.fn(async () => ({ entityCount: 2 })),
  measure: vi.fn(async () => ({ volume: 1000 })),
  check: vi.fn(async () => ({ watertight: true })),
  exportModel: vi.fn(async () => ({ format: 'stlb', size: 684 })),
  view: vi.fn(async () => ({ image: 'data:image/png;base64,x' })),
  save: vi.fn(async () => ({ entry: 'main.js' })),
  ...overrides,
})

describe('local tool bridge', () => {
  it('routes eval with source and entry', async () => {
    const d = deps()
    const res = await handleToolRequest('eval', { source: 'cube', entry: 'main.js' }, d)
    expect(d.evaluate).toHaveBeenCalledWith('cube', 'main.js')
    expect(res).toEqual({ entityCount: 1 })
  })

  it('routes params with values', async () => {
    const d = deps()
    await handleToolRequest('params', { values: { size: 20 } }, d)
    expect(d.setParams).toHaveBeenCalledWith({ size: 20 })
  })

  it('routes measure with options', async () => {
    const d = deps()
    const res = await handleToolRequest('measure', { parts: true }, d)
    expect(d.measure).toHaveBeenCalledWith({ parts: true })
    expect(res).toEqual({ volume: 1000 })
  })

  it('routes check with bed', async () => {
    const d = deps()
    await handleToolRequest('check', { bed: [200, 200] }, d)
    expect(d.check).toHaveBeenCalledWith({ bed: [200, 200] })
  })

  it('routes export with format', async () => {
    const d = deps()
    const res = await handleToolRequest('export', { format: 'stlb' }, d)
    expect(d.exportModel).toHaveBeenCalledWith({ format: 'stlb' })
    expect(res.size).toBe(684)
  })

  it('serves view from the viewer', async () => {
    const d = deps()
    const res = await handleToolRequest('view', { preset: 'top' }, d)
    expect(d.view).toHaveBeenCalledWith({ preset: 'top' })
    expect(res.image).toMatch(/^data:image\/png/)
  })

  it('saves writeModel to the editor', async () => {
    const d = deps()
    const res = await handleToolRequest('writeModel', { source: 'sphere', entry: 'main.js' }, d)
    expect(d.save).toHaveBeenCalledWith('sphere', 'main.js')
    expect(res.entry).toBe('main.js')
  })

  it('answers unknown tools with an error result, never a throw', async () => {
    const res = await handleToolRequest('teleport', {}, deps())
    expect(res.ok).toBe(false)
    expect(res.error.message).toMatch(/unknown tool/)
  })

  it('turns a dependency rejection into an error result', async () => {
    const d = deps({ measure: async () => { throw new Error('boom') } })
    const res = await handleToolRequest('measure', {}, d)
    expect(res).toEqual({ ok: false, error: { name: 'Error', message: 'boom' } })
  })
})
