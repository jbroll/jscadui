import { projectPathOf, toEditorFiles } from './projectFiles.js'

// The launcher's model directory, as the disk store names its one project.
export const DISK_ID = 'disk'

const MODELS_HASH = /^#\/models\/(.+)$/

/**
 * The entry a launcher page names in its `#/models/<entry>` hash, or null.
 * @param {string} hash
 */
export const diskEntryFromHash = (hash) => {
  const match = MODELS_HASH.exec(hash)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/**
 * Where an export of the entry lands: its base name, the format's extension, at the directory's root.
 * @param {string} entry
 * @param {string} format
 */
export const exportPath = (entry, format) => {
  const base = entry.split('/').pop() ?? entry
  const dot = base.lastIndexOf('.')
  return `${dot > 0 ? base.slice(0, dot) : base}.${format}`
}

/**
 * The model directory as the open project: opening it, saving into it, and
 * following edits made to it outside the app.
 * @param {{
 *   store: ReturnType<typeof import('./storage/disk.js').createDiskStorage>,
 *   switchProject: (id:string) => Promise<void>,
 *   isOpen: () => boolean,
 *   getEntry: () => string|undefined,
 *   fileSystem: {
 *     addToCacheWrapper: (path:string, content:unknown) => Promise<void>,
 *     removeFromCache: (path:string) => Promise<void>,
 *     projectFiles: () => Promise<Record<string, unknown>>,
 *   },
 *   clearFileCache: (paths:string[]) => Promise<unknown>,
 *   editor: {
 *     getSource: () => string,
 *     getPath: () => string,
 *     setSource: (source:string, path:string) => void,
 *     setFiles: (files:File[]) => void,
 *   },
 *   rebuild: () => unknown,
 *   warn?: (...args:unknown[]) => void,
 * }} deps
 */
export const createDiskProject = ({ store, switchProject, isOpen, getEntry, fileSystem, clearFileCache, editor, rebuild, warn = console.warn }) => {
  let stopWatch = null
  let queue = Promise.resolve()

  const refreshEditorList = async () => editor.setFiles(toEditorFiles(await fileSystem.projectFiles()))

  /** @param {{ changed: Record<string, string|Uint8Array>, removed: string[] }} change */
  const apply = async ({ changed, removed }) => {
    if (!isOpen()) return
    const editorPath = editor.getPath()
    const open = projectPathOf(editorPath)
    // The editor's runs write its buffer to the cache, so a buffer that differs from it holds unsaved edits.
    const clean = open !== null && (await fileSystem.projectFiles())[open] === editor.getSource()
    for (const [path, content] of Object.entries(changed)) await fileSystem.addToCacheWrapper(path, content)
    for (const path of removed) await fileSystem.removeFromCache(path)
    await clearFileCache([...Object.keys(changed), ...removed])
    await refreshEditorList()
    if (open !== null && Object.hasOwn(changed, open)) {
      const content = changed[open]
      if (clean && typeof content === 'string') editor.setSource(content, editorPath)
      else warn(`${open} changed on disk; the editor keeps your unsaved edits, and running or saving them overwrites the file`)
    } else if (open !== null && removed.includes(open)) {
      warn(`${open} was removed on disk; saving it from the editor writes it back`)
    }
    rebuild()
  }

  return {
    /** @param {string} entry */
    open: async (entry) => {
      await store.writeFiles(DISK_ID, {}, { entry })
      await switchProject(DISK_ID)
      stopWatch ??= store.watch((change) => {
        queue = queue.then(() => apply(change)).catch((err) => warn('disk project: applying a change from disk failed', err))
      })
    },

    /**
     * Write an editor file into the directory; false when the directory is not the open project or the path is no project file.
     * @param {string} path
     * @param {string} content
     */
    save: async (path, content) => {
      const file = projectPathOf(path)
      if (!isOpen() || file === null) return false
      await store.writeFiles(DISK_ID, { [file]: content })
      return true
    },

    /**
     * Write an export beside the model and answer its path; undefined when the directory is not the open project.
     * @param {string} format
     * @param {Uint8Array} bytes
     */
    saveExport: async (format, bytes) => {
      const entry = getEntry()
      if (!isOpen() || !entry) return undefined
      const path = exportPath(entry, format)
      await store.writeFile(path, bytes)
      await fileSystem.addToCacheWrapper(path, bytes)
      await clearFileCache([path])
      await refreshEditorList()
      return path
    },

    stop: () => {
      stopWatch?.()
      stopWatch = null
    },
  }
}
