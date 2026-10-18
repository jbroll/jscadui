// The editor drawer header: the project dropdown, New Project / New File, and
// the current project's own controls (rename, delete, mode flip, sync status,
// drop target). The versions slot stays an empty div until the versions
// dropdown fills it.
import { mountSyncEntry } from './syncEntry.js'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const MODE_LABEL = { local: 'This device', rowboat: 'Synced', disk: 'Folder' }
const modeLabel = (mode) => MODE_LABEL[mode] ?? mode

/**
 * @typedef {Object} EditorHeaderDeps
 * @property {{listAll:Function,createProject:Function,renameProject:Function,deleteProject:Function,flipMode:Function,peekMode:Function}} manager
 * @property {(id:string) => (void|Promise<void>)} [onSwitch] called with the project the user picked
 * @property {(path:string) => (void|Promise<void>)} [onFileCreate] after a new file was written
 * @property {(projectId:string, path:string, content:string) => Promise<void>} [writeFile] lands a new file in the current project
 * @property {() => ({code:string,path:string})} [readBuffer] seeds a new project from the editor
 * @property {(projectId:string, dataTransfer:DataTransfer) => (void|Promise<void>)} [onDropOnProject]
 * @property {(id:string, mode:string) => void} [onFlip] after a mode flip
 * @property {(id:string) => Promise<void>} [onDelete]
 * @property {() => void} [onRetrySync]
 * @property {(err:Error) => void} [onError]
 * @property {() => Promise<boolean>} [confirmDiscard] the dirty-buffer gate before switching
 * @property {(options:{title:string,message:string,confirmLabel:string,cancelLabel:string}) => Promise<boolean>} [confirm]
 * @property {boolean} [canUseRowboat]
 * @property {{hasLocalWork?: () => boolean, onSignOut?: () => (void|Promise<void>)}} [syncDeps] for the shared sign-in control
 */

/**
 * @param {HTMLElement} container
 * @param {EditorHeaderDeps} deps
 * @returns {{render: () => Promise<void>, select: (id:string) => Promise<void>, setSyncStatus: (text:string) => void}}
 */
