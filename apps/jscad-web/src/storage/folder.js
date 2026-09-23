// Linked-folder storage: the same interface as cloud.js, backed by a
// FileSystemDirectoryHandle the user picked once. The folder holds one
// project; its files are the model files, and a dotfile carries the name,
// entry and conversation. Versions are deliberately absent — history lives in
// the folder's own git, so this mode invents no snapshot rows.
import { kindFromEntry } from './local.js'
import { LEGACY_META_PATH, META_PATH, isMetaPath } from './meta.js'
import { exportZip, importZip } from './zip.js'

export class FolderNotLinkedError extends Error {
  constructor() {
    super('folder storage: no folder linked yet')
    this.name = 'FolderNotLinkedError'
  }
}

export class FolderStaleError extends Error {
  constructor() {
    super('folder storage: the linked handle no longer resolves; link the folder again')
    this.name = 'FolderStaleError'
  }
}

export class FolderPermissionError extends Error {
  constructor() {
    super('folder storage: read-write permission was denied; grant access and link again')
    this.name = 'FolderPermissionError'
  }
}

export class FolderUnsupportedError extends Error {
  constructor() {
    super('folder storage: this browser has no showDirectoryPicker')
    this.name = 'FolderUnsupportedError'
  }
}

export const isFolderStorageSupported = () =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window

// Handle persistence behind a seam: real handles are structured-cloneable so
// IndexedDB holds them across sessions; tests inject the memory version.
export function createMemoryPersistence() {
  let handle
  return {
    async load() {
      return handle
    },
    async save(next) {
      handle = next
    },
    __replace(next) {
      handle = next
    },
  }
}

export function createIdbPersistence(dbName = 'jscad-studio-folder') {
  const open = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('handles')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  const run = async (mode, fn) => {
    const db = await open()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', mode)
        const req = fn(tx.objectStore('handles'))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    } finally {
      db.close()
    }
  }
  return {
    load: () => run('readonly', (store) => store.get('linked-folder')),
    save: (handle) => run('readwrite', (store) => store.put(handle, 'linked-folder')),
  }
}

const isNotFound = (err) => err instanceof DOMException && err.name === 'NotFoundError'

const splitPath = (path) => {
  const parts = path.split('/').filter((p) => p !== '')
  return { dirs: parts.slice(0, -1), file: parts[parts.length - 1] }
}

export function createFolderStorage(options = {}) {
  const { persistence = createIdbPersistence() } = options
  let sessionHandle

  // Every handle use re-checks permission: the user can revoke it between
  // sessions, and a dead handle must surface as stale, not hang.
  const useHandle = async () => {
    const handle = sessionHandle ?? (await persistence.load())
    if (!handle) throw new FolderNotLinkedError()
    try {
      const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
      const state = granted ? 'granted' : await handle.requestPermission({ mode: 'readwrite' })
      if (state !== 'granted') throw new FolderPermissionError()
    } catch (err) {
      if (err instanceof FolderPermissionError) throw err
      throw new FolderStaleError()
    }
    sessionHandle = handle
    return handle
  }

  const readMeta = async (handle) => {
    for (const path of [META_PATH, LEGACY_META_PATH]) {
      try {
        const fileHandle = await handle.getFileHandle(path)
        return JSON.parse(await (await fileHandle.getFile()).text())
      } catch (err) {
        if (!isNotFound(err)) throw new FolderStaleError()
      }
    }
    return {}
  }

  const writeMeta = async (handle, meta) => {
    try {
      const fileHandle = await handle.getFileHandle(META_PATH, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(JSON.stringify(meta))
      await writable.close()
    } catch (err) {
      if (isNotFound(err)) throw new FolderStaleError()
      throw err
    }
  }

  const dirFor = async (handle, dirs, create) => {
    let dir = handle
    for (const name of dirs) dir = await dir.getDirectoryHandle(name, { create })
    return dir
  }

  const collectFiles = async (handle) => {
    const files = {}
    const walk = async (dir, prefix) => {
      for await (const entry of dir.values()) {
        if (entry.kind === 'file') {
          const path = `${prefix}${entry.name}`
          if (isMetaPath(path)) continue
          files[path] = await (await entry.getFile()).text()
        } else if (entry.kind === 'directory') {
          await walk(entry, `${prefix}${entry.name}/`)
        }
      }
    }
    try {
      await walk(handle, '')
    } catch (err) {
      if (isNotFound(err)) throw new FolderStaleError()
      throw err
    }
    return files
  }

  const link = async (handle) => {
    if (!handle || handle.kind !== 'directory') throw new FolderStaleError()
    sessionHandle = handle
    // Permission is verified through the same path every operation uses, so a
    // denied pick fails here instead of on the first read.
    await useHandle()
    await persistence.save(handle)
    return { name: handle.name }
  }

  const readProject = async () => {
    const handle = await useHandle()
    const meta = await readMeta(handle)
    const entry = meta.entry ?? 'main.js'
    const files = await collectFiles(handle)
    return {
      id: 'folder',
      name: meta.name ?? handle.name,
      entry,
      kind: kindFromEntry(entry),
      mode: 'folder',
      files,
    }
  }

  const listProjects = async () => {
    const { id, name, entry, kind, mode } = await readProject()
    return [{ id, name, entry, kind, mode }]
  }

  const writeFiles = async (id, files, options = {}) => {
    const handle = await useHandle()
    const meta = await readMeta(handle)
    const entry = options.entry ?? meta.entry ?? 'main.js'
    const name = options.name ?? meta.name ?? handle.name
    try {
      for (const [path, content] of Object.entries(files)) {
        const { dirs, file } = splitPath(path)
        const dir = await dirFor(handle, dirs, true)
        const fileHandle = await dir.getFileHandle(file, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(content)
        await writable.close()
      }
    } catch (err) {
      if (isNotFound(err)) throw new FolderStaleError()
      throw err
    }
    await writeMeta(handle, { ...meta, name, entry })
    void id
    return { id: 'folder', entry, kind: kindFromEntry(entry) }
  }

  const readConversation = async () => {
    const meta = await readMeta(await useHandle())
    if (!meta.messages) return null
    return { messages: meta.messages, updated: meta.updated ?? 0 }
  }

  const writeConversation = async (projectId, messages) => {
    const handle = await useHandle()
    const meta = await readMeta(handle)
    await writeMeta(handle, { ...meta, messages, updated: Date.now() })
    void projectId
  }

  const api = {
    link,
    // Folder contents are the store; nothing syncs.
    sync: async () => {},
    listProjects,
    readProject,
    writeFiles,
    // Snapshots belong to the folder's own git; this mode rows none.
    listVersions: async () => [],
    readVersion: async () => {
      throw new Error("folder storage keeps no snapshots; read history from the folder's own git")
    },
    readConversation,
    writeConversation,
  }
  return {
    ...api,
    exportZip: (id) => exportZip(api, id),
    importZip: (file) => importZip(api, file),
  }
}
