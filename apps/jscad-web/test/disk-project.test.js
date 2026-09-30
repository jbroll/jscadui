// The launcher's disk project wired as main.js wires it: the real project
// manager, session and disk store over a fake /api/fs, a memory file cache and
// a fake editor.
import { describe, expect, it, vi } from 'vitest'
import { createProjectTools } from '../src/aiDeps.js'
import { createExport } from '../src/aiExport.js'
import { createDiskProject, diskEntryFromHash, exportPath } from '../src/diskProject.js'
import { createProjectSwitch } from '../src/projectFiles.js'
import { createDiskStorage } from '../src/storage/disk.js'
import { createLocalStorage } from '../src/storage/local.js'
import { createProjectManager } from '../src/storage/projects.js'
import { createSession } from '../src/storage/session.js'
import { fakeServer } from './fakeDiskServer.js'

const MAIN = "const { part } = require('./lib/part.js')\nconst main = () => part()\nmodule.exports = { main }\n"
const STL = new Uint8Array([0x73, 0x6f, 0x6c, 0x00, 0xff])

const memoryFileSystem = () => {
  const cache = new Map()
  return {
    cache,
    clearProjectCache: async () => cache.clear(),
    addToCacheWrapper: async (path, content) => { cache.set(path, content) },
    removeFromCache: async (path) => { cache.delete(path) },
    projectFiles: async () => Object.fromEntries(cache),
  }
}

const fakeEditor = () => {
  const editor = {
    source: '',
    path: 'jscad.example.js',
    setSource: vi.fn((source, path) => { editor.source = source; editor.path = path }),
    getSource: () => editor.source,
    getPath: () => editor.path,
    setFiles: vi.fn(),
  }
  return editor
}

const setup = (seed = { 'main.js': MAIN, 'lib/part.js': 'p', 'part.stl': STL }) => {
  const server = fakeServer(seed)
  const disk = createDiskStorage({ fetch: server.fetch, EventSource: server.EventSource })
  const local = createLocalStorage()
  const manager = createProjectManager({ local, disk, getRowboat: () => null })
  const session = createSession({ local, disk, getBackend: (id) => manager.peekMode(id) })
  const fileSystem = memoryFileSystem()
  const editor = fakeEditor()
  const state = { projectId: 'default', entry: undefined }
  const build = vi.fn(async () => ({}))
  const switchProject = createProjectSwitch({
    manager,
    fileSystem,
    editor,
    clearTempCache: () => {},
    build,
    onOpen: (id, entry) => { state.projectId = id; state.entry = entry },
    onError: (err) => { throw err },
  })
  let rebuilt
  const rebuild = vi.fn(async () => rebuilt?.())
  const nextRebuild = () => new Promise((resolve) => { rebuilt = resolve })
  const clearFileCache = vi.fn(async () => {})
  const warn = vi.fn()
  const project = createDiskProject({
    store: disk,
    switchProject,
    isOpen: () => state.projectId === 'disk',
    getEntry: () => state.entry,
    fileSystem,
    clearFileCache,
    editor,
    rebuild,
    warn,
  })
  return { server, disk, local, manager, session, fileSystem, editor, state, build, switchProject, project, rebuild, nextRebuild, clearFileCache, warn }
}

describe('diskEntryFromHash', () => {
  it('reads the entry from a /models/ hash, decoded', () => {
    expect(diskEntryFromHash('#/models/main.js')).toBe('main.js')
    expect(diskEntryFromHash('#/models/my%20part.js')).toBe('my part.js')
    expect(diskEntryFromHash('#/models/100%.js')).toBe('100%.js')
  })

  it('is null for any other hash', () => {
    expect(diskEntryFromHash('')).toBeNull()
    expect(diskEntryFromHash('#')).toBeNull()
    expect(diskEntryFromHash('#https://example.com/model.js')).toBeNull()
    expect(diskEntryFromHash('#/models/')).toBeNull()
  })
})

describe('exportPath', () => {
  it("names the export after the entry's base name, in the directory's root", () => {
    expect(exportPath('main.js', 'stl')).toBe('main.stl')
    expect(exportPath('parts/gear.v2.js', '3mf')).toBe('gear.v2.3mf')
    expect(exportPath('model', 'obj')).toBe('model.obj')
  })
})

