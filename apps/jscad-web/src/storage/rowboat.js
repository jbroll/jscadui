import { buildRowboatDb, createBlobClient, storeName, syncWithServer } from '@jbroll/rowboat-client'
import { compileSchema } from '@jbroll/rowboat-schema'
import { schema } from './schema.js'
import { kindFromEntry } from './local.js'

const APP_NAME = 'jscad-web'
const APP_VERSION = 0

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

  const manifest = compileSchema(schema).manifest
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
    if (!row || row.__deleted) throw new Error(`${table}: not found (${id})`)
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
        mode: 'rowboat',
        created: ts,
        updated: ts,
      })
    }
    const fileManifest = {}
    for (const [path, content] of Object.entries(files)) {
      const { hash, size } = await blobs.upload(new TextEncoder().encode(content))
      cache.set(hash, content)
      fileManifest[path] = { hash, size }
    }
    const previous = await rowsFor('files', id)
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
    await db.create('versions', {
      id: crypto.randomUUID(),
      owner_group_id: identity,
      projectId: id,
      versionId: crypto.randomUUID(),
      created: ts,
      message,
      manifest: Object.entries(fileManifest).map(([path, media]) => ({ path, hash: media })),
    })
    return { id, entry: entryPath, kind: kindFromEntry(entryPath) }
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

  const close = async () => {
    db.close?.()
    await globalThis.indexedDB?.deleteDatabase?.(dbName)
  }

  return { sync, close, listProjects, readProject, writeFiles, listVersions, readVersion, readConversation, writeConversation }
}
