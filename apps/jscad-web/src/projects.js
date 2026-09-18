const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * @param {{container:HTMLElement,manager:{listAll:Function,createProject:Function,renameProject:Function,listVersions:Function,restoreVersion:Function},onSwitch:Function,onDropOnProject:Function,onRestore?:Function,onError?:Function,readBuffer?:Function}} options
 */
export const initProjects = ({ container, manager, onSwitch, onDropOnProject, onRestore, onError = () => {}, readBuffer = () => ({ code: '', path: 'main.js' }) }) => {
  const header = el('div', 'project-header', 'Projects')
  const newBtn = el('button', 'project-new', 'New')
  newBtn.type = 'button'
  header.append(newBtn)
  const list = el('div', 'project-rows')
  const versionsEl = el('div', 'project-versions')
  container.append(header, list, versionsEl)
  let selectedId = null
  let versionGen = 0

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

  const select = async (id) => {
    selectedId = id
    await renderVersions()
  }

  const render = async () => {
    const projects = await manager.listAll().catch(() => [])
    list.innerHTML = ''
    for (const p of projects) {
      const row = el('div', 'project-row')
      row.dataset.projectId = p.id
      const label = el('button', 'project-open', `${p.name} (${p.mode})`)
      label.type = 'button'
      label.addEventListener('click', () => onSwitch(p.id))
      const rename = el('button', 'project-rename', 'Rename')
      rename.type = 'button'
      rename.addEventListener('click', async (ev) => {
        ev.stopPropagation()
        const name = prompt('Project name', p.name)
        if (!name || name === p.name) return
        await manager.renameProject(p.id, name)
        render()
      })
      row.append(label, rename)
      row.addEventListener('dragover', (ev) => ev.preventDefault())
      row.addEventListener('drop', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        onDropOnProject?.(p.id, ev.dataTransfer)
      })
      list.append(row)
    }
    if (!selectedId) {
      const first = list.querySelector('.project-row')
      if (first) await select(first.dataset.projectId)
    } else {
      await renderVersions()
    }
  }

  newBtn.addEventListener('click', async () => {
    const { code, path } = readBuffer()
    await manager.createProject('Untitled', { entry: path, files: { [path]: code } })
    render()
  })

  render()
  return { render, select }
}
