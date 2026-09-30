// Local tool bridge against fakes: every tool name must reach the right
// dependency, failures must become error results, and nothing may throw.
import { describe, expect, it, vi } from 'vitest'
import { TOOLS } from '@jscadui/agent-loop'
import { handleToolRequest } from '../src/aiBridge.js'

const REPORT = { ok: true, entry: 'main.js', warnings: [], console: [], params: [] }

const deps = (overrides = {}) => ({
  list: vi.fn(async () => ({ ok: true, files: [{ path: 'main.js', size: 3 }] })),
  read: vi.fn(async () => '     1\tabc'),
  write: vi.fn(async () => REPORT),
  edit: vi.fn(async () => REPORT),
  run: vi.fn(async () => ({ ok: true, warnings: [], console: ['1'] })),
  measure: vi.fn(async () => ({ volume: 1000 })),
  check: vi.fn(async () => ({ watertight: true })),
  exportModel: vi.fn(async () => ({ format: 'stlb', size: 684 })),
  view: vi.fn(async () => ({ image: 'data:image/png;base64,x' })),
  docs: vi.fn(() => 'primitives.cube (@jscad/modeling)'),
  ...overrides,
})

describe('local tool bridge', () => {
  it('serves every tool the model is offered', async () => {
    for (const { name } of TOOLS) {
      const res = await handleToolRequest(name, {}, deps())
      expect(res?.error?.name, name).not.toBe('UnknownToolError')
    }
  })

  it('routes list, and read with its arguments', async () => {
    const d = deps()
    expect((await handleToolRequest('list', undefined, d)).files).toHaveLength(1)
    expect(await handleToolRequest('read', { path: 'main.js', offset: 2 }, d)).toBe('     1\tabc')
    expect(d.read).toHaveBeenCalledWith({ path: 'main.js', offset: 2 })
  })

  it('routes write and edit with their arguments and answers the build report', async () => {
    const d = deps()
    expect(await handleToolRequest('write', { path: 'main.js', content: 'x' }, d)).toBe(REPORT)
    expect(d.write).toHaveBeenCalledWith({ path: 'main.js', content: 'x' })
    const edit = { path: 'main.js', oldString: 'a', newString: 'b', replaceAll: true }
    expect(await handleToolRequest('edit', edit, d)).toBe(REPORT)
    expect(d.edit).toHaveBeenCalledWith(edit)
  })

  it('routes run with its source', async () => {
    const d = deps()
    await handleToolRequest('run', { source: 'console.log(1)' }, d)
    expect(d.run).toHaveBeenCalledWith('console.log(1)')
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

  it('answers the removed eval, params and writeModel tools as unknown', async () => {
    for (const name of ['eval', 'params', 'writeModel']) {
      expect((await handleToolRequest(name, { source: 'x' }, deps())).error.name).toBe('UnknownToolError')
    }
  })

  it('turns a dependency rejection into an error result', async () => {
    const d = deps({ edit: async () => { throw Object.assign(new Error('oldString is not in main.js'), { name: 'EditError' }) } })
    const res = await handleToolRequest('edit', {}, d)
    expect(res).toEqual({ ok: false, error: { name: 'EditError', message: 'oldString is not in main.js' } })
  })

  it('routes docs with the query and returns its text', async () => {
    const d = deps()
    const res = await handleToolRequest('docs', { query: 'cube' }, d)
    expect(d.docs).toHaveBeenCalledWith('cube')
    expect(res).toBe('primitives.cube (@jscad/modeling)')
  })
})