export const initEditorHeader = (container, {
  manager,
  onSwitch = () => {},
  onFileCreate = () => {},
  writeFile = async () => {},
  readBuffer = () => ({ code: '', path: 'main.js' }),
  onDropOnProject,
  onFlip,
  onDelete,
  onRetrySync,
  onError = () => {},
  confirmDiscard = async () => true,
  confirm = async () => true,
  canUseRowboat = false,
  syncDeps,
} = {}) => {
  // The sync slot mounts the control the AI drawer mounts as well, so both
  // drawers name signing in the same way.
  const syncSlot = el('div', 'editor-sync')
  mountSyncEntry(syncSlot, syncDeps)

  const row = el('div', 'project-header')
  const projectSelect = el('select', 'project-select')
  projectSelect.setAttribute('aria-label', 'Project')
  const newProject = el('button', 'project-new', 'New Project')
  newProject.type = 'button'
  const newFile = el('button', 'file-new', 'New File')
  newFile.type = 'button'
  const renameBtn = el('button', 'project-rename', 'Rename')
  renameBtn.type = 'button'
  const deleteBtn = el('button', 'project-delete', 'Delete')
  deleteBtn.type = 'button'
  const modeBtn = el('button', 'mode-toggle', 'local')
  modeBtn.type = 'button'
  modeBtn.disabled = true
  row.append(projectSelect, newProject, newFile, renameBtn, deleteBtn, modeBtn)

  const syncEl = el('div', 'project-sync-status')
  syncEl.style.display = 'none'
  // Reserved for the versions dropdown; the id keeps the slot findable.
  const versionsEl = el('div', 'editor-versions')
  versionsEl.id = 'editor-versions'
  container.append(syncSlot, row, syncEl, versionsEl)

  let selectedId = null
  let projects = []

  const currentProject = () => projects.find((p) => p.id === selectedId)

  const setSyncStatus = (text) => {
    syncEl.textContent = ''
    if (!text) { syncEl.style.display = 'none'; return }
    syncEl.style.display = ''
    syncEl.append(document.createTextNode(`${text} `))
    if (onRetrySync) {
      const retry = el('button', 'sync-retry', 'Retry')
      retry.type = 'button'
      retry.addEventListener('click', () => { onRetrySync() })
      syncEl.append(retry)
    }
  }

  const refreshMode = () => {
    const project = currentProject()
    if (!project) {
      modeBtn.textContent = modeLabel('local')
      modeBtn.disabled = true
      modeBtn.title = ''
      deleteBtn.disabled = true
      return
    }
    const mode = manager.peekMode ? manager.peekMode(project.id) : 'local'
    modeBtn.textContent = modeLabel(mode)
    modeBtn.disabled = !canUseRowboat || mode === 'disk'
    modeBtn.title = mode === 'disk' ? 'The model directory stays on disk' : canUseRowboat ? '' : 'Sign in to use rowboat mode'
    deleteBtn.disabled = mode === 'disk'
    deleteBtn.title = deleteBtn.disabled ? 'The model directory stays on disk' : 'Delete this project'
  }

  // The dropdown is the only multi-project surface, so it is also the only
  // place a selection can differ from the open project.
  const paintSelection = () => {
    projectSelect.value = selectedId ?? ''
    // A page drop resolves through the nearest [data-project-id]; without an
    // open project there is nothing to resolve to.
    if (selectedId) row.dataset.projectId = selectedId
    else delete row.dataset.projectId
    refreshMode()
  }

  const select = async (id) => {
    selectedId = id
    paintSelection()
  }

  const render = async () => {
    projects = await manager.listAll().catch(() => [])
    projectSelect.innerHTML = ''
    for (const project of projects) {
      const option = el('option', '', `${project.name} (${modeLabel(project.mode)})`)
      option.value = project.id
      projectSelect.append(option)
    }
    if (!selectedId) {
      const first = projects[0]
      if (first) selectedId = first.id
    }
    paintSelection()
  }

  // Switching a dirty buffer away asks first; a declined confirm leaves both the
  // editor and the dropdown on the project that is open.
  const switchTo = async (id) => {
    if (id === selectedId) return
    if (!(await confirmDiscard())) {
      paintSelection()
      return
    }
    await select(id)
    await onSwitch(id)
  }

  projectSelect.addEventListener('change', async () => {
    const id = projectSelect.value
    try {
      await switchTo(id)
    } catch (err) {
      onError(err)
    }
  })

  newProject.addEventListener('click', async () => {
    try {
      const { code, path } = readBuffer()
      const created = await manager.createProject('Untitled', { entry: path, files: { [path]: code } })
      await render()
      await select(created.id)
      await onSwitch(created.id)
    } catch (err) {
      onError(err)
    }
  })

  newFile.addEventListener('click', async () => {
    if (!selectedId) return
    const name = prompt('New file name', 'main.js')
    if (name === null) return
    const path = name.trim() || 'main.js'
    try {
      await writeFile(selectedId, path, '')
      await onFileCreate(path)
    } catch (err) {
      onError(err)
    }
  })

  renameBtn.addEventListener('click', async () => {
    const project = currentProject()
    if (!project) return
    const name = prompt('Project name', project.name)
    if (!name || name === project.name) return
    try {
      await manager.renameProject(project.id, name)
      await render()
    } catch (err) {
      onError(err)
    }
  })

  deleteBtn.addEventListener('click', async () => {
    const project = currentProject()
    if (!project) return
    const ok = await confirm({ title: 'Delete project?', message: `“${project.name}” and its history will be removed.`, confirmLabel: 'Delete', cancelLabel: 'Cancel' })
    if (!ok) return
    try { await onDelete?.(project.id) } catch (err) { onError(err) }
  })

  modeBtn.addEventListener('click', async () => {
    if (!selectedId) return
    modeBtn.disabled = true
    try {
      const mode = await manager.flipMode(selectedId)
      onFlip?.(selectedId, mode)
      await render()
    } catch (err) {
      onError(err)
    } finally {
      refreshMode()
    }
  })

  // A drop anywhere on the current-project strip merges into that project, the
  // way a drop on its row did while the project drawer owned the list.
  row.addEventListener('dragover', (ev) => ev.preventDefault())
  row.addEventListener('drop', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    if (selectedId) onDropOnProject?.(selectedId, ev.dataTransfer)
  })

  render()
  return { render, select, setSyncStatus }
}
