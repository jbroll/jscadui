// Project manager over two fake backends: the second local instance stands
// in for the rowboat store, so no test needs a live server.
import { describe, expect, it } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { createProjectManager } from '../src/storage/projects.js'

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
})
