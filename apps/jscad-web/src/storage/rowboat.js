import { buildRowboatDb, createBlobClient, storeName, syncWithServer } from '@jbroll/rowboat-client'
import { kindFromEntry } from './local.js'
import { manifest } from './manifest.js'
import { EDIT_COALESCE_MS } from './versioning.js'

const APP_NAME = 'jscad-web'
const APP_VERSION = 0

// A `{hash, size}` cell can be read back as JSON text; the hash alone is the
// identity a manifest comparison cares about.
const hashOf = (hash) => {
  if (typeof hash !== 'string') return hash?.hash ?? hash
  try {
    return JSON.parse(hash)?.hash ?? hash
  } catch {
    return hash
  }
}

const manifestKey = (file) => `${file.path}\u0000${hashOf(file.hash)}`

// Two `[{path, hash}]` manifests are equal when they name the same paths with
// the same content hashes, whatever order the rows came back in. A stored
// manifest comes back as JSON text.
const sameManifest = (a, b) => {
  const keys = (list) => {
    const rows = typeof list === 'string' ? JSON.parse(list) : list
    return (rows ?? []).map(manifestKey).sort()
  }
  const x = keys(a)
  const y = keys(b)
  return x.length === y.length && x.every((key, i) => key === y[i])
}

export function createRowboatStorage(options) {
  const {
    syncBase,
    filesBase = `${syncBase}/files`,
    identity,
    getHeaders = async () => ({}),
    dbOptions,
    fetchFn,
    blobClient,
    cache = new Map(),
  } = options

  const dbName = storeName(APP_NAME, identity)
  const db = buildRowboatDb(dbName, manifest, [], undefined, dbOptions)

  const authFetch = async (input, init) => {
    const headers = { ...(await getHeaders()), ...(init?.headers ?? {}) }
    return (fetchFn ?? fetch)(input, { ...init, headers })
  }
  const blobs = blobClient ?? createBlobClient({ apiBase: filesBase, fetchFn: authFetch })

  let lastTs = 0
  const now = () => {
    const ts = Date.now()
    lastTs = ts > lastTs ? ts : lastTs + 1
    return lastTs
  }

  const sha256Hex = async (bytes) => {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }

  const sync = async () =>
    syncWithServer({
      db,
      apiBase: syncBase,
      appVersion: APP_VERSION,
      author: identity,
      headers: await getHeaders(),
      fetchFn: authFetch,
    })

  const contentOf = async (media) => {
    const cell = typeof media === 'string' ? JSON.parse(media) : media
    if (cache.has(cell.hash)) return cache.get(cell.hash)
    const res = await blobs.fetch(cell.hash)
    return new TextDecoder().decode(await res.arrayBuffer())
  }

  const rowsFor = async (table, projectId) =>
    db.table(table).where('projectId').equals(projectId).filter((r) => !r.__deleted).toArray()

  const readRow = async (table, id) => {
    const row = await db.table(table).get(id)
    if (!row || row.__deleted) throw Object.assign(new Error(`${table}: not found (${id})`), { name: 'NotFoundError' })
    return row
  }

  const listProjects = async () => {
    const rows = await db.table('projects').filter((r) => !r.__deleted).toArray()
    rows.sort((a, b) => b.updated - a.updated)
    return rows.map(({ id, name, entry, kind, mode, created, updated }) => ({
      id, name, entry, kind, mode, created, updated,
    }))
  }

  const readProject = async (id) => {
    const row = await readRow('projects', id)
    const files = {}
    for (const file of await rowsFor('files', id)) files[file.path] = await contentOf(file.hash)
    return { id, name: row.name, entry: row.entry, kind: row.kind, mode: row.mode, created: row.created, updated: row.updated, files }
  }

  // Mint a version row and return its `versionId`, the handle the coalescing
  // map tracks so a row minted behind its back (a snapshot) breaks the chain.
  const addVersion = async (id, manifest, message, created) => {
    const versionId = crypto.randomUUID()
    await db.create('versions', {
      id: crypto.randomUUID(),
      owner_group_id: identity,
      projectId: id,
      versionId,
      created,
      message,
      manifest,
    })
    return versionId
  }

  // The newest version row by timestamp, the one a coalesced write folds into.
  const latestVersion = async (id) => {
    const rows = await rowsFor('versions', id)
    return rows.reduce((latest, row) => (latest === null || row.created > latest.created ? row : latest), null)
  }

  // The rowboat `versions` table has no column for the coalesce key, so the
  // `{versionId, key}` of the newest row this store instance wrote lives here
  // instead. Tracking the row's identity, not just the key, keeps a snapshot
  // (which mints a row without touching this map) from being folded onto: the
  // newest row no longer matches the tracked `versionId`. After a reload the
  // newest row is unknown, so the next write starts a row.
  const coalesceKeys = new Map()

  // `version: false` stores the files with no version row; `snapshot` records one later.
  const writeFiles = async (id, files, options = {}) => {
    const { message = '', name, entry, version = true, coalesceKey, coalesceMs = EDIT_COALESCE_MS } = options
    const existing = await db.table('projects').get(id)
    const entryPath = entry ?? existing?.entry ?? 'main.js'
    const ts = now()
    if (existing) {
      await db.update('projects', id, { name: name ?? existing.name, entry: entryPath, kind: kindFromEntry(entryPath), updated: ts })
    } else {
      await db.create('projects', {
        id,
        owner_group_id: identity,
        name: name ?? 'Untitled',
        entry: entryPath,
        kind: kindFromEntry(entryPath),
        mode: 'rowboat',
        created: ts,
        updated: ts,
      })
    }
    const previous = await rowsFor('files', id)
    const previousByPath = new Map(previous.map((r) => [r.path, r.hash]))
    const fileManifest = {}
    for (const [path, content] of Object.entries(files)) {
      const bytes = new TextEncoder().encode(content)
      const hash = await sha256Hex(bytes)
      const prior = previousByPath.get(path)
      // The blob key is the content hash, so a row already pointing at it means
      // the upload is done; re-uploading would duplicate the bytes.
      const priorCell = typeof prior === 'string' ? JSON.parse(prior) : prior
      if (priorCell?.hash === hash) {
        fileManifest[path] = { hash: priorCell.hash, size: priorCell.size }
        cache.set(hash, content)
        continue
      }
      const uploaded = await blobs.upload(bytes)
      cache.set(uploaded.hash, content)
      fileManifest[path] = uploaded
    }
    if (previous.length > 0) await db.remove('files', previous.map((r) => r.id))
    await db.create(
      'files',
      Object.entries(files).map(([path]) => ({
        id: crypto.randomUUID(),
        owner_group_id: identity,
        projectId: id,
        path,
        hash: fileManifest[path],
      })),
    )
    const nextManifest = Object.entries(fileManifest).map(([path, media]) => ({ path, hash: media }))
    if (version) {
      const latest = await latestVersion(id)
      const tracked = coalesceKeys.get(id)
      // A restore always mints its own row, and two bursts that were never
      // asked to coalesce (no key), that carry a different key, or whose newest
      // row is not the tracked one (a snapshot landed) never share.
      const folding = coalesceKey && latest && tracked?.key === coalesceKey &&
        tracked.versionId === latest.versionId && !message.startsWith('restore ') &&
        ts - latest.created < coalesceMs
      let versionId = latest?.versionId
      if (folding) {
        // Identical content is not a new version; the file rows above still
        // record the write.
        if (!sameManifest(latest.manifest, nextManifest)) {
          await db.update('versions', latest.id, { manifest: nextManifest, created: ts, message })
        }
      } else {
        versionId = await addVersion(id, nextManifest, message, ts)
      }
      coalesceKeys.set(id, { versionId, key: coalesceKey })
    }
    return { id, entry: entryPath, kind: kindFromEntry(entryPath) }
  }

  const snapshot = async (id, { message = '' } = {}) => {
    await readRow('projects', id)
    const manifest = (await rowsFor('files', id)).map(({ path, hash }) => ({ path, hash }))
    await addVersion(id, manifest, message, now())
  }

  // Snapshot only when the stored manifest differs from the latest version:
  // the switch-away path calls this so an unchanged project mints no row.
  // Returns false when it skipped. No versions yet means the first snapshot.
  const snapshotUnique = async (id, { message = '' } = {}) => {
    await readRow('projects', id)
    const current = (await rowsFor('files', id)).map(({ path, hash }) => ({ path, hash }))
    const latest = await latestVersion(id)
    if (latest && sameManifest(latest.manifest, current)) return false
    await addVersion(id, current, message, now())
    return true
  }

  const listVersions = async (id) => {
    const rows = await rowsFor('versions', id)
    rows.sort((a, b) => b.created - a.created)
    return rows.map(({ versionId, created, message }) => ({ versionId, created, message }))
  }

  const readVersion = async (id, versionId) => {
    const rows = await rowsFor('versions', id)
    const row = rows.find((r) => r.versionId === versionId)
    if (!row) throw new Error(`version not found: ${versionId}`)
    const versionManifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
    const project = await db.table('projects').get(id)
    const files = {}
    for (const { path, hash: media } of versionManifest) files[path] = await contentOf(media)
    return { files, entry: project?.entry ?? 'main.js' }
  }

  const readConversation = async (projectId) => {
    const rows = await rowsFor('conversations', projectId)
    if (rows.length === 0) return null
    const messages = typeof rows[0].messages === 'string' ? JSON.parse(rows[0].messages) : rows[0].messages
    return { messages, updated: rows[0].updated }
  }

  const writeConversation = async (projectId, messages) => {
    const rows = await rowsFor('conversations', projectId)
    if (rows.length > 0) {
      await db.update('conversations', rows[0].id, { messages, updated: now() })
    } else {
      await db.create('conversations', {
        id: crypto.randomUUID(),
        owner_group_id: identity,
        projectId,
        messages,
        updated: now(),
      })
    }
  }

  // Drop the file rows for a delete; the blobs are content-addressed, so an
  // orphan is harmless and the next write of the same content reuses it.
  const removeFiles = async (id, paths) => {
    const rows = await rowsFor('files', id)
    const doomed = rows.filter((r) => paths.includes(r.path))
    if (doomed.length > 0) await db.remove('files', doomed.map((r) => r.id))
  }

  const deleteProject = async (id) => {
    const project = await db.table('projects').get(id)
    if (project && !project.__deleted) await db.remove('projects', id)
    for (const table of ['files', 'versions', 'conversations']) {
      const rows = await rowsFor(table, id)
      if (rows.length > 0) await db.remove(table, rows.map((r) => r.id))
    }
  }

  const close = async () => {
    db.close?.()
    await globalThis.indexedDB?.deleteDatabase?.(dbName)
  }

  return { sync, close, listProjects, readProject, writeFiles, removeFiles, snapshot, snapshotUnique, listVersions, readVersion, readConversation, writeConversation, deleteProject }
}
