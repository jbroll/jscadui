// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { createProjectManager } from '../src/storage/projects.js'
import { initEditorHeader } from '../src/editorHeader.js'

// The header lands in the editor drawer; the versions slot stays empty until
// the versions dropdown fills it (Task 5).
const setup = async (options = {}) => {
  document.body.innerHTML = '<div id="panel"></div>'
  const local = createLocalStorage()
  const manager = createProjectManager({ local, getRowboat: () => null })
  const created = await manager.createProject('Gear', { entry: 'main.js', files: { 'main.js': 'v1' } })
  const writes = []
  const onSwitch = vi.fn()
  const onFileCreate = vi.fn()
  const header = initEditorHeader(document.getElementById('panel'), {
    manager,
    onSwitch,
    onFileCreate,
    writeFile: async (id, path, content) => {
      writes.push({ id, path, content })
      const { project, files } = await manager.readForSwitch(id)
      await local.writeFiles(id, { ...files, [path]: content }, { message: `new ${path}`, entry: project.entry })
    },
    readBuffer: () => ({ code: 'buf', path: 'main.js' }),
    confirmDiscard: async () => true,
    ...options,
  })
  // The header lists the projects and paints the open one asynchronously, so
  // the controls are only meaningful once that first render has landed.
  await vi.waitFor(() => expect(document.querySelector('.project-select').value).toBe(created.id))
  return { manager, local, header, onSwitch, onFileCreate, writes, id: created.id }
}

const optionTexts = () => [...document.querySelectorAll('.project-select option')].map((o) => o.textContent)

beforeEach(() => {
  vi.unstubAllGlobals()
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 401 }))
})

describe('project dropdown', () => {
  it('lists the projects with their mode and keeps the open one selected', async () => {
    const { id, header, manager } = await setup()
    await manager.createProject('Bracket', { files: { 'main.js': 'b' } })
    await header.render()
    expect(document.querySelectorAll('.project-select option')).toHaveLength(2)
    expect(optionTexts()).toEqual(['Bracket (This device)', 'Gear (This device)'])
    expect(document.querySelector('.project-select').value).toBe(id)
  })

  it('switches project on change', async () => {
    const { header, manager, onSwitch } = await setup()
    const second = await manager.createProject('Bracket', { files: { 'main.js': 'b' } })
    await header.render()
    const select = document.querySelector('.project-select')
    select.value = second.id
    select.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith(second.id))
    expect(document.querySelector('.project-select').value).toBe(second.id)
  })

  it('asks the discard confirm before a switch and keeps the project when declined', async () => {
    const confirmDiscard = vi.fn(async () => false)
    const { id, header, manager, onSwitch } = await setup({ confirmDiscard })
    const second = await manager.createProject('Bracket', { files: { 'main.js': 'b' } })
    await header.render()
    const select = document.querySelector('.project-select')
    expect(select.value).toBe(id)
    select.value = second.id
    select.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(confirmDiscard).toHaveBeenCalled())
    expect(onSwitch).not.toHaveBeenCalled()
    expect(document.querySelector('.project-select').value).toBe(id)
  })

  it('switches once the discard confirm is accepted', async () => {
    const confirmDiscard = vi.fn(async () => true)
    const { header, manager, onSwitch } = await setup({ confirmDiscard })
    const second = await manager.createProject('Bracket', { files: { 'main.js': 'b' } })
    await header.render()
    const select = document.querySelector('.project-select')
    select.value = second.id
    select.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith(second.id))
    expect(confirmDiscard).toHaveBeenCalled()
  })
})

describe('new project and new file', () => {
  it('creates a project from the buffer and opens it', async () => {
    const { manager, onSwitch } = await setup()
    await vi.waitFor(() => expect(document.querySelector('.project-new')).not.toBeNull())
    document.querySelector('.project-new').click()
    const created = (await manager.listAll()).find((p) => p.name === 'Untitled')
    expect(created).toBeDefined()
    await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith(created.id))
    expect((await manager.readForSwitch(created.id)).files).toEqual({ 'main.js': 'buf' })
    expect(document.querySelector('.project-select').value).toBe(created.id)
  })

  it('writes an empty file to the current project and calls onFileCreate', async () => {
    const { id, manager, onFileCreate, writes } = await setup()
    vi.stubGlobal('prompt', vi.fn(() => 'helper.js'))
    await vi.waitFor(() => expect(document.querySelector('.file-new')).not.toBeNull())
    document.querySelector('.file-new').click()
    await vi.waitFor(() => expect(onFileCreate).toHaveBeenCalledWith('helper.js'))
    expect(writes).toEqual([{ id, path: 'helper.js', content: '' }])
    expect((await manager.readForSwitch(id)).files).toEqual({ 'main.js': 'v1', 'helper.js': '' })
  })

  it('falls back to main.js for an empty name and does nothing on cancel', async () => {
    const { writes, onFileCreate } = await setup()
    vi.stubGlobal('prompt', vi.fn(() => '   '))
    document.querySelector('.file-new').click()
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].path).toBe('main.js')

    vi.stubGlobal('prompt', vi.fn(() => null))
    document.querySelector('.file-new').click()
    await new Promise((r) => setTimeout(r, 0))
    expect(writes).toHaveLength(1)
    expect(onFileCreate).toHaveBeenCalledTimes(1)
  })
})

