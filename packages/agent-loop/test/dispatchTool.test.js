import { describe, expect, it, vi } from 'vitest'
import { dispatchTool, toolError } from '../src/dispatchTool.js'
import { TOOLS } from '../src/tools.js'

const REPORT = { ok: true, entry: 'main.js', warnings: [], console: [], params: [] }

const deps = (overrides = {}) => ({
  list: vi.fn(async () => ({ ok: true, files: [{ path: 'main.js', size: 3 }] })),
  read: vi.fn(async () => '     1\tabc'),
  search: vi.fn(async () => 'main.js:1: abc'),
  write: vi.fn(async () => REPORT),
  edit: vi.fn(async () => REPORT),
  deleteFile: vi.fn(async () => ({ deleted: 'main.js', ...REPORT })),
  run: vi.fn(async () => ({ ok: true, warnings: [], console: ['1'] })),
  measure: vi.fn(async () => ({ volume: 1000 })),
  check: vi.fn(async () => ({ watertight: true })),
  exportModel: vi.fn(async () => ({ format: 'stlb', size: 684 })),
  view: vi.fn(async () => ({ image: 'data:image/png;base64,x' })),
  docs: vi.fn(() => 'primitives.cube (@jscad/modeling)'),
  skill: vi.fn((args) => `skill ${args.name}`),
  websearch: vi.fn(async () => ({ ok: true, results: [] })),
  webfetch: vi.fn(async () => ({ ok: true, title: '', finalUrl: '', content: '', truncated: false })),
  ...overrides,
})

