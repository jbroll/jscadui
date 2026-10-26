import { defaultKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { keymap } from '@codemirror/view'
import { EditorView, basicSetup } from 'codemirror'
import { readAsText } from '@jscadui/fs-provider'

import { createIndexLoader } from './apiIndex.js'
import * as drawer from './drawer.js'
import { apiExtensions } from './editorApi.js'
import { createEditorBuffer } from './editorBuffer.js'
import { renderFileTree } from './fileTree.js'

/** 
 * @typedef {import('@jscadui/fs-provider').FSFileEntry} FSFileEntry
 * 
 * @callback CompileFn
 * @param {string} code
 * @param {string} path
 * 
 * @callback SaveFn
 * @param {string} code
 * @param {string} path
 * 
 * @callback GetFileFn
 * @param {string} path
 * @returns {Promise<FSFileEntry | undefined>}
 *
 * @callback ConfirmFn
 * @param {{title:string,message:string,confirmLabel:string,cancelLabel:string}} options
 * @returns {Promise<boolean>}
 */

/** @type {EditorView} */
let view

/** @type {CompileFn} */
let compileFn
/** @type {SaveFn} */
let saveFn
/** @type {GetFileFn} */
let getFileFn

// file selector
let currentFile = '/index.js'
const buffer = createEditorBuffer()
const loadApiIndex = createIndexLoader()
let applying = false
/** @type {HTMLElement} */
let editorNav
/** @type {HTMLElement} */
let editorFile

/**
 * @param {string} code 
 * @param {string} path 
 */
const compile = (code, path) => {
  if (compileFn) {
    compileFn(code, path)
  } else {
    console.log('not ready to compile')
  }
}

/**
* @param {string} code 
* @param {string} path 
*/
const save = (code, path) => {
  compileFn(code, path)
  saveFn(code, path)
}

export const runScript = () => compile(view.state.doc.toString(), currentFile)

/**
 * @param {string} defaultCode 
 * @param {CompileFn} fn 
 * @param {SaveFn} _saveFn 
 * @param {GetFileFn} _getFileFn 
 * @param {ConfirmFn} [_confirm]
 */
export const init = (defaultCode, fn, _saveFn, _getFileFn, _confirm) => {
  // H3 fix: Clean up existing resources if init() called multiple times
  if (documentClickHandler) {
    document.removeEventListener('click', documentClickHandler)
    documentClickHandler = undefined
  }
  if (view) {
    view.destroy()
    view = undefined
  }

  // by calling document.getElementById here instead outside of init we allow the flow
  // where javascript is included in the page before the template is loaded into the DOM
  // it was causing issue to users trying to replicate the app in Vue, and would likely some others too
  editorNav = document.getElementById('editor-nav')
  editorFile = document.getElementById('editor-file')

  compileFn = fn
  saveFn = _saveFn
  getFileFn = _getFileFn
  confirmFn = _confirm
  // Initialize codemirror
  const editorDiv = document.getElementById('editor-container')
  view = new EditorView({
    extensions: [
      basicSetup,
      javascript(),
      ...apiExtensions(loadApiIndex),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applying) buffer.edit(currentFile, update.state.doc.toString())
      }),
      keymap.of([
        {
          key: 'Shift-Enter',
          run: runScript,
          preventDefault: true,
        },
        {
          key: 'Mod-s',
          run: () => save(view.state.doc.toString(), currentFile),
          preventDefault: true,
        },
        ...defaultKeymap,
      ]),
    ],
    parent: editorDiv,
  })
  setSource(defaultCode, 'jscad.example.js')

  // Initialize drawer action
  drawer.init()

  // Make editor hint clickable
  // M1 fix: Add null checks for optional DOM elements
  const editorHint = document.getElementById('editor-hint')
  const editorHint2 = document.getElementById('editor-hint2')
  if (editorHint) {
    editorHint.addEventListener('click', () => {
      compile(view.state.doc.toString(), currentFile)
    })
  }
  if (editorHint2) {
    editorHint2.addEventListener('click', () => {
      save(view.state.doc.toString(), currentFile)
    })
  }

  // Setup file selector
  editorFile.addEventListener('click', () => {
    editorNav.classList.toggle('open')
  })
  // Close file selector on click outside
  documentClickHandler = (e) => {
    if (!editorFile.contains(e.target)) {
      editorNav.classList.remove('open')
    }
  }
  document.addEventListener('click', documentClickHandler)
}