describe('current project controls', () => {
  it('renames the current project only', async () => {
    const { header, manager, onSwitch } = await setup()
    const second = await manager.createProject('Bracket', { files: { 'main.js': 'b' } })
    await header.render()
    const select = document.querySelector('.project-select')
    select.value = second.id
    select.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith(second.id))
    vi.stubGlobal('prompt', vi.fn(() => 'Renamed'))
    document.querySelector('.project-rename').click()
    await vi.waitFor(async () => expect((await manager.listAll()).some((p) => p.name === 'Renamed')).toBe(true))
    const names = (await manager.listAll()).map((p) => p.name)
    expect(names).toContain('Gear')
    expect(names.filter((n) => n === 'Renamed')).toHaveLength(1)
  })

  it('asks the confirm before deleting the current project', async () => {
    const confirm = vi.fn(async () => true)
    const onDelete = vi.fn()
    const { id } = await setup({ confirm, onDelete })
    await vi.waitFor(() => expect(document.querySelector('.project-delete')).not.toBeNull())
    document.querySelector('.project-delete').click()
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith(id))
    expect(confirm).toHaveBeenCalled()
  })

  it('does not delete when the confirm is declined', async () => {
    const onDelete = vi.fn()
    await setup({ confirm: async () => false, onDelete })
    await vi.waitFor(() => expect(document.querySelector('.project-delete')).not.toBeNull())
    document.querySelector('.project-delete').click()
    await new Promise((r) => setTimeout(r, 0))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('keeps delete and mode disabled on the disk project', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const disk = { listProjects: async () => [{ id: 'disk', name: 'main.js', entry: 'main.js', mode: 'disk' }], listVersions: async () => [] }
    const manager = createProjectManager({ local: createLocalStorage(), disk, getRowboat: () => null })
    const header = initEditorHeader(document.getElementById('panel'), {
      manager,
      onSwitch: async () => {},
      confirm: async () => true,
      onDelete: vi.fn(),
      canUseRowboat: true,
    })
    await header.select('disk')
    await vi.waitFor(() => expect(document.querySelector('.project-select').value).toBe('disk'))
    expect(document.querySelector('.project-delete').disabled).toBe(true)
    const mode = document.querySelector('.mode-toggle')
    expect(mode.textContent).toBe('Folder')
    expect(mode.disabled).toBe(true)
  })

  it('flips the mode of the current project when rowboat is available', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    const manager = createProjectManager({ local, getRowboat: () => rowboat })
    const { id } = await manager.createProject('Gear', { files: { 'main.js': 'v1' } })
    const onFlip = vi.fn()
    initEditorHeader(document.getElementById('panel'), {
      manager,
      onSwitch: async () => {},
      canUseRowboat: true,
      onFlip,
    })
    await vi.waitFor(() => expect(document.querySelector('.mode-toggle').disabled).toBe(false))
    document.querySelector('.mode-toggle').click()
    await vi.waitFor(() => expect(onFlip).toHaveBeenCalledWith(id, 'rowboat'))
    expect(manager.peekMode(id)).toBe('rowboat')
    expect(document.querySelector('.mode-toggle').textContent).toBe('Synced')
  })

  it('drops onto the current project and stops the event there', async () => {
    const onDropOnProject = vi.fn()
    const { id } = await setup({ onDropOnProject })
    await vi.waitFor(() => expect(document.querySelector('.project-select')).not.toBeNull())
    const row = document.querySelector('.project-header')
    const dataTransfer = { items: [] }
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    row.dispatchEvent(drop)
    expect(onDropOnProject).toHaveBeenCalledWith(id, dataTransfer)
    expect(drop.defaultPrevented).toBe(true)
  })
})

describe('sync status', () => {
  it('shows a message with a retry that calls onRetrySync, and hides on empty', async () => {
    const onRetrySync = vi.fn()
    const { header } = await setup({ onRetrySync })
    await vi.waitFor(() => expect(document.querySelector('.project-sync-status')).not.toBeNull())
    const status = document.querySelector('.project-sync-status')
    expect(status.style.display).toBe('none')
    header.setSyncStatus('Sync failed')
    expect(status.style.display).not.toBe('none')
    expect(status.textContent).toContain('Sync failed')
    status.querySelector('.sync-retry').click()
    expect(onRetrySync).toHaveBeenCalled()
    header.setSyncStatus('')
    expect(status.style.display).toBe('none')
  })
})

