/**
 * File system module
 * Handles file drops, service worker registration, and file watching
 */

import {
  addToCache,
  analyzeProject,
  clearCache,
  clearFs,
  extractEntries,
  fileDropped,
  getFile,
  getFileContent,
  registerServiceWorker,
} from '@jscadui/fs-provider'
import { shouldAllowReload } from './reloadDetection.js'

/**
 * @typedef {import('@jscadui/fs-provider').SwHandler} SwHandler
 */

/**
 * @typedef {object} FileSystemDeps
 * @property {() => void} onFilesChange - Called when files change (for script re-run)
 * @property {(files: string[]) => void} setEditorFiles - Set files in editor
 * @property {(files: string[]) => void} onFilesChanged - Notify editor of changed files
 * @property {(error: unknown) => void} setError - Set error display
 * @property {(alias: Array<{name: string, path: string}>) => void} onAliasFound - Called when package aliases found
 * @property {(script: string, url: string) => void} onScriptReady - Called when script is ready to run
 * @property {(projectName: string) => void} setProjectName - Set export project name
 * @property {(script: string) => string} addV1Shim - Add v1 compatibility shim
 * @property {(files: string[], root: string) => Promise<void>} clearFileCache - Clear worker file cache
 */

/** @type {SwHandler | undefined} */
let sw

/** @type {Object.<string, FileSystemFileHandle>} */
let saveMap = {}

/**
 * Reset file references
 * @param {(files: string[]) => void} setEditorFiles
 */
export async function resetFileRefs(setEditorFiles) {
  setEditorFiles([])
  saveMap = {}
  if (sw) {
    delete sw.fileToRun
    await clearFs(sw)
  }
}

/**
 * Initialize the file system service worker
 * @param {FileSystemDeps} deps
 */
export async function initFs(deps) {
  const { setEditorFiles, onFilesChanged, clearFileCache, onFilesChange } = deps

  /**
   * @param {string} path
   * @param {SwHandler} swHandler
   */
  const getFileWrapper = (path, swHandler) => {
    const file = getFileContent(path, swHandler)
    // Notify editor of active files
    file.then(() => setEditorFiles(swHandler.filesToCheck)).catch(err => {
      console.error('Failed to get file content:', path, err)
    })
    return file
  }

  const scope = document.location.pathname
  try {
    sw = await registerServiceWorker(`bundle.fs-serviceworker.js?prefix=${scope}swfs/`, getFileWrapper, {
      scope,
      prefix: scope + 'swfs/',
    })
  } catch (err) {
    // Service worker registration failed - let main.js handle the reload/error display
    // Just track that we tried so main.js can make the reload decision
    shouldAllowReload()
    console.error('Service worker registration failed:', err)
  }

  if (sw) {
    sw.defProjectName = 'jscad'
    sw.onfileschange = files => {
      if (files.includes('/package.json')) {
        onFilesChange()
      } else {
        clearFileCache(files, sw.base)
        onFilesChanged(files)
        if (sw.fileToRun) onFilesChange()
      }
    }
    sw.getFile = path => getFile(path, sw)
  }
}

/**
 * Reload the current project
 * @param {FileSystemDeps} deps
 */
export async function reloadProject(deps) {
  if (!sw) return

  const { setEditorFiles, setProjectName, onAliasFound, onScriptReady, addV1Shim } = deps

  clearCache(sw.cache)
  saveMap = {}
  sw.filesToCheck = []

  const result = await analyzeProject(sw)
  const { alias } = result
  let { script } = result

  setProjectName(sw.projectName)

  if (alias.length) {
    onAliasFound(alias)
  }

  const url = sw.fileToRun

  // Inject jscad v1 shim, and also inject changed script to cache
  // so worker and editor have the same code
  if (sw.fileToRun?.endsWith('.jscad')) {
    script = addV1Shim(script)
    addToCache(sw.cache, sw.fileToRun, script)
  }

  onScriptReady(script, url)
  setEditorFiles(sw.filesToCheck)
}

/**
 * Handle file drop
 * @param {DataTransfer} dataTransfer
 * @param {FileSystemDeps} deps
 */
export async function handleFileDrop(dataTransfer, deps) {
  const { setEditorFiles, setError, onFilesChange } = deps

  try {
    const files = await extractEntries(dataTransfer)
    if (!files.length) return

    await resetFileRefs(setEditorFiles)
    if (!sw) await initFs(deps)
    await fileDropped(sw, files)
    onFilesChange()
  } catch (error) {
    setError(error)
    console.error(error)
  }
}

/**
 * Get the current service worker handler
 * @returns {SwHandler | undefined}
 */
export function getSwHandler() {
  return sw
}

/**
 * Add content to cache
 * @param {string} path
 * @param {string} content
 */
export async function addToCacheWrapper(path, content) {
  if (sw) {
    await addToCache(sw.cache, path, content)
  }
}

/**
 * Get the save map (file handle references)
 * @returns {Object.<string, FileSystemFileHandle>}
 */
export function getSaveMap() {
  return saveMap
}

/**
 * Set a file handle in the save map
 * @param {string} path
 * @param {FileSystemFileHandle} handle
 */
export function setSaveMapEntry(path, handle) {
  saveMap[path] = handle
}

/**
 * Create file watcher interval
 * H2 fix: Returns cleanup function instead of relying solely on beforeunload
 * @param {(files: string[]) => void} onFilesChanged
 * @param {() => void} runScript
 * @returns {{ interval: NodeJS.Timeout, cleanup: () => void }}
 */
export function createFileWatcher(onFilesChanged, runScript) {
  const interval = setInterval(async () => {
    for (const p in saveMap) {
      const handle = saveMap[p]
      try {
        const file = await handle.getFile()
        if (file.lastModified > handle.lastMod) {
          handle.lastMod = file.lastModified
          await onFilesChanged([file])
          runScript()
        }
      } catch (err) {
        // H3 fix: Handle errors in file watching (file may have been deleted)
        console.warn('Error checking file:', p, err)
      }
    }
  }, 500)

  // Cleanup function that can be called explicitly
  const cleanup = () => {
    clearInterval(interval)
  }

  // Also clean up on page unload as fallback
  window.addEventListener('beforeunload', cleanup)

  return { interval, cleanup }
}

/**
 * Setup drag and drop handlers
 * @param {HTMLElement} dropModal
 * @param {(deps: FileSystemDeps) => Promise<void>} onDrop
 */
export function setupDragDrop(dropModal, onDrop) {
  /** @type {number | NodeJS.Timeout | undefined} */
  let showDropTimer

  const showDrop = (show) => {
    clearTimeout(showDropTimer)
    dropModal.style.display = show ? 'initial' : 'none'
  }

  document.body.addEventListener('drop', async ev => {
    ev.preventDefault()
    if (ev.dataTransfer === null) return
    showDrop(false)
    await onDrop(ev.dataTransfer)
  })

  document.body.addEventListener('dragover', ev => {
    ev.preventDefault()
    showDrop(true)
  })

  const dragEndOrLeave = () => {
    clearTimeout(showDropTimer)
    showDropTimer = setTimeout(() => {
      showDrop(false)
    }, 300)
  }

  document.body.addEventListener('dragend', dragEndOrLeave)
  document.body.addEventListener('dragleave', dragEndOrLeave)
}
