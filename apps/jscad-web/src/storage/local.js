import { createIdbPersistence } from './idb.js'
import { EDIT_COALESCE_MS, sameFiles } from './versioning.js'

export const kindFromEntry = (entry) => (entry.toLowerCase().endsWith('.scad') ? 'openscad' : 'jscad')

export function createLocalStorage(options = {}) {
  const projects = new Map()
  const versions = new Map()
  const conversations = new Map()

  // The working copy is the Maps; this mirrors it into IndexedDB so a reload
  // reads it back. A browser without indexedDB (the compute frame, private
  // mode) keeps the Maps alone, and a failed open falls back the same way.
  let persist = createIdbPersistence(options)
  const ready = (async () => {
    if (!persist) return
    try {
      const [projectRows, versionRows, conversationRows] = await Promise.all([
        persist.load('projects'),
        persist.load('versions'),
        persist.load('conversations'),
      ])
      for (const row of projectRows) projects.set(row.id, row)
      for (const { projectId, rows } of versionRows) versions.set(projectId, rows)
      for (const { projectId, row } of conversationRows) conversations.set(projectId, row)
    } catch (err) {
      console.warn('local storage: IndexedDB open failed; falling back to in-memory Maps for this session', err)
      persist = null
    }
  })()

  const save = (store, key, value) => (persist ? persist.save(store, key, value) : Promise.resolve())
  const drop = (store, key) => (persist ? persist.drop(store, key) : Promise.resolve())

  // Whether the session has stored anything in this backend since the app's
  // boot baseline (`markClean`): the signal that a reload would drop work.
  // Writes that only remove content (delete) must not set it.
  let dirty = false
  const markClean = () => { dirty = false }
  const isDirty = () => dirty

  let lastTs = 0
  const now = () => {
    const ts = Date.now()
    lastTs = ts > lastTs ? ts : lastTs + 1
    return lastTs
  }

  const listProjects = async () => {
    await ready
    const rows = [...projects.values()]
    rows.sort((a, b) => b.updated - a.updated)
    return rows.map(({ id, name, entry, kind, mode, created, updated }) => ({
      id, name, entry, kind, mode, created, updated,
    }))
  }

  const readProject = async (id) => {
    await ready
    const row = projects.get(id)
    if (!row) throw Object.assign(new Error(`projects: not found (${id})`), { name: 'NotFoundError' })
    return { ...row, files: { ...row.files } }
  }

  const addVersion = async (id, { files, entry }, message, created, coalesceKey) => {
    const list = versions.get(id) ?? []
    const versionId = crypto.randomUUID()
    list.unshift({ versionId, created, message, files: { ...files }, entry, coalesceKey })
    versions.set(id, list)
    await save('versions', id, { projectId: id, rows: list })
    return versionId
  }

  // Replace the newest row in place, keeping its id, so a burst of editor
  // compiles reads as one version holding the latest content.
  const foldVersion = async (id, latest, row, message, ts) => {
    latest.files = { ...row.files }
    latest.entry = row.entry
    latest.message = message
    latest.created = ts
    await save('versions', id, { projectId: id, rows: versions.get(id) })
  }

  // `version: false` stores the files with no version row; `snapshot` records one later.
  const writeFiles = async (id, files, options = {}) => {
    await ready
    const { message = '', name, entry, mode = 'local', version = true, coalesceKey, coalesceMs = EDIT_COALESCE_MS } = options
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
    dirty = true
    await save('projects', id, row)
    if (version) {
      const latest = versions.get(id)?.[0]
      // A restore always mints its own row, and two bursts that were never
      // asked to coalesce (no key) or that carry a different key never share.
      const folding = coalesceKey && latest && latest.coalesceKey === coalesceKey &&
        !message.startsWith('restore ') && ts - latest.created < coalesceMs
      if (folding) {
        // Identical content is not a new version; the project row above still
        // records the write.
        if (!sameFiles(latest.files, row.files)) await foldVersion(id, latest, row, message, ts)
      } else {
        await addVersion(id, row, message, ts, coalesceKey)
      }
    }
    return { id, entry: entryPath, kind: row.kind }
  }

  const snapshot = async (id, { message = '' } = {}) => {
    await ready
    const row = projects.get(id)
    if (!row) throw Object.assign(new Error(`projects: not found (${id})`), { name: 'NotFoundError' })
    await addVersion(id, row, message, now())
  }

  // Snapshot only when the stored files differ from the latest version: the
  // switch-away path calls this so an unchanged project mints no row. Returns
  // false when it skipped. No versions yet means there is nothing to compare,
  // so the first snapshot always mints.
  const snapshotUnique = async (id, { message = '' } = {}) => {
    await ready
    const row = projects.get(id)
    if (!row) throw Object.assign(new Error(`projects: not found (${id})`), { name: 'NotFoundError' })
    const latest = versions.get(id)?.[0]
    if (latest && sameFiles(latest.files, row.files)) return false
    await addVersion(id, row, message, now())
    return true
  }

  // The id of a version holding the stored files, for a caller that must
  // return to them later. The newest row is reused only when it matches and
  // is not a coalescing row, which a later editor compile would rewrite.
  const pinVersion = async (id, { message = '' } = {}) => {
    await ready
    const row = projects.get(id)
    if (!row) throw Object.assign(new Error(`projects: not found (${id})`), { name: 'NotFoundError' })
    const latest = versions.get(id)?.[0]
    if (latest && !latest.coalesceKey && sameFiles(latest.files, row.files)) return latest.versionId
    return addVersion(id, row, message, now())
  }

  // Remove files a delete dropped, so a reload does not bring them back. Not
  // `dirty`: only a removal happened, so a reload loses no content.
  const removeFiles = async (id, paths) => {
    await ready
    const row = projects.get(id)
    if (!row) return
    const files = { ...row.files }
    let removed = false
    for (const path of paths) if (Object.hasOwn(files, path)) { delete files[path]; removed = true }
    if (!removed) return
    const next = { ...row, files, updated: now() }
    projects.set(id, next)
    await save('projects', id, next)
  }

  // Whether a reload reads this session's work back. False in the fallback
  // (no indexedDB, or a failed open), where the Maps are the only store.
  const persists = () => persist !== null

  const listVersions = async (id) => {
    await ready
    return (versions.get(id) ?? []).map(({ versionId, created, message }) => ({ versionId, created, message }))
  }

  const readVersion = async (id, versionId) => {
    await ready
    const row = (versions.get(id) ?? []).find((v) => v.versionId === versionId)
    if (!row) throw new Error(`version not found: ${versionId}`)
    return { files: { ...row.files }, entry: row.entry }
  }

  const readConversation = async (projectId) => {
    await ready
    const row = conversations.get(projectId)
    return row ? { messages: row.messages, updated: row.updated } : null
  }

  const writeConversation = async (projectId, messages) => {
    await ready
    const row = { messages, updated: now() }
    conversations.set(projectId, row)
    dirty = true
    await save('conversations', projectId, { projectId, row })
  }

  const deleteProject = async (id) => {
    await ready
    projects.delete(id)
    versions.delete(id)
    conversations.delete(id)
    await Promise.all([drop('projects', id), drop('versions', id), drop('conversations', id)])
  }

  return { listProjects, readProject, writeFiles, removeFiles, snapshot, snapshotUnique, pinVersion, listVersions, readVersion, readConversation, writeConversation, deleteProject, markClean, isDirty, persists }
}