describe('drawer header slots', () => {
  it('renders the shared sign-in control in the sync slot', async () => {
    await setup()
    await vi.waitFor(() => expect(document.querySelector('.editor-sync')).not.toBeNull())
    const buttons = [...document.querySelectorAll('.editor-sync .ai-button')].map((b) => b.textContent)
    expect(buttons).toContain('Sign in to Sync')
  })

  it('mounts the versions dropdown in the reserved slot', async () => {
    await setup()
    await vi.waitFor(() => expect(document.getElementById('editor-versions')).not.toBeNull())
    expect(document.querySelector('#editor-versions .version-select')).not.toBeNull()
  })
})

describe('versions dropdown', () => {
  const versionTexts = () => [...document.querySelectorAll('.version-select option')].map((o) => o.textContent)

  it('lists versions newest first with a locale timestamp, kind and chat excerpt', async () => {
    const { header, local, id } = await setup()
    await local.writeFiles(id, { 'main.js': 'v2' }, { message: 'edit', entry: 'main.js' })
    await local.writeFiles(id, { 'main.js': 'v3' }, { message: 'chat: exhaust pipes at the rear', entry: 'main.js' })
    await header.render()
    const versions = await local.listVersions(id)
    expect(versions).toHaveLength(3)
    expect(versionTexts()).toEqual(versions.map((v) => `${new Date(v.created).toLocaleString()} — ${v.message}`))
    expect(versionTexts()[0]).toContain('chat: exhaust pipes at the rear')
    expect(versionTexts()[1]).toContain('— edit')
    expect(document.querySelector('.version-select').disabled).toBe(false)
  })

  it('restores the selected version in place then calls onRestore', async () => {
    const calls = []
    const onRestore = vi.fn(() => { calls.push('onRestore') })
    const { header, local, manager, id } = await setup({ onRestore })
    await local.writeFiles(id, { 'main.js': 'v2' }, { message: 'edit', entry: 'main.js' })
    await header.render()
    const versions = await manager.listVersions(id)
    const create = versions.find((v) => v.message === 'create')
    const restoreVersion = manager.restoreVersion
    manager.restoreVersion = vi.fn(async (...args) => { calls.push('restore'); return restoreVersion(...args) })

    const select = document.querySelector('.version-select')
    select.value = create.versionId
    select.dispatchEvent(new Event('change'))

    await vi.waitFor(() => expect(onRestore).toHaveBeenCalledWith(id))
    expect(calls).toEqual(['restore', 'onRestore'])
    expect((await manager.readForSwitch(id)).files).toEqual({ 'main.js': 'v1' })
    const restored = await manager.listVersions(id)
    expect(restored[0].message).toMatch(/^restore /)
    expect(select.value).toBe(restored[0].versionId)
  })

  it('asks the discard confirm before restoring and keeps the version when declined', async () => {
    const calls = []
    const confirmDiscard = vi.fn(async () => { calls.push('confirm'); return false })
    const onRestore = vi.fn(() => { calls.push('onRestore') })
    const { header, local, manager, id } = await setup({ confirmDiscard, onRestore })
    await local.writeFiles(id, { 'main.js': 'v2' }, { message: 'edit', entry: 'main.js' })
    await header.render()
    const restoreVersion = manager.restoreVersion
    manager.restoreVersion = vi.fn(async (...args) => { calls.push('restore'); return restoreVersion(...args) })
    const create = (await manager.listVersions(id)).find((v) => v.message === 'create')

    const select = document.querySelector('.version-select')
    select.value = create.versionId
    select.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(confirmDiscard).toHaveBeenCalled())
    expect(calls).toEqual(['confirm'])
    expect(manager.restoreVersion).not.toHaveBeenCalled()
    expect(onRestore).not.toHaveBeenCalled()

    confirmDiscard.mockImplementation(async () => { calls.push('confirm'); return true })
    select.value = create.versionId
    select.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(onRestore).toHaveBeenCalledWith(id))
    expect(calls).toEqual(['confirm', 'confirm', 'restore', 'onRestore'])
  })

  it('disables the dropdown with a reason when the project has no versions', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const local = createLocalStorage()
    const manager = createProjectManager({ local, getRowboat: () => null })
    await local.writeFiles('bare', { 'main.js': 'v1' }, { message: 'create', entry: 'main.js', version: false })
    const header = initEditorHeader(document.getElementById('panel'), {
      manager,
      onSwitch: async () => {},
      confirmDiscard: async () => true,
    })
    await header.select('bare')
    const select = document.querySelector('.version-select')
    expect(select.disabled).toBe(true)
    expect(select.textContent).toBe('No versions yet')
  })

  it('disables the dropdown with the git reason on the disk project', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const disk = { listProjects: async () => [{ id: 'disk', name: 'main.js', entry: 'main.js', mode: 'disk' }], listVersions: async () => [] }
    const manager = createProjectManager({ local: createLocalStorage(), disk, getRowboat: () => null })
    const header = initEditorHeader(document.getElementById('panel'), {
      manager,
      onSwitch: async () => {},
      confirmDiscard: async () => true,
      canUseRowboat: true,
    })
    await header.select('disk')
    await vi.waitFor(() => expect(document.querySelector('.version-select').disabled).toBe(true))
    expect(document.querySelector('.version-select').textContent).toBe('Folder projects keep history in git')
  })
})