describe('dispatchTool', () => {
  it('serves every tool the model is offered, and view', async () => {
    for (const name of [...TOOLS.map((tool) => tool.name), 'view']) {
      const res = await dispatchTool(name, {}, deps())
      expect(res?.error?.name, name).not.toBe('UnknownToolError')
    }
  })

  it('routes glob to deps.list, forwarding any pattern or path', async () => {
    const d = deps()
    expect((await dispatchTool('glob', {}, d)).files).toHaveLength(1)
    expect(d.list).toHaveBeenCalledWith({})
    await dispatchTool('glob', { pattern: '**/*.js' }, d)
    expect(d.list).toHaveBeenCalledWith({ pattern: '**/*.js' })
    expect(await dispatchTool('read', { path: 'main.js', offset: 2 }, d)).toBe('     1\tabc')
    expect(d.read).toHaveBeenCalledWith({ path: 'main.js', offset: 2 })
  })

  it('answers the old list name as an unknown tool', async () => {
    expect(await dispatchTool('list', {}, deps())).toEqual(toolError('UnknownToolError', 'unknown tool list'))
  })

  it('routes grep to deps.search with its arguments', async () => {
    const d = deps()
    expect(await dispatchTool('grep', { pattern: 'cube' }, d)).toBe('main.js:1: abc')
    expect(d.search).toHaveBeenCalledWith({ pattern: 'cube' })
    expect(await dispatchTool('grep', {}, d)).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'ValidationError' }) }))
  })

  it('answers the old search name as an unknown tool', async () => {
    expect(await dispatchTool('search', { pattern: 'cube' }, deps())).toEqual(toolError('UnknownToolError', 'unknown tool search'))
  })

  it('routes write and edit with their arguments and answers the build report', async () => {
    const d = deps()
    expect(await dispatchTool('write', { path: 'main.js', content: 'x' }, d)).toBe(REPORT)
    expect(d.write).toHaveBeenCalledWith({ path: 'main.js', content: 'x' })
    const edit = { path: 'main.js', oldString: 'a', newString: 'b', replaceAll: true }
    expect(await dispatchTool('edit', edit, d)).toBe(REPORT)
    expect(d.edit).toHaveBeenCalledWith(edit)
  })

  it('routes delete with its path', async () => {
    const d = deps()
    expect(await dispatchTool('delete', { path: 'helper.js' }, d)).toEqual({ deleted: 'main.js', ...REPORT })
    expect(d.deleteFile).toHaveBeenCalledWith({ path: 'helper.js' })
  })

  it('routes execute to deps.run with its source, and rejects missing or unknown args', async () => {
    const d = deps()
    await dispatchTool('execute', { source: 'console.log(1)' }, d)
    expect(d.run).toHaveBeenCalledWith('console.log(1)')
    d.run.mockClear()
    expect(await dispatchTool('execute', {}, d)).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'ValidationError' }) }))
    expect(await dispatchTool('execute', { source: 'x', bogus: 1 }, d)).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'ValidationError' }) }))
    expect(d.run).not.toHaveBeenCalled()
  })

  it('answers the old run name as an unknown tool', async () => {
    expect(await dispatchTool('run', { source: 'x' }, deps())).toEqual(toolError('UnknownToolError', 'unknown tool run'))
  })

  it('routes measure and check with their options, and export to exportModel', async () => {
    const d = deps()
    expect(await dispatchTool('measure', { parts: true }, d)).toEqual({ volume: 1000 })
    expect(d.measure).toHaveBeenCalledWith({ parts: true })
    await dispatchTool('check', { bed: [200, 200] }, d)
    expect(d.check).toHaveBeenCalledWith({ bed: [200, 200] })
    expect((await dispatchTool('export', { format: 'stl' }, d)).size).toBe(684)
    expect(d.exportModel).toHaveBeenCalledWith({ format: 'stl' })
  })

  it('routes view with its arguments and docs with its query', async () => {
    const d = deps()
    expect((await dispatchTool('view', { preset: 'top' }, d)).image).toMatch(/^data:image\/png/)
    expect(d.view).toHaveBeenCalledWith({ preset: 'top' })
    expect(await dispatchTool('docs', { query: 'cube' }, d)).toBe('primitives.cube (@jscad/modeling)')
    expect(d.docs).toHaveBeenCalledWith('cube')
    expect(await dispatchTool('skill', { name: 'plan-then-build' }, d)).toBe('skill plan-then-build')
    expect(d.skill).toHaveBeenCalledWith({ name: 'plan-then-build' })
  })

  it.each(['eval', 'params', 'writeModel', 'constructor', 'toString'])('answers %s as an unknown tool', async (name) => {
    expect(await dispatchTool(name, { source: 'x' }, deps())).toEqual(toolError('UnknownToolError', `unknown tool ${name}`))
  })

  it('rejects calls that violate the tool schema without calling the handler', async () => {
    const d = deps()
    expect(await dispatchTool('read', {}, d)).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'ValidationError' }) }))
    expect(d.read).not.toHaveBeenCalled()
    expect(await dispatchTool('export', { format: 5 }, d)).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'ValidationError' }) }))
    expect(d.exportModel).not.toHaveBeenCalled()
    expect(await dispatchTool('write', { path: 'a.js', content: 'x' }, d)).toBe(REPORT)
    expect(d.write).toHaveBeenCalledWith({ path: 'a.js', content: 'x' })
    expect(await dispatchTool('glob', { extra: 1 }, d)).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'ValidationError' }) }))
    expect(d.list).not.toHaveBeenCalled()
  })

  it('turns a dependency throw or rejection into an error result', async () => {    const d = deps({
      edit: async () => {
        throw Object.assign(new Error('oldString is not in main.js'), { name: 'EditError' })
      },
      docs: () => {
        throw 'no index'
      },
    })
    expect(await dispatchTool('edit', { path: 'main.js', oldString: 'a', newString: 'b' }, d)).toEqual({ ok: false, error: { name: 'EditError', message: 'oldString is not in main.js' } })
    expect(await dispatchTool('docs', { query: 'x' }, d)).toEqual({ ok: false, error: { name: 'Error', message: 'no index' } })
  })

  it('routes question to deps.askUser and surfaces denial-shaped errors as results', async () => {
    const out = await dispatchTool('question', { question: 'Which size?' }, { askUser: async (a) => `user picked for: ${a.question}` })
    expect(out).toBe('user picked for: Which size?')
    const bad = await dispatchTool('question', {}, { askUser: async () => 'x' })
    expect(bad).toMatchObject({ ok: false, error: { name: 'ValidationError' } })
  })

  it('rejects a question call with an unknown property without calling the handler', async () => {
    const d = deps({ askUser: vi.fn(async () => 'x') })
    expect(await dispatchTool('question', { question: 'x', bogus: 1 }, d)).toMatchObject({
      ok: false,
      error: { name: 'ValidationError' },
    })
    expect(d.askUser).not.toHaveBeenCalled()
  })

  it('answers the old ask_user name as an unknown tool', async () => {
    expect(await dispatchTool('ask_user', { question: 'Which size?' }, deps({ askUser: async () => 'x' }))).toEqual(toolError('UnknownToolError', 'unknown tool ask_user'))
  })

  it('routes websearch to deps.websearch and rejects unknown props', async () => {
    const d = deps({ websearch: vi.fn(async (args) => ({ ok: true, results: [], query: args.query })) })
    expect(await dispatchTool('websearch', { query: 'bearing 608' }, d)).toEqual({ ok: true, results: [], query: 'bearing 608' })
    expect(d.websearch).toHaveBeenCalledWith({ query: 'bearing 608' })
    expect(await dispatchTool('websearch', { query: 'x', bogus: 1 }, d)).toMatchObject({
      ok: false,
      error: { name: 'ValidationError' },
    })
  })

  it('answers the old web_search name as an unknown tool', async () => {
    expect(await dispatchTool('web_search', { query: 'x' }, deps())).toEqual(toolError('UnknownToolError', 'unknown tool web_search'))
  })

  it('routes webfetch to deps.webfetch and rejects shape violations without calling the handler', async () => {
    const d = deps()
    expect(await dispatchTool('webfetch', { url: 'https://example.com/a' }, d)).toEqual({ ok: true, title: '', finalUrl: '', content: '', truncated: false })
    expect(d.webfetch).toHaveBeenCalledWith({ url: 'https://example.com/a' })
    d.webfetch.mockClear()
    // A missing url or an unknown property is a schema violation here; the
    // scheme itself is the handler's concern (the schema checks only types).
    for (const bad of [{}, { url: 'https://x', bogus: 1 }, { url: 5 }]) {
      expect(await dispatchTool('webfetch', bad, d)).toMatchObject({ ok: false, error: { name: 'ValidationError' } })
    }
    expect(d.webfetch).not.toHaveBeenCalled()
    expect(await dispatchTool('webfetch', { url: 'ftp://x' }, d)).toEqual({ ok: true, title: '', finalUrl: '', content: '', truncated: false })
    expect(d.webfetch).toHaveBeenCalledWith({ url: 'ftp://x' })
  })

  it('answers the old fetch name as an unknown tool', async () => {
    expect(await dispatchTool('fetch', { url: 'https://x' }, deps())).toEqual(toolError('UnknownToolError', 'unknown tool fetch'))
  })
})
