import { describe, expect, it, vi } from 'vitest'
import { dispatchTool, toolError } from '../src/dispatchTool.js'
import { TOOLS } from '../src/tools.js'

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

describe('dispatchTool', () => {
  it('serves every tool the model is offered, and view', async () => {
    for (const name of [...TOOLS.map((tool) => tool.name), 'view']) {
      const res = await dispatchTool(name, {}, deps())
      expect(res?.error?.name, name).not.toBe('UnknownToolError')
    }
  })

  it('routes list, and read with its arguments', async () => {
    const d = deps()
    expect((await dispatchTool('list', undefined, d)).files).toHaveLength(1)
    expect(await dispatchTool('read', { path: 'main.js', offset: 2 }, d)).toBe('     1\tabc')
    expect(d.read).toHaveBeenCalledWith({ path: 'main.js', offset: 2 })
  })

  it('routes write and edit with their arguments and answers the build report', async () => {
    const d = deps()
    expect(await dispatchTool('write', { path: 'main.js', content: 'x' }, d)).toBe(REPORT)
    expect(d.write).toHaveBeenCalledWith({ path: 'main.js', content: 'x' })
    const edit = { path: 'main.js', oldString: 'a', newString: 'b', replaceAll: true }
    expect(await dispatchTool('edit', edit, d)).toBe(REPORT)
    expect(d.edit).toHaveBeenCalledWith(edit)
  })

  it('routes run with its source', async () => {
    const d = deps()
    await dispatchTool('run', { source: 'console.log(1)' }, d)
    expect(d.run).toHaveBeenCalledWith('console.log(1)')
  })

  it('routes measure and check with their options, and export to exportModel', async () => {
    const d = deps()
    expect(await dispatchTool('measure', { parts: true }, d)).toEqual({ volume: 1000 })
    expect(d.measure).toHaveBeenCalledWith({ parts: true })
    await dispatchTool('check', { bed: [200, 200] }, d)
    expect(d.check).toHaveBeenCalledWith({ bed: [200, 200] })
    expect((await dispatchTool('export', { format: 'stlb' }, d)).size).toBe(684)
    expect(d.exportModel).toHaveBeenCalledWith({ format: 'stlb' })
  })

  it('routes view with its arguments and docs with its query', async () => {
    const d = deps()
    expect((await dispatchTool('view', { preset: 'top' }, d)).image).toMatch(/^data:image\/png/)
    expect(d.view).toHaveBeenCalledWith({ preset: 'top' })
    expect(await dispatchTool('docs', { query: 'cube' }, d)).toBe('primitives.cube (@jscad/modeling)')
    expect(d.docs).toHaveBeenCalledWith('cube')
  })

  it.each(['eval', 'params', 'writeModel', 'constructor', 'toString'])('answers %s as an unknown tool', async (name) => {
    expect(await dispatchTool(name, { source: 'x' }, deps())).toEqual(toolError('UnknownToolError', `unknown tool ${name}`))
  })

  it('turns a dependency throw or rejection into an error result', async () => {
    const d = deps({
      edit: async () => {
        throw Object.assign(new Error('oldString is not in main.js'), { name: 'EditError' })
      },
      docs: () => {
        throw 'no index'
      },
    })
    expect(await dispatchTool('edit', {}, d)).toEqual({ ok: false, error: { name: 'EditError', message: 'oldString is not in main.js' } })
    expect(await dispatchTool('docs', {}, d)).toEqual({ ok: false, error: { name: 'Error', message: 'no index' } })
  })
})
