// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderFileTree } from '../src/fileTree.js'

// renderFileTree is pure: it reads a file map and paints rows into the
// container. The editor owns the DOM element; these tests own the markup.
let container

const render = (options = {}) => renderFileTree(container, options)

const node = (path) => container.querySelector(`[data-path="${path}"]`)

beforeEach(() => {
  vi.unstubAllGlobals()
  container = document.createElement('ul')
  document.body.replaceChildren(container)
})

describe('tree structure', () => {
  it('groups nested paths into directories, alphabetical with directories first', () => {
    render({
      files: { 'readme.md': '', 'src/util/helper.js': '', 'src/main.js': '', 'a.js': '' },
      entry: 'src/main.js',
    })
    const groups = [...container.children].filter((c) => c.classList.contains('file-dir'))
    expect(groups).toHaveLength(1)
    expect(container.querySelector('.file-dir .file-dir-label').textContent).toBe('src/')
    // directories sort before files at the top level
    expect(container.children[0].classList.contains('file-dir')).toBe(true)
    expect([...container.children].slice(1).map((c) => c.dataset.path)).toEqual(['a.js', 'readme.md'])
    // the nested directory nests further
    expect(container.querySelector('[data-path="src/util/helper.js"]')).not.toBeNull()
    expect(container.querySelector('[data-path="src/main.js"]').classList.contains('is-entry')).toBe(true)
  })

  it('renders one node for a single-file map', () => {
    render({ files: { 'main.js': '' }, entry: 'main.js' })
    expect(container.querySelectorAll('.file-node')).toHaveLength(1)
    expect(node('main.js').classList.contains('is-entry')).toBe(true)
  })

  it('marks dirty and touched paths, tolerating a leading slash', () => {
    render({ files: { 'main.js': '', 'helper.js': '' }, entry: 'main.js', dirtyPaths: ['/main.js'], touchedPaths: ['helper.js'] })
    expect(node('main.js').classList.contains('is-dirty')).toBe(true)
    expect(node('helper.js').classList.contains('is-touched')).toBe(true)
    expect(node('helper.js').classList.contains('is-dirty')).toBe(false)
  })

  it('shows a size badge on binary files only', () => {
    render({ files: { 'part.stl': new ArrayBuffer(2048), 'main.js': 'x'.repeat(10) } })
    expect(node('part.stl').querySelector('.file-size').textContent).toBe('2.0 KB')
    expect(node('main.js').querySelector('.file-size')).toBeNull()
  })
})

describe('node actions', () => {
  it('opens a file on click', () => {
    const onOpen = vi.fn()
    render({ files: { 'main.js': '', 'helper.js': '' }, onOpen })
    node('helper.js').querySelector('.file-open').click()
    expect(onOpen).toHaveBeenCalledWith('helper.js')
  })

  it('deletes a file after the confirm is accepted', async () => {
    const confirm = vi.fn(async () => true)
    const onDelete = vi.fn()
    render({ files: { 'main.js': '', 'helper.js': '' }, entry: 'main.js', confirm, onDelete })
    node('helper.js').querySelector('.file-delete').click()
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith('helper.js'))
    expect(confirm).toHaveBeenCalled()
  })

  it('does not delete when the confirm is declined', async () => {
    const onDelete = vi.fn()
    render({ files: { 'main.js': '', 'helper.js': '' }, entry: 'main.js', confirm: async () => false, onDelete })
    node('helper.js').querySelector('.file-delete').click()
    await new Promise((r) => setTimeout(r, 0))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('blocks deleting the entry file with a message and no confirm', async () => {
    const confirm = vi.fn(async () => true)
    const onDelete = vi.fn()
    render({ files: { 'main.js': '', 'helper.js': '' }, entry: 'main.js', confirm, onDelete })
    node('main.js').querySelector('.file-delete').click()
    await new Promise((r) => setTimeout(r, 0))
    expect(confirm).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
    expect(container.querySelector('.file-message').textContent).toMatch(/entry/i)
  })

  it('blocks deleting the last file with a message', async () => {
    const onDelete = vi.fn()
    render({ files: { 'main.js': '' }, entry: 'other.js', confirm: async () => true, onDelete })
    node('main.js').querySelector('.file-delete').click()
    await new Promise((r) => setTimeout(r, 0))
    expect(onDelete).not.toHaveBeenCalled()
    expect(container.querySelector('.file-message').textContent).toMatch(/last file/i)
  })

  it('renames a file from the pencil prompt', () => {
    const onRename = vi.fn()
    vi.stubGlobal('prompt', vi.fn(() => 'renamed.js'))
    render({ files: { 'main.js': '', 'helper.js': '' }, entry: 'main.js', onRename })
    node('helper.js').querySelector('.file-rename').click()
    expect(onRename).toHaveBeenCalledWith('helper.js', 'renamed.js')
  })

  it('renders a caller-supplied message row', () => {
    render({ files: { 'main.js': '' }, message: '“helper.js” already exists' })
    expect(container.querySelector('.file-message').textContent).toBe('“helper.js” already exists')
  })
})