/** @returns {boolean} whether the CodeMirror view has been created */
export const isReady = () => view !== undefined

/** @returns {string} */
export const getSource = () => view.state.doc.toString()

/** @returns {number} the cursor position in the document */
export const getCursor = () => view.state.selection.main.head

/**
 * `cursor` is in post-edit coordinates, so unlike `changes` it is not mapped.
 * @param {{ changes: { from: number, to?: number, insert: string }[], cursor: number }} edit
 */
export const applyEdit = ({ changes, cursor }) => {
  view.dispatch({
    changes,
    selection: { anchor: cursor },
    scrollIntoView: true,
  })
  view.focus()
}

/** @returns {string} the path of the file in the editor */
export const getPath = () => currentFile

/** @type {((options:{title:string,message:string,confirmLabel:string,cancelLabel:string}) => Promise<boolean>) | undefined} */
let confirmFn

/** @returns {boolean} whether any open path has unsaved edits */
export const isDirty = () => buffer.isDirty()

/**
 * The gate before a whole-project replace: true to proceed. Clean buffers
 * proceed silently; a dirty buffer asks the injected confirm dialog.
 * @returns {Promise<boolean>}
 */
export const confirmDiscard = async () => {
  if (!buffer.isDirty() || !confirmFn) return true
  return confirmFn({
    title: 'Discard unsaved edits?',
    message: 'Opening this replaces the editor with the project’s saved files. Your unsaved edits will be lost.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep edits',
  })
}

/**
 * @param {string} source
 * @param {string} [path]
 * @param {{clean?: boolean}} [options] `clean` (default true) records the
 *   content as authoritative; false displays buffered content and keeps its
 *   dirty flag.
 */
export const setSource = (source, path = '/index.js', { clean = true } = {}) => {
  currentFile = path
  applying = true
  try {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } })
  } finally {
    applying = false
  }
  if (clean) buffer.remember(path, source)
  else buffer.set(path, source)
  if (editorFile) editorFile.textContent = path
}

export async function filesChanged(files) {
  // H3 fix: Add error handling for async operations
  try {
    let file
    for (let i = 0; i < files.length; i++) {
      const path = files[i]
      // H4 fix: Use strict equality
      if (path === currentFile) {
        file = await getFileFn(path)
        await readSource(file, currentFile)
      } else if (path.name === currentFile) {
        setSource(await readAsText(path), currentFile)
      }
    }
  } catch (err) {
    console.error('Failed to handle file changes:', err)
  }
}

async function readSource(file, currentFile) {
  setSource(await readAsText(file), currentFile)
}

let editorFilesArr = []

export const getEditorFiles = () => editorFilesArr

// The file tree's render state, pushed by the app: the project's entry and the
// paths the current turn touched. Actions (delete/rename) come from main.js,
// which owns storage.
let fileMeta = { entry: '', touched: [] }
let fileActions = {}
let fileMessage = ''

// The tree's file map: the editor's entries, keyed by their leading-slash path.
const treeFiles = () => Object.fromEntries(editorFilesArr.map((file) => [file.fullPath, file]))

