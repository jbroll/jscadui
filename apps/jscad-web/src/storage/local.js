export const kindFromEntry = (entry) => (entry.toLowerCase().endsWith('.scad') ? 'openscad' : 'jscad')

export function createLocalStorage() {
  const projects = new Map()
  const versions = new Map()
  const conversations = new Map()

  let lastTs = 0
  const now = () => {
    const ts = Date.now()
    lastTs = ts > lastTs ? ts : lastTs + 1
    return lastTs
  }

  const listProjects = async () => {
    const rows = [...projects.values()]
    rows.sort((a, b) => b.updated - a.updated)
    return rows.map(({ id, name, entry, kind, mode, created, updated }) => ({
      id, name, entry, kind, mode, created, updated,
    }))
  }

  const readProject = async (id) => {
    const row = projects.get(id)
    if (!row) throw new Error(`projects: not found (${id})`)
    return { ...row, files: { ...row.files } }
  }

  const writeFiles = async (id, files, options = {}) => {
    const { message = '', name, entry, mode = 'local' } = options
    const existing = projects.get(id)
    const entryPath = entry ?? existing?.entry ?? 'main.js'
    const ts = now()
    const row = {
      id,
      name: name ?? existing?.name ?? 'Untitled',
      entry: entryPath,
      kind: kindFromEntry(entryPath),
      mode: existing?.mode ?? mode,
      created: existing?.created ?? ts,
      updated: ts,
      files: { ...files },
    }
    projects.set(id, row)
    const list = versions.get(id) ?? []
    list.unshift({ versionId: crypto.randomUUID(), created: ts, message, files: { ...files }, entry: entryPath })
    versions.set(id, list)
    return { id, entry: entryPath, kind: row.kind }
  }

  const listVersions = async (id) =>
    (versions.get(id) ?? []).map(({ versionId, created, message }) => ({ versionId, created, message }))

  const readVersion = async (id, versionId) => {
    const row = (versions.get(id) ?? []).find((v) => v.versionId === versionId)
    if (!row) throw new Error(`version not found: ${versionId}`)
    return { files: { ...row.files }, entry: row.entry }
  }

  const readConversation = async (projectId) => {
    const row = conversations.get(projectId)
    return row ? { messages: row.messages, updated: row.updated } : null
  }

  const writeConversation = async (projectId, messages) => {
    conversations.set(projectId, { messages, updated: now() })
  }

  return { listProjects, readProject, writeFiles, listVersions, readVersion, readConversation, writeConversation }
}
