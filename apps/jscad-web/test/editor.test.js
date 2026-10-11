// apps/jscad-web/test/editor.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as editor from '../src/editor.js'

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
const initEditor = (files = {}) => {
  const getFileFn = vi.fn(async (path) => entryOf(path.replace(/^\//, ''), files[path.replace(/^\//, '')] ?? ''))
  editor.init('initial', vi.fn(), vi.fn(), getFileFn)
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