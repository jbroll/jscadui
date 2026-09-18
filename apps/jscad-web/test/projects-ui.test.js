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
  initProjects({ container: document.getElementById('panel'), manager, onSwitch, readBuffer: () => ({ code: 'buf', path: 'main.js' }) })
  return { manager, onSwitch }
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
    expect(onSwitch).toHaveBeenCalledWith(expect.any(String))
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
})
