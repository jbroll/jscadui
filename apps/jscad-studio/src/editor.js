import { defaultKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { keymap } from '@codemirror/view'
import { EditorView, basicSetup } from 'codemirror'

import * as drawer from './drawer.js'

/** @type {EditorView} */
let view

/** @type {(code: string, path: string) => void} */
let compileFn
/** @type {(code: string, path: string) => void} */
let saveFn

let currentFile = '/index.js'
/** @type {HTMLElement | null} */
let editorNav
/** @type {HTMLElement | null} */
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
 * @param {(code: string, path: string) => void} fn 
 * @param {(code: string, path: string) => void} _saveFn 
 * @param {(path: string) => Promise<object | undefined>} _getFileFn 
 */
export const init = (defaultCode, fn, _saveFn, _getFileFn) => {
  if (documentClickHandler) {
    document.removeEventListener('click', documentClickHandler)
    documentClickHandler = undefined
  }
  if (view) {
    view.destroy()
    view = undefined
  }

  editorNav = document.getElementById('editor-nav')
  editorFile = document.getElementById('editor-file')

  compileFn = fn
  saveFn = _saveFn
  const editorDiv = document.getElementById('editor-container')
  view = new EditorView({
    extensions: [
      basicSetup,
      javascript(),
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

/** @returns {string} */
export const getSource = () => view.state.doc.toString()

/** 
 * @param {string} source 
 * @param {string} path 
 */
export const setSource = (source, path = '/index.js') => {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } })
  currentFile = path
}

// Track document-level click handler for cleanup
let documentClickHandler

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