describe('opening the directory', () => {
  it('fills the file cache, the editor and the open project, and builds the entry', async () => {
    const s = setup()
    await s.project.open('main.js')
    const files = await s.fileSystem.projectFiles()
    expect(Object.keys(files).sort()).toEqual(['lib/part.js', 'main.js', 'part.stl'])
    expect(files['main.js']).toBe(MAIN)
    expect(s.state).toEqual({ projectId: 'disk', entry: 'main.js' })
    expect(s.editor.source).toBe(MAIN)
    expect(s.editor.path).toBe('main.js')
    expect(s.editor.setFiles.mock.calls.at(-1)[0].map((f) => f.fullPath).sort()).toEqual(['/lib/part.js', '/main.js', '/part.stl'])
    expect(s.build).toHaveBeenCalledWith('main.js')
  })

  it('keeps a binary file as bytes, so a require of it gets the bytes', async () => {
    const s = setup()
    await s.project.open('main.js')
    const stl = (await s.fileSystem.projectFiles())['part.stl']
    expect(stl).toBeInstanceOf(Uint8Array)
    expect([...stl]).toEqual([...STL])
  })

  it('opens on the entry the hash names', async () => {
    const s = setup({ 'main.js': 'm', 'other.js': 'o' })
    await s.project.open('other.js')
    expect(s.state.entry).toBe('other.js')
    expect(s.editor.source).toBe('o')
    expect(s.build).toHaveBeenCalledWith('other.js')
  })

  it("serves the agent's list and read from the directory", async () => {
    const s = setup()
    await s.project.open('main.js')
    const tools = chatTools(s)
    expect((await tools.list()).files.map((f) => f.path)).toEqual(['lib/part.js', 'main.js', 'part.stl'])
    expect(await tools.read({ path: 'lib/part.js' })).toContain('p')
  })
})

const chatTools = (s) =>
  createProjectTools({
    getProjectFiles: () => s.fileSystem.projectFiles(),
    writeProjectFile: (path, content) => s.fileSystem.addToCacheWrapper(path, content),
    showFile: () => {},
    build: async () => ({ ok: true, entry: 'main.js' }),
    noGeometry: async () => null,
    workerApi: {},
    exportModel: createExport(async () => ({ data: [new Uint8Array([1, 2, 3]).buffer] }), { save: s.project.saveExport }),
    getProjectId: () => s.state.projectId,
    storeFile: (projectId, path, content) => s.session.writeThrough(projectId, path, content, { message: 'chat', version: false }),
    snapshot: (projectId) => s.session.snapshot(projectId, { message: 'chat' }),
  })

describe('chat in the directory', () => {
  it('writes and edits land on disk, and the turn ends without a snapshot', async () => {
    const s = setup()
    await s.project.open('main.js')
    s.server.clear()
    const tools = chatTools(s)
    await tools.write({ path: 'lib/part.js', content: 'p2' })
    await tools.edit({ path: 'main.js', oldString: 'part()', newString: 'part(2)' })
    expect(s.server.puts()).toEqual(['/api/fs/lib/part.js', '/api/fs/main.js'])
    expect(s.server.text('lib/part.js')).toBe('p2')
    expect(s.server.text('main.js')).toContain('part(2)')
    await expect(tools.endTurn()).resolves.toBeUndefined()
    expect(await s.local.listProjects()).toEqual([])
  })

  it('export writes <entry base name>.<format> into the directory and reports its path', async () => {
    const s = setup()
    await s.project.open('main.js')
    const result = await chatTools(s).exportModel({ format: 'stl' })
    expect(result).toEqual({ ok: true, format: 'stl', size: 3, path: 'main.stl' })
    expect([...s.server.files.get('main.stl').bytes]).toEqual([1, 2, 3])
    expect([...(await s.fileSystem.projectFiles())['main.stl']]).toEqual([1, 2, 3])
  })

  it('export writes nothing while another project is open', async () => {
    const s = setup()
    await s.project.open('main.js')
    s.state.projectId = 'p1'
    s.server.clear()
    expect(await s.project.saveExport('stl', new Uint8Array([1]))).toBeUndefined()
    expect(s.server.puts()).toEqual([])
  })
})

