// Cloud storage against a real local rowboat: the rowboat server boots
// in-process (synthetic author resolution, RBAC off) and the storage layer
// syncs through its HTTP data plane exactly as the app will. Blob reads are
// default-deny on the stock server — the media-table grant is not wired — so
// the blob test asserts the 403, and read paths serve the device-local blob
// cache populated at write time.
import 'fake-indexeddb/auto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBlobClient } from '@jbroll/rowboat-client'
import { compileSchema } from '@jbroll/rowboat-schema'
import { startServer } from '../../../../rowboat/packages/server/src/index.ts'
import { schema } from '../shared/schema.js'
import { createCloudStorage } from '../src/storage/index.js'

const AUTHOR = 'u1'
const dbOptions = { indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange }

let dir
let srv
let syncBase
let filesBase

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-storage-'))
  srv = await startServer({
    routerPort: 0,
    cpDbPath: join(dir, 'cp.db'),
    dbDir: join(dir, 'dbs'),
    backupDir: join(dir, 'backups'),
    meterDir: join(dir, 'metering'),
    routerSecret: 'storage-test-secret',
    resolveAuthor: (req) => req.headers['x-author'] ?? null,
    authSecret: 'storage-auth-secret',
    authBaseUrl: 'http://localhost/api/auth',
    emailAuth: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    identityDbPath: join(dir, 'identity.db'),
    threads: 1,
    objectStore: { kind: 'fs', root: join(dir, 'objects') },
    maxUploadBytes: 1_000_000,
  })
  const sub = srv.controlPlane.createSubscriber({ name: 'jscad-studio-test' })
  const db = srv.controlPlane.createDatabase({
    subscriberId: sub.subscriberId,
    name: 'jscad-studio-test',
    schemaManifest: compileSchema(schema).manifest,
  })
  syncBase = `http://127.0.0.1:${srv.routerPort}/db/${db.databaseId}/api/sync`
  filesBase = `${syncBase}/files`
})

afterAll(async () => {
  await srv.close()
  rmSync(dir, { recursive: true, force: true })
})

const storage = () =>
  createCloudStorage({
    syncBase,
    identity: AUTHOR,
    getHeaders: () => ({ 'x-author': AUTHOR }),
    dbOptions,
  })

const MAIN = 'const gear = { teeth: 12 }'

describe('cloud storage on rowboat', () => {
  it('returns identical content after writing files then reading them back', async () => {
    const store = storage()
    await store.writeFiles(
      'p1',
      { 'main.js': MAIN, 'lib/teeth.js': 'export const n = 12' },
      { message: 'first model', name: 'Gear', entry: 'main.js' },
    )
    const project = await store.readProject('p1')
    expect(project.entry).toBe('main.js')
    expect(project.name).toBe('Gear')
    expect(project.files).toEqual({ 'main.js': MAIN, 'lib/teeth.js': 'export const n = 12' })
  })

  it('serves the same project from a fresh store after a server sync', async () => {
    const writer = storage()
    await writer.writeFiles('p2', { 'main.js': MAIN }, { message: 'synced', name: 'P2', entry: 'main.js' })
    await writer.sync()

    const reader = storage()
    await reader.sync()
    const project = await reader.readProject('p2')
    expect(project.files).toEqual({ 'main.js': MAIN })
    expect(project.entry).toBe('main.js')
  })

  it('writes one version row per write and lists them newest first', async () => {
    const store = storage()
    await store.writeFiles('p3', { 'main.js': 'v1' }, { message: 'one', name: 'P3', entry: 'main.js' })
    await store.writeFiles('p3', { 'main.js': 'v2' }, { message: 'two', entry: 'main.js' })

    const versions = await store.listVersions('p3')
    expect(versions).toHaveLength(2)
    expect(versions.map((v) => v.message)).toEqual(['two', 'one'])
    const latest = await store.readVersion('p3', versions[0].versionId)
    expect(latest.files).toEqual({ 'main.js': 'v2' })
    expect(latest.entry).toBe('main.js')
    const first = await store.readVersion('p3', versions[1].versionId)
    expect(first.files).toEqual({ 'main.js': 'v1' })
  })

  it('derives kind from the entry extension and recomputes it on rename', async () => {
    const store = storage()
    await store.writeFiles('p4', { 'part.scad': 'cube(5);' }, { name: 'Bracket', entry: 'part.scad' })
    expect((await store.readProject('p4')).kind).toBe('openscad')
    await store.writeFiles('p4', { 'part.scad': 'cube(5);' }, { entry: 'part.js' })
    expect((await store.readProject('p4')).kind).toBe('jscad')
    expect((await store.readProject('p4')).entry).toBe('part.js')
  })

  it('denies a blob read until the media-table grant is wired', async () => {
    const blob = createBlobClient({ apiBase: filesBase, author: AUTHOR })
    const { hash } = await blob.upload(new TextEncoder().encode('secret bytes'))
    const sign = await fetch(`${filesBase}/${hash}/sign`, { method: 'POST', headers: { 'x-author': AUTHOR } })
    expect(sign.status).toBe(403)
  })

  it('round-trips a project through export and import as a new project', async () => {
    const store = storage()
    await store.writeFiles(
      'p5',
      { 'main.js': MAIN, 'lib/teeth.js': 'export const n = 12' },
      { message: 'original', name: 'RoundTrip', entry: 'main.js' },
    )
    const zip = await store.exportZip('p5')
    const imported = await store.importZip(zip)
    expect(imported.id).not.toBe('p5')
    const project = await store.readProject(imported.id)
    expect(project.files).toEqual({ 'main.js': MAIN, 'lib/teeth.js': 'export const n = 12' })
    expect(project.entry).toBe('main.js')
    expect(project.kind).toBe('jscad')
  })

  it('stores a conversation per project and resumes it from a fresh store', async () => {
    const messages = [
      { role: 'user', content: 'make a gear' },
      { role: 'assistant', content: 'here it is', toolCalls: [{ id: 't1', name: 'writeModel', input: {} }] },
    ]
    const store = storage()
    await store.writeConversation('p6', messages)
    await store.sync()

    const fresh = storage()
    await fresh.sync()
    const resumed = await fresh.readConversation('p6')
    expect(resumed.messages).toEqual(messages)
  })
})