// A path is dirty under either spelling: the flat list and setSource disagree
// about the leading slash, and the buffer follows whichever set it.
const dirtyFromFiles = () => editorFilesArr
  .map((file) => file.fullPath)
  .filter((path) => buffer.isDirtyPath(path) || buffer.isDirtyPath(String(path).replace(/^\//, '')))

// The tree's delete confirm reuses the editor's injected dialog, so the tree
// asks in the app's own chrome; without one nothing is deleted.
const treeConfirm = (message) => confirmFn
  ? confirmFn({ title: 'Delete file?', message, confirmLabel: 'Delete', cancelLabel: 'Cancel' })
  : Promise.resolve(false)

const openTreeFile = async (path) => {
  // The buffer follows whichever spelling set it (setSource is called with the
  // bare entry path, tree rows carry the leading slash).
  if (path.replace(/^\//, '') === currentFile.replace(/^\//, '')) return
  // Navigating away from a dirty buffer reuses the whole-project discard gate.
  if (!(await confirmDiscard())) return
  const buffered = buffer.isDirtyPath(path) ? path : buffer.isDirtyPath(String(path).replace(/^\//, '')) ? String(path).replace(/^\//, '') : null
  if (buffered !== null) {
    setSource(buffer.get(buffered), path, { clean: false })
    return
  }
  const file = editorFilesArr.find((entry) => entry.fullPath === path)
  if (file) await readSource(file, path)
}

const renderTree = () => {
  const container = document.getElementById('editor-files')
  if (!container) return
  renderFileTree(container, {
    files: treeFiles(),
    entry: fileMeta.entry,
    dirtyPaths: dirtyFromFiles(),
    touchedPaths: fileMeta.touched,
    message: fileMessage,
    confirm: treeConfirm,
    onOpen: openTreeFile,
    onDelete: fileActions.onDelete,
    onRename: fileActions.onRename,
  })
}

/**
 * Wire the tree's per-file actions to the app, which owns storage: deleting a
 * project file and renaming one both go through it.
 * @param {{onDelete?: (path:string) => void, onRename?: (path:string, name:string) => void}} [actions]
 */
export const setFileActions = ({ onDelete, onRename } = {}) => {
  fileActions = { onDelete, onRename }
  renderTree()
}

/**
 * Push the tree's render state: the project's entry file and the paths the
 * current turn touched, both marked on the nodes.
 * @param {{entry?: string, touched?: string[]}} [meta]
 */
export const setFileMeta = ({ entry, touched } = {}) => {
  fileMeta = { entry: entry ?? '', touched: touched ?? [] }
  fileMessage = ''
  renderTree()
}

/**
 * Show a one-line notice above the tree (a blocked rename, say); cleared by
 * the next setFiles/setFileMeta.
 * @param {string} [text]
 */
export const showFileMessage = (text) => {
  fileMessage = text ?? ''
  renderTree()
}

// Track document-level click handler for cleanup
let documentClickHandler

// The chat's delete removed the file the editor shows: point the pane at the
// first remaining file, or an empty source when none remain. The disk project
// keeps a file removed on disk open on purpose, so setFiles does this only
// when its caller asks (the chat's delete).
const openReplacement = (files) => {
  const open = currentFile.replace(/^\//, '')
  if (files.some((file) => file.fullPath.replace(/^\//, '') === open)) return
  const [next] = files
  if (next) {
    const path = next.fullPath
    if (buffer.isDirtyPath(path)) setSource(buffer.get(path), path, { clean: false })
    else readSource(next, path)
  } else {
    setSource('', '')
  }
}

/**
 * The tree shows every project file, so the nav is never hidden — a
 * single-file project renders one node.
 * @param {FSFileEntry[]} files
 * @param {{keepBuffers?: boolean, resetMissing?: boolean}} [options]
 */
export const setFiles = (files, { keepBuffers = false, resetMissing = false } = {}) => {
  editorFilesArr = files
  if (keepBuffers) buffer.prune(new Set(files.map((f) => f.fullPath)))
  else buffer.clear()
  if (resetMissing) openReplacement(files)
  editorNav?.classList.add('visible')
  if (editorFile) editorFile.textContent = currentFile
  fileMessage = ''
  renderTree()
}

/**
 * Cleanup editor resources
 */
export const destroy = () => {
  if (view) {
    view.destroy()
    view = undefined
  }
  if (documentClickHandler) {
    document.removeEventListener('click', documentClickHandler)
    documentClickHandler = undefined
  }
  drawer.destroy?.()
}