describe('editor save', () => {
  it('writes the open file through the store', async () => {
    const s = setup()
    await s.project.open('main.js')
    s.server.clear()
    expect(await s.project.save('/lib/part.js', 'saved')).toBe(true)
    expect(s.server.puts()).toEqual(['/api/fs/lib/part.js'])
    expect(s.server.text('lib/part.js')).toBe('saved')
  })

  it('declines a path that is not a project file, or another open project', async () => {
    const s = setup()
    await s.project.open('main.js')
    s.server.clear()
    expect(await s.project.save('http://localhost:7377/examples/a.js', 'x')).toBe(false)
    s.state.projectId = 'p1'
    expect(await s.project.save('main.js', 'x')).toBe(false)
    expect(s.server.puts()).toEqual([])
  })
})

describe('changes made outside the app', () => {
  it('update the cache, the frame and the editor list, and rebuild', async () => {
    const s = setup()
    await s.project.open('main.js')
    s.editor.setFiles.mockClear()
    s.server.put('lib/part.js', 'outside')
    s.server.put('lib/new.js', 'n')
    const rebuilt = s.nextRebuild()
    s.server.sources[0].emit(['lib/part.js', 'lib/new.js'])
    await rebuilt
    const files = await s.fileSystem.projectFiles()
    expect(files['lib/part.js']).toBe('outside')
    expect(files['lib/new.js']).toBe('n')
    expect(s.clearFileCache.mock.calls[0][0].sort()).toEqual(['lib/new.js', 'lib/part.js'])
    expect(s.editor.setFiles.mock.calls[0][0].map((f) => f.fullPath)).toContain('/lib/new.js')
    expect(s.editor.source).toBe(MAIN)
  })

  it('drop a removed file from the cache', async () => {
    const s = setup()
    await s.project.open('main.js')
    s.server.remove('part.stl')
    const rebuilt = s.nextRebuild()
    s.server.sources[0].emit(['part.stl'])
    await rebuilt
    expect(Object.keys(await s.fileSystem.projectFiles())).not.toContain('part.stl')
    expect(s.clearFileCache.mock.calls[0][0]).toEqual(['part.stl'])
  })

  it('reload the open file when the buffer has no unsaved edits', async () => {
    const s = setup()
    await s.project.open('main.js')
    s.server.put('main.js', 'from vim')
    const rebuilt = s.nextRebuild()
    s.server.sources[0].emit(['main.js'])
    await rebuilt
    expect(s.editor.source).toBe('from vim')
    expect(s.editor.path).toBe('main.js')
    expect(s.warn).not.toHaveBeenCalled()
  })

  it('reload an open file the editor names with a leading slash', async () => {
    const s = setup()
    await s.project.open('main.js')
    s.editor.setSource('p', '/lib/part.js')
    s.server.put('lib/part.js', 'p2')
    const rebuilt = s.nextRebuild()
    s.server.sources[0].emit(['lib/part.js'])
    await rebuilt
    expect(s.editor.source).toBe('p2')
    expect(s.editor.path).toBe('/lib/part.js')
  })

  it('keep unsaved edits in the buffer and warn', async () => {
    const s = setup()
    await s.project.open('main.js')
    s.editor.source = 'typed but not run'
    s.server.put('main.js', 'from vim')
    const rebuilt = s.nextRebuild()
    s.server.sources[0].emit(['main.js'])
    await rebuilt
    expect(s.editor.source).toBe('typed but not run')
    expect((await s.fileSystem.projectFiles())['main.js']).toBe('from vim')
    expect(s.warn).toHaveBeenCalledWith(expect.stringMatching(/main\.js.*changed on disk/))
  })

  it('leave the cache alone while another project is open', async () => {
    const s = setup()
    await s.project.open('main.js')
    await s.fileSystem.clearProjectCache()
    s.state.projectId = 'p1'
    s.server.put('lib/part.js', 'outside')
    s.server.sources[0].emit(['lib/part.js'])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await s.fileSystem.projectFiles()).toEqual({})
    expect(s.rebuild).not.toHaveBeenCalled()
  })

  it('watch once however often the directory opens', async () => {
    const s = setup()
    await s.project.open('main.js')
    await s.project.open('main.js')
    expect(s.server.sources).toHaveLength(1)
  })
})
