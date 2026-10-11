const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const MODE_LABEL = { local: 'This device', rowboat: 'Synced', disk: 'Folder' }
const modeLabel = (mode) => MODE_LABEL[mode] ?? mode

/**
 * @param {{container:HTMLElement,manager:{listAll:Function,createProject:Function,renameProject:Function,listVersions:Function,restoreVersion:Function},onSwitch:Function,onDropOnProject:Function,onRestore?:Function,onError?:Function,readBuffer?:Function,confirm?:Function,onDelete?:Function,onRetrySync?:Function}} options
 */
export const initProjects = ({ container, manager, onSwitch, onDropOnProject, onRestore, onFlip, onError = () => {}, canUseRowboat = false, readBuffer = () => ({ code: '', path: 'main.js' }), confirm = async () => true, onDelete, onRetrySync }) => {
  const header = el('div', 'project-header', 'Projects')
  const newBtn = el('button', 'project-new', 'New')
  newBtn.type = 'button'
  header.append(newBtn)
  const modeBtn = el('button', 'mode-toggle', 'local')
  modeBtn.type = 'button'
  modeBtn.disabled = true
  header.append(modeBtn)
  const list = el('div', 'project-rows')
  const versionsEl = el('div', 'project-versions')
  const syncEl = el('div', 'project-sync-status')
  syncEl.style.display = 'none'
  container.append(header, list, syncEl, versionsEl)
  let selectedId = null
  let versionGen = 0

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

  const renderVersions = async () => {
    const gen = ++versionGen
    const versions = await manager.listVersions(selectedId).catch(() => [])
    if (gen !== versionGen || !selectedId) return
    versionsEl.innerHTML = ''
    for (const v of versions) {
      const row = el('div', 'version-row', `${new Date(v.created).toLocaleString()} — ${v.message}`)
      const btn = el('button', 'version-restore', 'Restore')
      btn.type = 'button'
      btn.addEventListener('click', async () => {
        try {
          await manager.restoreVersion(selectedId, v.versionId)
          renderVersions()
          onRestore?.(selectedId)
        } catch (err) {
          onError(err)
        }
      })
      row.append(btn)
      versionsEl.append(row)
    }
  }

  const paintSelection = () => {
    for (const row of list.querySelectorAll('.project-row')) {
      const on = row.dataset.projectId === selectedId
      row.classList.toggle('selected', on)
      if (on) row.setAttribute('aria-current', 'true')
      else row.removeAttribute('aria-current')
    }
  }

  const select = async (id) => {
    selectedId = id
    paintSelection()
    await refreshMode()
    await renderVersions()
  }

  const refreshMode = async () => {
    if (!selectedId) {
      modeBtn.textContent = modeLabel('local')
      modeBtn.disabled = true
      return
    }
    const mode = manager.peekMode ? manager.peekMode(selectedId) : 'local'
    modeBtn.textContent = modeLabel(mode)
    modeBtn.disabled = !canUseRowboat || mode === 'disk'
    modeBtn.title = mode === 'disk' ? 'The model directory stays on disk' : canUseRowboat ? '' : 'Sign in to use rowboat mode'
  }

  modeBtn.addEventListener('click', async () => {
    if (!selectedId) return
    modeBtn.disabled = true
    try {
      const mode = await manager.flipMode(selectedId)
      modeBtn.textContent = modeLabel(mode)
      onFlip?.(selectedId, mode)
      render()
    } catch (err) {
      onError(err)
    } finally {
      modeBtn.disabled = !canUseRowboat
    }
  })

  const render = async () => {
    const projects = await manager.listAll().catch(() => [])
    list.innerHTML = ''
    for (const p of projects) {
      const row = el('div', 'project-row')
      row.dataset.projectId = p.id
      const label = el('button', 'project-open', `${p.name} (${modeLabel(p.mode)})`)
      label.type = 'button'
      label.addEventListener('click', async () => { await select(p.id); onSwitch(p.id) })
      const rename = el('button', 'project-rename', 'Rename')
      rename.type = 'button'
      rename.addEventListener('click', async (ev) => {
        ev.stopPropagation()
        const name = prompt('Project name', p.name)
        if (!name || name === p.name) return
        await manager.renameProject(p.id, name)
        render()
      })
      const del = el('button', 'project-delete', 'Delete')
      del.type = 'button'
      del.disabled = p.mode === 'disk'
      del.title = del.disabled ? 'The model directory stays on disk' : 'Delete this project'
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation()
        const ok = await confirm({ title: 'Delete project?', message: `“${p.name}” and its history will be removed.`, confirmLabel: 'Delete', cancelLabel: 'Cancel' })
        if (!ok) return
        try { await onDelete?.(p.id) } catch (err) { onError(err) }
      })
      row.append(label, rename, del)
      row.addEventListener('dragover', (ev) => ev.preventDefault())
      row.addEventListener('drop', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        onDropOnProject?.(p.id, ev.dataTransfer)
      })
      list.append(row)
    }
    paintSelection()
    if (!selectedId) {
      const first = list.querySelector('.project-row')
      if (first) await select(first.dataset.projectId)
    } else {
      await renderVersions()
    }
  }

  newBtn.addEventListener('click', async () => {
    const { code, path } = readBuffer()
    const created = await manager.createProject('Untitled', { entry: path, files: { [path]: code } })
    await select(created.id)
    onSwitch(created.id)
    render()
  })

  render()
  return { render, select, setSyncStatus }
}
