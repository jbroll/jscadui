// apps/jscad-web/test/editor.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as editor from '../src/editor.js'

// jsdom has no layout, so CodeMirror's post-edit measure calls getClientRects
// on a text range, which jsdom does not implement.
Range.prototype.getClientRects ??= () => []
Range.prototype.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

// The editor's file entries, as toEditorFiles builds them: a File named by its
// fullPath with a leading slash.
const entryOf = (path, content) => Object.assign(new File([content], path.split('/').pop()), { fullPath: `/${path}` })

beforeEach(() => {
  document.body.innerHTML = `
    <div id="editor">
      <div id="editor-toggle"></div>
      <div id="editor-container"></div>
      <div id="editor-nav"></div>
      <div id="editor-file"></div>
      <div id="editor-files"></div>
    </div>`
})

// init wires the CodeMirror view and the file selector; getFileFn serves the
// project's cache, as main.js's does.
const initEditor = (files = {}, confirm) => {
  const getFileFn = vi.fn(async (path) => entryOf(path.replace(/^\//, ''), files[path.replace(/^\//, '')] ?? ''))
  editor.init('initial', vi.fn(), vi.fn(), getFileFn, confirm)
  return { getFileFn }
}

describe('chat delete of the open file', () => {
  it('setFiles with resetMissing points the pane at another file when the open one is gone', async () => {
    initEditor({ 'main.js': 'main code', 'helper.js': 'helper code' })
    editor.setSource('main code', 'main.js')
    editor.setFiles([entryOf('main.js', 'main code'), entryOf('helper.js', 'helper code')], { keepBuffers: true, resetMissing: true })
    expect(editor.getPath()).toBe('main.js')
    editor.setFiles([entryOf('helper.js', 'helper code')], { keepBuffers: true, resetMissing: true })
    await vi.waitFor(() => expect(editor.getSource()).toBe('helper code'))
    expect(editor.getPath()).toBe('/helper.js')
  })

  it('clears the pane when no file remains', () => {
    initEditor({ 'main.js': 'main code' })
    editor.setSource('main code', 'main.js')
    editor.setFiles([entryOf('main.js', 'main code')], { keepBuffers: true, resetMissing: true })
    editor.setFiles([], { keepBuffers: true, resetMissing: true })
    expect(editor.getPath()).toBe('')
    expect(editor.getSource()).toBe('')
  })

  it('leaves the open file alone while it is still in the project', () => {
    initEditor({ 'main.js': 'main code', 'helper.js': 'helper code' })
    editor.setSource('main code', 'main.js')
    editor.setFiles([entryOf('main.js', 'main code'), entryOf('helper.js', 'helper code')], { keepBuffers: true, resetMissing: true })
    expect(editor.getPath()).toBe('main.js')
    expect(editor.getSource()).toBe('main code')
  })

  it('does not reset without resetMissing, as the disk project depends on', () => {
    initEditor({ 'main.js': 'main code', 'helper.js': 'helper code' })
    editor.setSource('main code', 'main.js')
    editor.setFiles([entryOf('helper.js', 'helper code')], { keepBuffers: true })
    expect(editor.getPath()).toBe('main.js')
  })
})

describe('file tree', () => {
  it('renders a node for a single file and keeps the tree visible', () => {
    initEditor({ 'main.js': 'main code' })
    editor.setSource('main code', 'main.js')
    editor.setFiles([entryOf('main.js', 'main code')], { keepBuffers: true })
    expect(document.querySelectorAll('#editor-files .file-node')).toHaveLength(1)
    expect(document.getElementById('editor-nav').classList.contains('visible')).toBe(true)
  })

  it('marks the entry and the files the turn touched from setFileMeta', () => {
    initEditor({ 'main.js': 'm', 'helper.js': 'h' })
    editor.setSource('m', 'main.js')
    editor.setFiles([entryOf('main.js', 'm'), entryOf('helper.js', 'h')], { keepBuffers: true })
    editor.setFileMeta({ entry: 'main.js', touched: ['helper.js'] })
    expect(document.querySelector('#editor-files [data-path="/main.js"]').classList.contains('is-entry')).toBe(true)
    expect(document.querySelector('#editor-files [data-path="/helper.js"]').classList.contains('is-touched')).toBe(true)
  })

  it('asks the discard confirm before opening another file while dirty, and stays when declined', async () => {
    const confirm = vi.fn(async () => false)
    initEditor({ 'main.js': 'main code', 'helper.js': 'helper code' }, confirm)
    editor.setSource('main code', 'main.js')
    editor.setFiles([entryOf('main.js', 'main code'), entryOf('helper.js', 'helper code')], { keepBuffers: true })
    editor.applyEdit({ changes: [{ from: 0, insert: 'x' }], cursor: 1 })
    document.querySelector('#editor-files [data-path="/helper.js"] .file-open').click()
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(editor.getPath()).toBe('main.js')
    expect(editor.getSource()).toBe('xmain code')
  })

  it('opens the clicked file once the discard is accepted', async () => {
    const confirm = vi.fn(async () => true)
    initEditor({ 'main.js': 'main code', 'helper.js': 'helper code' }, confirm)
    editor.setSource('main code', 'main.js')
    editor.setFiles([entryOf('main.js', 'main code'), entryOf('helper.js', 'helper code')], { keepBuffers: true })
    editor.applyEdit({ changes: [{ from: 0, insert: 'x' }], cursor: 1 })
    document.querySelector('#editor-files [data-path="/helper.js"] .file-open').click()
    await vi.waitFor(() => expect(editor.getSource()).toBe('helper code'))
    expect(editor.getPath()).toBe('/helper.js')
  })

  it('delegates a tree delete to the injected action after the confirm', async () => {
    const confirm = vi.fn(async () => true)
    const onDelete = vi.fn()
    initEditor({ 'main.js': 'main code', 'helper.js': 'helper code' }, confirm)
    editor.setFileActions({ onDelete })
    editor.setSource('main code', 'main.js')
    editor.setFiles([entryOf('main.js', 'main code'), entryOf('helper.js', 'helper code')], { keepBuffers: true })
    editor.setFileMeta({ entry: 'main.js' })
    document.querySelector('#editor-files [data-path="/helper.js"] .file-delete').click()
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith('/helper.js'))
    expect(confirm).toHaveBeenCalled()
  })
})