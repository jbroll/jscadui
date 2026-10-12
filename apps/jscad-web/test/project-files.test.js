import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { collectProjectFiles, createProjectSwitch, defaultProjectFiles, isBinaryPath, isRecordablePath, loadSource, pickBootProject, projectPathOf, replaceProjectFiles, shouldRestoreBootProject, toEditorFiles } from '../src/projectFiles.js'

// Mirrors what the real Cache API does: addToCache() calls cache.put(new
// Request(path), ...) with a leading-slash, project-relative path, which
// resolves against the document origin with no swfs segment at all.
const fakeSw = (entries) => ({
  base: 'http://localhost:5120/swfs/',
  cache: {
    keys: async () => Object.keys(entries).map((path) => ({ url: new URL(`/${path}`, 'http://localhost:5120/').href })),
    match: async (request) => {
      const path = new URL(request.url ?? request).pathname.replace(/^\//, '')
      const body = entries[path]
      return {
        text: async () => String(body),
        arrayBuffer: async () => (body instanceof ArrayBuffer ? body : new TextEncoder().encode(String(body)).buffer),
      }
    },
  },
})

describe('collectProjectFiles', () => {
  it('reads text entries as strings keyed by path', async () => {
    const files = await collectProjectFiles(fakeSw({ 'main.js': 'export const a = 1', 'lib/part.js': 'x' }))
    expect(files['main.js']).toBe('export const a = 1')
    expect(files['lib/part.js']).toBe('x')
  })

  it('reads binary entries as ArrayBuffer', async () => {
    const files = await collectProjectFiles(fakeSw({ 'part.stl': new ArrayBuffer(4) }))
    expect(files['part.stl']).toBeInstanceOf(ArrayBuffer)
  })

  it('returns an empty map with no handler', async () => {
    expect(await collectProjectFiles(undefined)).toEqual({})
  })

  it('keys carry no leading slash', async () => {
    const files = await collectProjectFiles(fakeSw({ 'index.js': 'x' }))
    expect(Object.keys(files)).toEqual(['index.js'])
    expect(files['/index.js']).toBeUndefined()
  })
})

describe('isBinaryPath', () => {
  it('classifies by extension', () => {
    expect(isBinaryPath('a/b/part.stl')).toBe(true)
    expect(isBinaryPath('fonts/Sans.ttf')).toBe(true)
    expect(isBinaryPath('fonts/Sans.OTF')).toBe(true)
    expect(isBinaryPath('a/b/model.js')).toBe(false)
  })
})

describe('replaceProjectFiles', () => {
  const fakeFileSystem = () => {
    const cached = new Map()
    return {
      cached,
      clearProjectCache: async () => cached.clear(),
      addToCacheWrapper: async (path, content) => { cached.set(path, content) },
    }
  }

  it('leaves the previous project out of the cache', async () => {
    const fs = fakeFileSystem()
    await replaceProjectFiles(fs, { 'main.js': 'first', 'only-in-first.js': 'x' })
    await replaceProjectFiles(fs, { 'main.js': 'second' })

    expect([...fs.cached.keys()]).toEqual(['main.js'])
    expect(fs.cached.get('main.js')).toBe('second')
  })

  it('clears before it writes', async () => {
    const order = []
    const fs = {
      clearProjectCache: async () => order.push('clear'),
      addToCacheWrapper: async (path) => order.push(`add ${path}`),
    }
    await replaceProjectFiles(fs, { 'a.js': '', 'b.js': '' })
    expect(order).toEqual(['clear', 'add a.js', 'add b.js'])
  })
})

describe('createProjectSwitch', () => {
  it('fills the cache and the editor with the project, then builds its entry', async () => {
    const cached = new Map([['stale.js', 'x']])
    const fileSystem = {
      clearProjectCache: async () => cached.clear(),
      addToCacheWrapper: async (path, content) => { cached.set(path, content) },
    }
    const editor = { setFiles: vi.fn(), setSource: vi.fn() }
    const files = { 'main.js': 'm', 'lib/part.js': 'p' }
    const manager = { readForSwitch: async () => ({ project: { entry: 'main.js', name: 'Gear' }, files }) }
    const opened = vi.fn()
    const build = vi.fn(async () => ({}))
    const clearTempCache = vi.fn()
    await createProjectSwitch({ manager, fileSystem, editor, clearTempCache, build, onOpen: opened, onError: vi.fn() })('p1')
    expect(opened).toHaveBeenCalledWith('p1', 'main.js', 'Gear')
    expect(clearTempCache).toHaveBeenCalled()
    expect(Object.fromEntries(cached)).toEqual(files)
    expect(editor.setFiles.mock.calls[0][0].map((f) => f.fullPath)).toEqual(['/main.js', '/lib/part.js'])
    expect(editor.setSource).toHaveBeenCalledWith('m', 'main.js')
    expect(build).toHaveBeenCalledWith('main.js')
  })

  it('aborts the switch when the editor refuses to discard', async () => {
    const editor = { setFiles: vi.fn(), setSource: vi.fn(), confirmDiscard: async () => false }
    const manager = { readForSwitch: vi.fn() }
    const onOpen = vi.fn()
    await createProjectSwitch({ manager, fileSystem: { clearProjectCache: async () => {}, addToCacheWrapper: async () => {} }, editor, clearTempCache: vi.fn(), build: vi.fn(), onOpen, onError: vi.fn() })('p1')
    expect(manager.readForSwitch).not.toHaveBeenCalled()
    expect(editor.setFiles).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('toEditorFiles', () => {
  it('names each file by its leading-slash path and keeps binary bytes', async () => {
    const [text, bin] = toEditorFiles({ 'lib/part.js': 'p', 'part.stl': new Uint8Array([0, 1]) })
    expect(text.name).toBe('part.js')
    expect(text.fullPath).toBe('/lib/part.js')
    expect(await text.text()).toBe('p')
    expect([...new Uint8Array(await bin.arrayBuffer())]).toEqual([0, 1])
  })
})

describe('projectPathOf', () => {
  it('names a project file by its bare path', () => {
    expect(projectPathOf('main.js')).toBe('main.js')
    expect(projectPathOf('/lib/gear.js')).toBe('lib/gear.js')
  })

  it('is null for an example or a remote script, which is not a project file', () => {
    expect(projectPathOf('http://localhost:5120/examples/jscad/01-two-cars.example.js')).toBeNull()
    expect(projectPathOf('https://example.com/model.js')).toBeNull()
  })
})

describe('isRecordablePath', () => {
  it('marks URL scripts unrecordable and project paths recordable', () => {
    expect(isRecordablePath('main.js')).toBe(true)
    expect(isRecordablePath('/parts/gear.js')).toBe(true)
    expect(isRecordablePath('http://localhost:5120/examples/jscad/01-two-cars.example.js')).toBe(false)
    expect(isRecordablePath('https://example.com/model.js')).toBe(false)
    expect(isRecordablePath('data:application/gzip;base64,AAA')).toBe(false)
  })
})

describe('loadSource', () => {
  it('labels project urls with the project and leaves other urls alone', () => {
    expect(loadSource({ url: 'http://project.local/main.js', projectId: 'abc' })).toBe('project:abc')
    expect(loadSource({ url: 'http://project.local/parts/gear.js', projectId: 'abc' })).toBe('project:abc')
    expect(loadSource({ url: 'https://example.com/model.js', projectId: 'abc' })).toBe('https://example.com/model.js')
    expect(loadSource({ url: 'data:application/gzip;base64,AAA', projectId: 'abc' })).toBe('data:application/gzip;base64,AAA')
  })
})

describe('pickBootProject', () => {
  it('returns the first (most recently updated) non-disk project', () => {
    expect(pickBootProject([{ id: 'a', mode: 'local' }, { id: 'b', mode: 'rowboat' }])).toBe('a')
  })

  it('skips the disk row, which sorts first and is opened by its own hash', () => {
    expect(pickBootProject([{ id: 'disk', mode: 'disk' }, { id: 'b', mode: 'local' }])).toBe('b')
  })

  it('is null with no projects or only the disk project', () => {
    expect(pickBootProject([])).toBeNull()
    expect(pickBootProject([{ id: 'disk', mode: 'disk' }])).toBeNull()
  })
})

describe('shouldRestoreBootProject', () => {
  const stored = [{ id: 'a', mode: 'local' }]

  it('skips the restore when a hash route already loaded its own script', () => {
    expect(shouldRestoreBootProject({ hasRemoteScript: true, diskEntry: null, projects: stored })).toBe(false)
  })

  it('skips the restore when a launcher disk entry is opening', () => {
    expect(shouldRestoreBootProject({ hasRemoteScript: false, diskEntry: 'src/main.js', projects: stored })).toBe(false)
  })

  it('restores the most recent stored project when no URL drives the load', () => {
    expect(shouldRestoreBootProject({ hasRemoteScript: false, diskEntry: null, projects: stored })).toBe(true)
  })

  it('restores nothing when there is no stored project', () => {
    expect(shouldRestoreBootProject({ hasRemoteScript: false, diskEntry: null, projects: [] })).toBe(false)
  })
})

describe('defaultProjectFiles', () => {
  const read = (name) => readFileSync(new URL(`../examples/jscad/${name}`, import.meta.url), 'utf8')
  const seed = () => defaultProjectFiles({ main: read('01-two-cars.example.js'), hierarchicalCar: read('02-hierarchical-car.example.js') })

  it('seeds main.js with the default example and its required sibling under the spec it requires', () => {
    const main = read('01-two-cars.example.js')
    const files = seed()
    const [, , spec] = main.match(/require\((['"])\.\/(.+?)\1\)/)
    expect(files['main.js']).toBe(main)
    expect(files[spec]).toBe(read('02-hierarchical-car.example.js'))
  })

  it('resolves every relative require in the seeded project so it builds off its own URL', () => {
    const files = seed()
    const relative = []
    for (const source of Object.values(files)) {
      for (const match of source.matchAll(/require\(\s*(['"])\.\/(.+?)\1\s*\)/g)) relative.push(match[2])
    }
    expect(relative.length).toBeGreaterThan(0)
    for (const spec of relative) expect(Object.keys(files)).toContain(spec)
  })
})
