// Project manager over two fake backends: the second local instance stands
// in for the rowboat store, so no test needs a live server.
import { describe, expect, it } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { createProjectManager } from '../src/storage/projects.js'
import { createDiskStorage } from '../src/storage/disk.js'
import { fakeServer } from './fakeDiskServer.js'

const stores = () => {
  const local = createLocalStorage()
  const rowboat = createLocalStorage()
  return { manager: createProjectManager({ local, getRowboat: () => rowboat }), local, rowboat }
}

describe('project manager', () => {
  it('creates a local project and lists it', async () => {
    const { manager } = stores()
    const { id } = await manager.createProject('Gear', { entry: 'main.js', files: { 'main.js': 'v1' } })
    const all = await manager.listAll()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id, name: 'Gear', mode: 'local', backend: 'local' })
  })

  it('renames without touching files', async () => {
    const { manager } = stores()
    const { id } = await manager.createProject('Old', { files: { 'main.js': 'v1' } })
    await manager.renameProject(id, 'New')
    expect((await manager.readForSwitch(id)).project.name).toBe('New')
    expect((await manager.readForSwitch(id)).files).toEqual({ 'main.js': 'v1' })
  })

  it('restores a version as a new row and keeps history', async () => {
    const local = createLocalStorage()
    const manager = createProjectManager({ local, getRowboat: () => null })
    const { id } = await manager.createProject('P', { files: { 'main.js': 'v1' }, entry: 'main.js' })
    await local.writeFiles(id, { 'main.js': 'v2' }, { message: 'two' })
    const [, first] = await manager.listVersions(id)
    const restored = await manager.restoreVersion(id, first.versionId)
    expect(restored.files).toEqual({ 'main.js': 'v1' })
    expect(await manager.listVersions(id)).toHaveLength(3)
  })

  it('flips mode by copying current files, leaving old rows behind', async () => {
    const { manager, local, rowboat } = stores()
    const { id } = await manager.createProject('P', { files: { 'main.js': 'v1' } })
    expect(await manager.flipMode(id)).toBe('rowboat')
    expect((await rowboat.readProject(id)).files).toEqual({ 'main.js': 'v1' })
    expect((await local.listVersions(id))).toHaveLength(1)
    expect(await manager.flipMode(id)).toBe('local')
    expect(manager.peekMode(id)).toBe('local')
  })

  it('merges a dropped folder as a subfolder', async () => {
    const { manager } = stores()
    const { id } = await manager.createProject('P', { files: { 'main.js': 'v1' } })
    const entries = [
      { name: 'parts', isDirectory: true, kids: [{ name: 'gear.js', isDirectory: false, text: 'gear' }] },
    ]
    const readDir = async (dir) => dir.kids
    const readAsText = async (f) => f.text
    const { added } = await manager.mergeDrop(id, entries, { readDir, readAsText })
    expect(added).toEqual(['parts/gear.js'])
    expect((await manager.readForSwitch(id)).files['parts/gear.js']).toBe('gear')
  })

  it('creates a project from a dropped folder, detecting the entry', async () => {
    const { manager } = stores()
    const entries = [
      { name: 'car', isDirectory: true, kids: [{ name: 'index.js', isDirectory: false, text: 'car' }] },
    ]
    const readDir = async (dir) => dir.kids
    const readAsText = async (f) => f.text
    const created = await manager.createFromDrop(entries, { readDir, readAsText })
    expect(created.name).toBe('car')
    expect(created.entry).toBe('car/index.js')
  })

  it("names a dropped folder's entry by agent-loop's pickEntry", async () => {
    const { manager } = stores()
    const file = (name, text = '') => ({ name, isDirectory: false, text })
    const dir = (name, kids) => ({ name, isDirectory: true, kids })
    const drop = async (kids) => (await manager.createFromDrop([dir('car', kids)], { readDir: async (d) => d.kids, readAsText: async (f) => f.text })).entry
    expect(await drop([file('car.js'), file('a.js'), file('package.json', '{"main":"src/box"}'), dir('src', [file('box.js')])])).toBe('car/src/box.js')
    expect(await drop([file('car.js'), file('main.js')])).toBe('car/main.js')
    expect(await drop([file('car.js'), file('a.js')])).toBe('car/car.js')
    expect(await drop([dir('lib', [file('a.js')]), file('z.js')])).toBe('car/z.js')
    expect(await drop([file('car.scad'), file('README.md')])).toBe('car/car.scad')
  })
})

describe('project manager with a disk directory', () => {
  const withDisk = async () => {
    const local = createLocalStorage()
    const server = fakeServer({ 'main.js': 'm', 'lib/part.js': 'p' })
    const disk = createDiskStorage({ fetch: server.fetch, EventSource: server.EventSource })
    return { local, disk, server, manager: createProjectManager({ local, disk, getRowboat: () => null }) }
  }

  it("routes the 'disk' project to the disk store", async () => {
    const { manager } = await withDisk()
    expect(manager.peekMode('disk')).toBe('disk')
    const { project, files } = await manager.readForSwitch('disk')
    expect(project).toMatchObject({ id: 'disk', mode: 'disk', entry: 'main.js' })
    expect(files).toEqual({ 'main.js': 'm', 'lib/part.js': 'p' })
  })

  it('lists the disk row first, though it has no created or updated time', async () => {
    const { manager } = await withDisk()
    await manager.createProject('A', { files: { 'main.js': 'a' } })
    await manager.createProject('B', { files: { 'main.js': 'b' } })
    const all = await manager.listAll()
    expect(all.map((p) => p.backend)).toEqual(['disk', 'local', 'local'])
    expect(all.slice(1).map((p) => p.name)).toEqual(['B', 'A'])
  })

  it('keeps the disk project on disk', async () => {
    const { manager, local } = await withDisk()
    await expect(manager.flipMode('disk')).rejects.toThrow(/disk/)
    expect(await local.listProjects()).toEqual([])
  })

  it('has no disk row without a disk store', async () => {
    const manager = createProjectManager({ local: createLocalStorage(), getRowboat: () => null })
    expect(await manager.listAll()).toEqual([])
    expect(manager.peekMode('disk')).toBe('local')
  })
})
