// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { createProjectManager } from '../src/storage/projects.js'
import { initProjects } from '../src/projects.js'

const setup = async () => {
  document.body.innerHTML = '<div id="panel"></div>'
  const local = createLocalStorage()
  const manager = createProjectManager({ local, getRowboat: () => null })
  await manager.createProject('Gear', { files: { 'main.js': 'v1' } })
  const onSwitch = vi.fn()
  const onRestore = vi.fn()
  const panel = initProjects({
    container: document.getElementById('panel'),
    manager,
    onSwitch: async (id) => { onSwitch(id); await panel.select(id) },
    onRestore,
    onError: (err) => { throw err },
    readBuffer: () => ({ code: 'buf', path: 'main.js' }),
  })
  return { manager, local, onSwitch, onRestore, panel }
}

describe('project panel', () => {
  it('lists projects with a drop-target row per project', async () => {
    await setup()
    await vi.waitFor(() => expect(document.querySelector('[data-project-id]')).not.toBeNull())
    expect(document.querySelector('.project-row').textContent).toMatch(/Gear/)
  })

  it('calls onSwitch with the project id on row click', async () => {
    const { onSwitch } = await setup()
    await vi.waitFor(() => expect(document.querySelector('.project-open')).not.toBeNull())
    document.querySelector('.project-open').click()
    await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith(expect.any(String)))
  })

  it('creates a project from the new button, seeded from the buffer', async () => {
    const { manager } = await setup()
    await vi.waitFor(() => expect(document.querySelector('.project-new')).not.toBeNull())
    document.querySelector('.project-new').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.project-row')).toHaveLength(2))
    expect(await manager.listAll()).toHaveLength(2)
    const created = (await manager.listAll()).find((p) => p.name === 'Untitled')
    expect((await manager.readForSwitch(created.id)).files).toEqual({ 'main.js': 'buf' })
  })

  it('renames a project from its row button', async () => {
    const { manager } = await setup()
    vi.stubGlobal('prompt', vi.fn(() => 'Renamed'))
    await vi.waitFor(() => expect(document.querySelector('.project-rename')).not.toBeNull())
    document.querySelector('.project-rename').click()
    await vi.waitFor(() => expect(document.querySelector('.project-row').textContent).toMatch(/Renamed/))
    const [project] = await manager.listAll()
    expect(project.name).toBe('Renamed')
    vi.unstubAllGlobals()
  })

  it('opens the project New creates', async () => {
    const { manager, onSwitch } = await setup()
    await vi.waitFor(() => expect(document.querySelector('.project-new')).not.toBeNull())
    document.querySelector('.project-new').click()
    const created = (await manager.listAll()).find((p) => p.name === 'Untitled')
    expect(created).toBeDefined()
    await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith(created.id))
    expect(document.querySelector('.project-row.selected')?.dataset.projectId).toBe(created.id)
  })
})

describe('version history', () => {
  it('lists versions newest-first with a restore button per row', async () => {
    const { manager, panel } = await setup()
    const [project] = await manager.listAll()
    await panel.select(project.id)
    await vi.waitFor(() => expect(document.querySelectorAll('.version-row').length).toBeGreaterThan(0))
    expect(document.querySelector('.version-row').textContent).toMatch(/create/)
  })

  it('restore writes a new row and calls onRestore', async () => {
    const { manager, local, panel, onRestore } = await setup()
    const [project] = await manager.listAll()
    await local.writeFiles(project.id, { 'main.js': 'v2' }, { message: 'two' })
    await panel.select(project.id)
    await vi.waitFor(() => expect(document.querySelectorAll('.version-row')).toHaveLength(2))
    document.querySelector('.version-restore').click()
    await vi.waitFor(() => expect(onRestore).toHaveBeenCalledWith(project.id))
    expect(await manager.listVersions(project.id)).toHaveLength(3)
  })

  it('shows versions for the clicked project with a highlight', async () => {
    const { manager, local, panel } = await setup()
    const [first] = await manager.listAll()
    const second = await manager.createProject('Bracket', { files: { 'main.js': 'b' } })
    await local.writeFiles(second.id, { 'main.js': 'b2' }, { message: 'second-edit' })
    // Touch the first project so it stays first-listed; rows sort by last update.
    await local.writeFiles(first.id, { 'main.js': 'v1b' }, { message: 'first-edit' })
    await panel.render()
    const rows = [...document.querySelectorAll('.project-row')]
    expect(rows).toHaveLength(2)
    rows[1].querySelector('.project-open').click()
    await vi.waitFor(() => expect(document.querySelector('.project-row.selected')).not.toBeNull())
    expect(document.querySelector('.project-row.selected').dataset.projectId).toBe(second.id)
    await vi.waitFor(() => expect(document.querySelector('.version-row')?.textContent).toMatch(/second-edit/))
  })

  it('restores the clicked project, not the first listed', async () => {
    const { manager, local, onRestore, panel } = await setup()
    const [first] = await manager.listAll()
    const second = await manager.createProject('Bracket', { files: { 'main.js': 'b' } })
    // Touch the first project so it stays first-listed; rows sort by last update.
    await local.writeFiles(first.id, { 'main.js': 'v1b' }, { message: 'first-edit' })
    await panel.render()
    const rows = [...document.querySelectorAll('.project-row')]
    rows[1].querySelector('.project-open').click()
    await vi.waitFor(() => expect(document.querySelector('.project-row.selected')).not.toBeNull())
    // Versions re-render for the clicked project; wait until the first project's rows are gone.
    await vi.waitFor(() => expect(document.querySelector('.project-versions').textContent).not.toMatch(/first-edit/))
    document.querySelector('.version-restore').click()
    await vi.waitFor(() => expect(onRestore).toHaveBeenCalledWith(second.id))
  })
})

describe('mode toggle', () => {
  it('flips the selected project and disables when rowboat is unavailable', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    const manager = createProjectManager({ local, getRowboat: () => rowboat })
    const { id } = await manager.createProject('Gear', { files: { 'main.js': 'v1' } })
    const onFlip = vi.fn()
    initProjects({
      container: document.getElementById('panel'),
      manager,
      onSwitch: async () => {},
      canUseRowboat: true,
      onFlip,
    })
    await vi.waitFor(() => expect(document.querySelector('.mode-toggle')).not.toBeNull())
    await vi.waitFor(() => expect(document.querySelector('.mode-toggle').disabled).toBe(false))
    document.querySelector('.mode-toggle').click()
    await vi.waitFor(() => expect(onFlip).toHaveBeenCalledWith(id, 'rowboat'))
    expect(manager.peekMode(id)).toBe('rowboat')
  })

  it('stays disabled on the disk project', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const disk = { listProjects: async () => [{ id: 'disk', name: 'main.js', entry: 'main.js', mode: 'disk' }], listVersions: async () => [] }
    const manager = createProjectManager({ local: createLocalStorage(), disk, getRowboat: () => createLocalStorage() })
    const panel = initProjects({ container: document.getElementById('panel'), manager, onSwitch: async () => {}, canUseRowboat: true })
    await panel.select('disk')
    const toggle = document.querySelector('.mode-toggle')
    expect(toggle.textContent).toBe('disk')
    expect(toggle.disabled).toBe(true)
  })
})
