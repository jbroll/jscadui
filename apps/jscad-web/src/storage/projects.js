import { kindFromEntry } from './local.js'

export { kindFromEntry }

const shortId = (versionId) => versionId.slice(0, 8)

const walkFiles = async (entries, readDir, readAsText, prefix, out) => {
  for (const entry of entries) {
    if (entry.isDirectory) {
      await walkFiles(await readDir(entry), readDir, readAsText, `${prefix}${entry.name}/`, out)
    } else {
      out[`${prefix}${entry.name}`] = await readAsText(entry)
    }
  }
  return out
}

const namespaceDrop = async (entries, readDir, readAsText) => {
  const singleDir = entries.length === 1 && entries[0].isDirectory
  const folder = singleDir ? entries[0].name : 'drop'
  const roots = singleDir ? await readDir(entries[0]) : entries
  const files = await walkFiles(roots, readDir, readAsText, `${folder}/`, {})
  if (Object.keys(files).length === 0) throw new Error('empty drop')
  return { folder, files }
}

const detectEntry = (paths, folder) => {
  const candidates = ['index.js', 'index.ts', `${folder}.js`, `${folder}.ts`]
  for (const candidate of candidates) {
    if (paths.includes(candidate)) return candidate
  }
  return [...paths].sort().find((p) => p.endsWith('.js')) ?? paths[0]
}

export function createProjectManager({ local, getRowboat }) {
  const modes = new Map()
  const rowboat = () => getRowboat?.() ?? null
  const storeFor = (mode) => (mode === 'rowboat' && rowboat() ? rowboat() : local)

  const remember = (id, mode) => {
    modes.set(id, mode)
    return mode
  }

  const modeOf = async (id) => {
    if (modes.has(id)) return modes.get(id)
    if (rowboat()) {
      try {
        const row = await rowboat().readProject(id)
        return remember(id, row.mode)
      } catch { /* fall through to local */ }
    }
    const row = await local.readProject(id)
    return remember(id, row.mode)
  }

  const ownerOf = async (id) => storeFor(await modeOf(id))

  const listAll = async () => {
    const all = (await local.listProjects()).map((p) => ({ ...p, backend: 'local' }))
    if (rowboat()) {
      for (const p of await rowboat().listProjects()) all.push({ ...p, backend: 'rowboat' })
    }
    for (const p of all) {
      if (!modes.has(p.id)) modes.set(p.id, p.mode)
    }
    all.sort((a, b) => b.updated - a.updated)
    return all
  }

  const createProject = async (name, options = {}) => {
    const { entry = 'main.js', files = { [entry]: '' }, mode = 'local' } = options
    const id = crypto.randomUUID()
    const store = storeFor(mode)
    if (mode === 'rowboat' && store === local) throw new Error('rowboat unavailable')
    const written = await store.writeFiles(id, files, { message: 'create', name, entry, mode })
    remember(id, mode)
    return { id, ...written }
  }

  const renameProject = async (id, name) => {
    const store = await ownerOf(id)
    const project = await store.readProject(id)
    await store.writeFiles(id, project.files, { message: 'rename', name, entry: project.entry })
  }

  const readForSwitch = async (id) => {
    const project = await (await ownerOf(id)).readProject(id)
    return { project, files: project.files }
  }

  const mergeDrop = async (id, entries, fns) => {
    const { folder, files: dropped } = await namespaceDrop(entries, fns.readDir, fns.readAsText)
    const store = await ownerOf(id)
    const project = await store.readProject(id)
    const files = { ...project.files, ...dropped }
    await store.writeFiles(id, files, { message: `drop ${folder}`, entry: project.entry })
    return { added: Object.keys(dropped) }
  }

  const createFromDrop = async (entries, fns) => {
    const { folder, files } = await namespaceDrop(entries, fns.readDir, fns.readAsText)
    const paths = Object.keys(files).map((p) => p.replace(`${folder}/`, ''))
    const entry = `${folder}/${detectEntry(paths, folder)}`
    const created = await createProject(folder, { entry, files })
    return { ...created, name: folder, entry }
  }

  const listVersions = async (id) => (await ownerOf(id)).listVersions(id)

  const restoreVersion = async (id, versionId) => {
    const store = await ownerOf(id)
    const { files, entry } = await store.readVersion(id, versionId)
    await store.writeFiles(id, files, { message: `restore ${shortId(versionId)}`, entry })
    return { files, entry }
  }

  const flipMode = async (id) => {
    const from = await ownerOf(id)
    const project = await from.readProject(id)
    const toMode = project.mode === 'rowboat' ? 'local' : 'rowboat'
    const to = storeFor(toMode)
    if (to === from) throw new Error('rowboat unavailable')
    await to.writeFiles(id, project.files, { message: `mode to ${toMode}`, name: project.name, entry: project.entry, mode: toMode })
    return remember(id, toMode)
  }

  const getMode = (id) => modeOf(id)
  const peekMode = (id) => modes.get(id) ?? 'local'

  return { listAll, createProject, renameProject, readForSwitch, mergeDrop, createFromDrop, listVersions, restoreVersion, flipMode, getMode, peekMode }
}
