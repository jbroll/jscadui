// Folder storage against fake FileSystem handles: the adapter never touches a
// real picker, so every case runs in plain vitest. Persistence is an injected
// seam (memory here); the default IndexedDB persistence needs a real browser.
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  FolderNotLinkedError,
  FolderPermissionError,
  FolderStaleError,
  createFolderStorage,
  createMemoryPersistence,
  isFolderStorageSupported,
} from '../src/storage/folder.js'

function fakeFile(name, content = '') {
  let text = content
  return {
    kind: 'file',
    name,
    getFile: async () => ({ text: async () => text }),
    createWritable: async () => ({
      write: async (data) => {
        text = String(data)
      },
      close: async () => {},
    }),
  }
}

function fakeDir(name, options = {}) {
  const { permission = 'granted', stale = false } = options
  const entries = new Map()
  let state = permission
  const failIfStale = () => {
    if (stale) throw new DOMException('handle is stale', 'NotFoundError')
  }
  const dir = {
    kind: 'directory',
    name,
    queryPermission: async () => {
      failIfStale()
      return state
    },
    requestPermission: async () => {
      failIfStale()
      return state
    },
    values: async function* () {
      failIfStale()
      yield* entries.values()
    },
    getFileHandle: async (fileName, opts) => {
      failIfStale()
      if (!entries.has(fileName)) {
        if (!opts?.create) throw new DOMException('missing', 'NotFoundError')
        entries.set(fileName, fakeFile(fileName))
      }
      const entry = entries.get(fileName)
      if (entry.kind !== 'file') throw new DOMException('not a file', 'TypeMismatchError')
      return entry
    },
    getDirectoryHandle: async (dirName, opts) => {
      failIfStale()
      if (!entries.has(dirName)) {
        if (!opts?.create) throw new DOMException('missing', 'NotFoundError')
        entries.set(dirName, fakeDir(dirName))
      }
      return entries.get(dirName)
    },
    __seed: (fileName, content) => {
      entries.set(fileName, fakeFile(fileName, content))
    },
    __deny: () => {
      state = 'denied'
    },
  }
  return dir
}

const linked = async (dir, persistence = createMemoryPersistence()) => {
  const storage = createFolderStorage({ persistence })
  await storage.link(dir)
  return { storage, persistence }
}

describe('linked folder storage', () => {
  it('reads back written files with name, entry and kind', async () => {
    const { storage } = await linked(fakeDir('parts'))
    await storage.writeFiles('ignored', { 'main.js': 'cube(5);' }, { name: 'Bracket', entry: 'main.js' })
    const project = await storage.readProject('ignored')
    expect(project.files).toEqual({ 'main.js': 'cube(5);' })
    expect(project.name).toBe('Bracket')
    expect(project.entry).toBe('main.js')
    expect(project.kind).toBe('jscad')
  })

  it('updates written files without touching the others', async () => {
    const { storage } = await linked(fakeDir('parts'))
    await storage.writeFiles('x', { 'a.js': 'one', 'b.js': 'two' }, { entry: 'a.js' })
    await storage.writeFiles('x', { 'b.js': 'three' }, { entry: 'a.js' })
    const project = await storage.readProject('x')
    expect(project.files).toEqual({ 'a.js': 'one', 'b.js': 'three' })
  })

  it('round-trips nested paths', async () => {
    const { storage } = await linked(fakeDir('parts'))
    await storage.writeFiles('x', { 'main.js': 'm', 'lib/teeth.js': 't' }, { entry: 'main.js' })
    expect((await storage.readProject('x')).files).toEqual({ 'main.js': 'm', 'lib/teeth.js': 't' })
  })

  it('derives kind from the entry extension', async () => {
    const { storage } = await linked(fakeDir('parts'))
    await storage.writeFiles('x', { 'part.scad': 'cube(5);' }, { entry: 'part.scad' })
    expect((await storage.readProject('x')).kind).toBe('openscad')
  })

  it('lists the linked folder as its single project', async () => {
    const { storage } = await linked(fakeDir('parts'))
    await storage.writeFiles('x', { 'main.js': 'm' }, { name: 'Parts', entry: 'main.js' })
    const projects = await storage.listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ name: 'Parts', entry: 'main.js' })
  })

  it('throws a named error when permission is denied', async () => {
    const dir = fakeDir('parts')
    dir.__deny()
    const storage = createFolderStorage({ persistence: createMemoryPersistence() })
    await expect(storage.link(dir)).rejects.toBeInstanceOf(FolderPermissionError)
  })

  it('throws a different named error for a stale handle', async () => {
    const persistence = createMemoryPersistence()
    const { storage } = await linked(fakeDir('parts'), persistence)
    await storage.writeFiles('x', { 'main.js': 'm' }, { entry: 'main.js' })
    persistence.__replace(fakeDir('parts', { stale: true }))
    // A fresh instance has no live session handle, so it loads the dead one.
    const reopened = createFolderStorage({ persistence })
    await expect(reopened.readProject('x')).rejects.toBeInstanceOf(FolderStaleError)
    await expect(reopened.readProject('x')).rejects.not.toBeInstanceOf(FolderPermissionError)
  })

  it('throws when nothing is linked yet', async () => {
    const storage = createFolderStorage({ persistence: createMemoryPersistence() })
    await expect(storage.readProject('x')).rejects.toBeInstanceOf(FolderNotLinkedError)
  })

  it('keeps no snapshots: versions are external, readVersion points at git', async () => {
    const { storage } = await linked(fakeDir('parts'))
    await storage.writeFiles('x', { 'main.js': 'm' }, { entry: 'main.js' })
    expect(await storage.listVersions('x')).toEqual([])
    await expect(storage.readVersion('x', 'anything')).rejects.toThrow(/git/)
  })

  it('reports unsupported without showDirectoryPicker', () => {
    expect(isFolderStorageSupported()).toBe(false)
  })

  it('shares the linked handle across instances on one persistence', async () => {
    const persistence = createMemoryPersistence()
    const first = createFolderStorage({ persistence })
    await first.link(fakeDir('parts'))
    await first.writeFiles('x', { 'main.js': 'shared' }, { entry: 'main.js' })
    const second = createFolderStorage({ persistence })
    expect((await second.readProject('x')).files).toEqual({ 'main.js': 'shared' })
  })

  it('exports and imports a zip over the folder interface', async () => {
    const { storage } = await linked(fakeDir('parts'))
    await storage.writeFiles('x', { 'main.js': 'm', 'lib/t.js': 't' }, { name: 'Z', entry: 'main.js' })
    const zip = await storage.exportZip('x')
    const other = createFolderStorage({ persistence: createMemoryPersistence() })
    await other.link(fakeDir('elsewhere'))
    const imported = await other.importZip(zip)
    const project = await other.readProject(imported.id)
    expect(project.files).toEqual({ 'main.js': 'm', 'lib/t.js': 't' })
    expect(project.entry).toBe('main.js')
  })
})
