// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fileSystem from '../src/fileSystem.js'

vi.mock('@jscadui/fs-provider', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    extractEntries: vi.fn(async () => []),
    fileDropped: vi.fn(async () => {}),
    registerServiceWorker: vi.fn(async () => ({ roots: [], cache: { keys: async () => [], delete: async () => {} } })),
  }
})

// No service worker registered: models still run, from files the app keeps in memory.
describe('project files without a service worker', () => {
  it('keeps what the app writes and hands it to every run', async () => {
    expect(fileSystem.getSwHandler()).toBeUndefined()
    await fileSystem.addToCacheWrapper('main.js', 'module.exports = { main }')
    await fileSystem.addToCacheWrapper('/lib/part.js', 'part')
    expect(await fileSystem.projectFiles()).toEqual({ 'main.js': 'module.exports = { main }', 'lib/part.js': 'part' })
  })

  it('empties with the project cache', async () => {
    await fileSystem.addToCacheWrapper('main.js', 'x')
    await fileSystem.clearProjectCache()
    expect(await fileSystem.projectFiles()).toEqual({})
  })
})

describe('v1 include inlining for project files', () => {
  it('inlines sibling includes from the file map', async () => {
    const out = await fileSystem.inlineProjectIncludes(
      'include("./lib.jscad");\nfunction main() { return helper(); }',
      'main.jscad',
      { 'main.jscad': '', 'lib.jscad': 'function helper() { return 42; }' }
    )
    expect(out).toContain('function helper()')
    expect(out).not.toMatch(/^\s*include\(/m)
  })

  it('resolves absolute includes against library roots', async () => {
    const out = await fileSystem.inlineProjectIncludes(
      'include("/mechanics/part.jscad");',
      'models/m.jscad',
      { 'models/m.jscad': '', 'library/mechanics/part.jscad': 'var PART = 7;' }
    )
    expect(out).toContain('var PART = 7;')
  })
})

describe('drop routing', () => {
  let cleanup
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })
  afterEach(() => {
    cleanup?.()
  })

  const setup = () => {
    document.body.innerHTML = '<div id="dropModal" style="display:none"></div><div class="project-row" data-project-id="p1">row</div>'
    const modal = document.getElementById('dropModal')
    cleanup = fileSystem.setupDragDrop(modal, async () => {})
    return { modal, row: document.querySelector('.project-row') }
  }

  it('does not cover a project row with the drop modal while dragging over it', () => {
    const { modal, row } = setup()
    row.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    expect(modal.style.display).toBe('none')
  })

  it('shows the drop modal full-screen over the page', () => {
    const { modal } = setup()
    document.body.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    expect(modal.style.display).not.toBe('none')
  })

  it('does not re-read a DataTransfer whose entries were already captured', async () => {
    const { extractEntries, fileDropped } = await import('@jscadui/fs-provider')
    const entries = [{ name: 'a.js', isDirectory: false }]
    await fileSystem.handleFileDrop({}, { setEditorFiles: () => {}, onFilesChange: () => {}, setError: () => {} }, entries)
    expect(extractEntries).not.toHaveBeenCalled()
    expect(fileDropped).toHaveBeenCalledWith(expect.anything(), entries, expect.anything())
  })

  it('the cleanup removes the body listeners', () => {
    const { modal } = setup()
    cleanup()
    document.body.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    expect(modal.style.display).toBe('none')
  })
})
