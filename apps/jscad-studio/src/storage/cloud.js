// The cloud storage mode: rowboat data plane, following checklist's pattern —
// buildRowboatDb for the local store, syncWithServer for the server round trip,
// file routes for blob bytes. The local store is authoritative for reads; blobs
// are uploaded at write time and their content cached device-locally, because
// the stock rowboat server default-denies blob reads until the media-table
// grant is wired (the schema declares the media tables this mode needs).
import { buildRowboatDb, createBlobClient, storeName, syncWithServer } from '@jbroll/rowboat-client'
import { compileSchema } from '@jbroll/rowboat-schema'
import Dexie from 'dexie'
import { schema } from '../../shared/schema.js'

const APP_NAME = 'jscad-studio'
// rowboat 400s a push/pull without appVersion; 0 means this app has no schema versioning yet.
const APP_VERSION = 0
const BLOB_CACHE_DB = 'jscad-studio-blob-cache'

// Mirrors both loaders: .scad starts the OpenSCAD pipeline, everything else the JS one.
export const kindFromEntry = (entry) => (entry.toLowerCase().endsWith('.scad') ? 'openscad' : 'jscad')

const parseJson = (value, what) => {
  if (typeof value !== 'string') throw new Error(`${what}: expected a JSON string`)
  return JSON.parse(value)
}

const readRow = async (db, table, id) => {
  const row = await db.table(table).get(id)
  if (!row || row.__deleted) throw new Error(`${table}: not found (${id})`)
  return row
}

const rowsFor = async (db, table, projectId) =>
  db
    .table(table)
    .where('projectId')
    .equals(projectId)
    .filter((r) => !r.__deleted)
    .toArray()

// Device-local content cache keyed by content hash: the read path serves blob
// bytes from here (the write path filled it), falling back to the file routes
// once a server grants media reads.
function createBlobCache() {
  const cache = new Dexie(BLOB_CACHE_DB)
  cache.version(1).stores({ blobs: 'hash' })
  return {
    async put(hash, content) {
      await cache.table('blobs').put({ hash, content })
    },
    async get(hash) {
      return (await cache.table('blobs').get(hash))?.content
    },
  }
}

export function createCloudStorage(options) {
  const {
    syncBase,
    filesBase = `${syncBase}/files`,
    identity,
    getHeaders = async () => ({}),
    dbOptions,
    fetchFn,
  } = options

  const manifest = compileSchema(schema).manifest
  const db = buildRowboatDb(storeName(APP_NAME, identity), manifest, [], undefined, dbOptions)
  const cache = createBlobCache()

  // One authed fetch for sync and blob traffic; per-request headers let the
  // bearer token refresh without rebuilding the clients.
  const authFetch = async (input, init) => {
    const headers = { ...(await getHeaders()), ...(init?.headers ?? {}) }
    return (fetchFn ?? fetch)(input, { ...init, headers })
  }
  const blobClient = createBlobClient({ apiBase: filesBase, fetchFn: authFetch })

  const now = () => Date.now()

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
    // The media cell is stored as a JSON string (the rowboat store's json
    // representation), whatever the write path passed in.
    const cell = typeof media === 'string' ? JSON.parse(media) : media
    const cached = await cache.get(cell.hash)
    if (cached !== undefined) return cached
    const res = await blobClient.fetch(cell.hash)
    return new TextDecoder().decode(await res.arrayBuffer())
  }

  const listProjects = async () => {
    const rows = await db
      .table('projects')
      .filter((r) => !r.__deleted)
      .toArray()
    rows.sort((a, b) => b.updated - a.updated)
    return rows.map(({ id, name, entry, kind, mode, created, updated }) => ({
      id,
      name,
      entry,
      kind,
      mode,
      created,
      updated,
    }))
  }

  const readProject = async (id) => {
    const row = await readRow(db, 'projects', id)
    const files = {}
    for (const file of await rowsFor(db, 'files', id)) files[file.path] = await contentOf(file.hash)
    return {
      id,
      name: row.name,
      entry: row.entry,
      kind: row.kind,
      mode: row.mode,
      created: row.created,
      updated: row.updated,
      files,
    }
  }

  const writeFiles = async (id, files, options = {}) => {
    const { message = '', name, entry } = options
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
        mode: 'cloud',
        created: ts,
        updated: ts,
      })
    }

    // Each file's bytes go to the object store; the version snapshot references them.
    const manifest = {}
    for (const [path, content] of Object.entries(files)) {
      const { hash, size } = await blobClient.upload(new TextEncoder().encode(content))
      await cache.put(hash, content)
      manifest[path] = { hash, size }
    }

    const previous = await rowsFor(db, 'files', id)
    if (previous.length > 0) await db.remove('files', previous.map((r) => r.id))
    await db.create(
      'files',
      Object.entries(files).map(([path]) => ({
        id: crypto.randomUUID(),
        owner_group_id: identity,
        projectId: id,
        path,
        hash: manifest[path],
      })),
    )

    await db.create('versions', {
      id: crypto.randomUUID(),
      owner_group_id: identity,
      projectId: id,
      versionId: crypto.randomUUID(),
      created: ts,
      message,
      manifest: Object.entries(manifest).map(([path, media]) => ({ path, hash: media })),
    })
    return { id, entry: entryPath, kind: kindFromEntry(entryPath) }
  }

  const listVersions = async (id) => {
    const rows = await rowsFor(db, 'versions', id)
    rows.sort((a, b) => b.created - a.created)
    return rows.map(({ versionId, created, message }) => ({ versionId, created, message }))
  }

  const readVersion = async (id, versionId) => {
    const rows = await rowsFor(db, 'versions', id)
    const row = rows.find((r) => r.versionId === versionId)
    if (!row) throw new Error(`version not found: ${versionId}`)
    const manifest = parseJson(row.manifest, 'version manifest')
    const project = await db.table('projects').get(id)
    const files = {}
    for (const { path, hash: media } of manifest) files[path] = await contentOf(media)
    return { files, entry: project?.entry ?? 'main.js' }
  }

  const readConversation = async (projectId) => {
    const rows = await rowsFor(db, 'conversations', projectId)
    if (rows.length === 0) return null
    const row = rows[0]
    return { messages: parseJson(row.messages, 'conversation messages'), updated: row.updated }
  }

  const writeConversation = async (projectId, messages) => {
    const rows = await rowsFor(db, 'conversations', projectId)
    const ts = now()
    if (rows.length > 0) {
      await db.update('conversations', rows[0].id, { messages, updated: ts })
    } else {
      await db.create('conversations', {
        id: crypto.randomUUID(),
        owner_group_id: identity,
        projectId,
        messages,
        updated: ts,
      })
    }
  }

  return { sync, listProjects, readProject, writeFiles, listVersions, readVersion, readConversation, writeConversation }
}