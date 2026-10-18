// Rowboat backend without a live server: table reads/writes hit the local
// rowboat store; sync and blob traffic go through a recorded-transcript
// fetchFn whose calls the test asserts on.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRowboatStorage } from '../src/storage/rowboat.js'

const dbOptions = { indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange }
const MAIN = 'const gear = { teeth: 12 }'

const sha256Hex = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('')

const transcriptStorage = (fetchFn) =>
  createRowboatStorage({
    syncBase: 'http://fake/db/x/api/sync',
    identity: 'u1',
    getHeaders: async () => ({ authorization: 'Bearer test-jwt' }),
    dbOptions,
    fetchFn,
    blobClient: {
      upload: async (bytes) => ({ hash: `h${bytes.length}`, size: bytes.length }),
      fetch: async () => { throw new Error('unexpected blob fetch in transcript test') },
    },
  })

describe('rowboat backend', () => {
  it('writes files then reads them back from the local store', async () => {
    const store = transcriptStorage(vi.fn(async () => new Response('{}')))
    await store.writeFiles('p1', { 'main.js': MAIN }, { message: 'first', name: 'Gear', entry: 'main.js' })
    const project = await store.readProject('p1')
    expect(project.files).toEqual({ 'main.js': MAIN })
    expect(project.mode).toBe('rowboat')
    await store.close()
  })

  it('sends the bearer token on sync and records one version per write', async () => {
    // Recorded transcript shape from the rowboat client's own sync tests:
    // push answers cursors plus an echo map, pull answers an empty page.
    // mergeRule 2 is rowboat-shared's MERGE_RULE; the client refuses a reply
    // that names another rule.
    const fetchFn = vi.fn(async (url) => {
      if (String(url).endsWith('/sync')) {
        return new Response(
          JSON.stringify({ ok: true, serverCursor: 1, prePushCursor: 0, echo: {}, rejected: [], mergeRule: 2 }),
        )
      }
      return new Response(JSON.stringify({ changes: {}, timestamp: 1, hasMore: false, maxPurgedCursor: 0, mergeRule: 2 }))
    })
    const store = transcriptStorage(fetchFn)
    await store.writeFiles('p2', { 'main.js': 'v1' }, { message: 'one', name: 'P2', entry: 'main.js' })
    await store.writeFiles('p2', { 'main.js': 'v2' }, { message: 'two' })
    await store.sync()
    expect(fetchFn).toHaveBeenCalled()
    const [, init] = fetchFn.mock.calls[0]
    expect(init.headers.authorization).toBe('Bearer test-jwt')
    const versions = await store.listVersions('p2')
    expect(versions.map((v) => v.message)).toEqual(['two', 'one'])
    await store.close()
  })

  it('writes without a version row when asked, and snapshots the stored files as one', async () => {
    const store = transcriptStorage(vi.fn(async () => new Response('{}')))
    await store.writeFiles('p4', { 'main.js': 'v1' }, { message: 'create', name: 'P4', entry: 'main.js' })
    await store.writeFiles('p4', { 'main.js': 'v2!', 'lib.js': 'l' }, { message: 'chat', version: false })
    expect((await store.listVersions('p4')).map((v) => v.message)).toEqual(['create'])
    await store.snapshot('p4', { message: 'chat' })
    const versions = await store.listVersions('p4')
    expect(versions.map((v) => v.message)).toEqual(['chat', 'create'])
    expect((await store.readVersion('p4', versions[0].versionId)).files).toEqual({ 'main.js': 'v2!', 'lib.js': 'l' })
    await store.close()
  })

  it('skips the upload when a file is unchanged since its last write', async () => {
    const uploads = []
    const blobClient = {
      upload: async (bytes) => {
        uploads.push(bytes)
        return { hash: await sha256Hex(bytes), size: bytes.byteLength }
      },
      fetch: async () => { throw new Error('unexpected blob fetch') },
    }
    const store = createRowboatStorage({
      syncBase: 'http://fake/db/x/api/sync',
      identity: 'u1',
      getHeaders: async () => ({}),
      dbOptions,
      fetchFn: vi.fn(async () => new Response('{}')),
      blobClient,
    })
    await store.writeFiles('p5', { 'main.js': 'same', 'lib.js': 'l1' }, { message: 'one', name: 'P5', entry: 'main.js' })
    await store.writeFiles('p5', { 'main.js': 'same', 'lib.js': 'l2' }, { message: 'two' })
    expect(uploads).toHaveLength(3)
    expect(new TextDecoder().decode(uploads[0])).toBe('same')
    expect((await store.readProject('p5')).files).toEqual({ 'main.js': 'same', 'lib.js': 'l2' })
    await store.close()
  })

  it('persists a conversation per project', async () => {
    const store = transcriptStorage(vi.fn(async () => new Response('{}')))
    const messages = [{ role: 'user', content: 'make a gear' }]
    await store.writeConversation('p3', messages)
    expect((await store.readConversation('p3')).messages).toEqual(messages)
    await store.close()
  })

  it('removes a file row so it is not read back', async () => {
    const store = transcriptStorage(vi.fn(async () => new Response('{}')))
    await store.writeFiles('p6', { 'main.js': 'main', 'lib.js': 'lib-content' }, { message: 'create', name: 'P6', entry: 'main.js' })
    await store.removeFiles('p6', ['lib.js'])
    expect((await store.readProject('p6')).files).toEqual({ 'main.js': 'main' })
    await store.close()
  })
})

describe('rowboat edit coalescing', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  // A content-addressed blob client, so a changed file gets a changed hash and
  // the manifest comparison the coalescing relies on is meaningful.
  const contentStore = () =>
    createRowboatStorage({
      syncBase: 'http://fake/db/x/api/sync',
      identity: `u1-${crypto.randomUUID()}`,
      getHeaders: async () => ({}),
      dbOptions,
      fetchFn: vi.fn(async () => new Response('{}')),
      blobClient: {
        upload: async (bytes) => ({ hash: await sha256Hex(bytes), size: bytes.byteLength }),
        fetch: async () => { throw new Error('unexpected blob fetch in coalescing test') },
      },
    })

  const edit = { message: 'edit', coalesceKey: 'edit', coalesceMs: 300000 }

  it('folds a burst of edits into one row holding the latest manifest', async () => {
    vi.setSystemTime(1_000_000)
    const store = contentStore()
    await store.writeFiles('p1', { 'main.js': 'v1' }, { message: 'create', name: 'P', entry: 'main.js' })
    await store.writeFiles('p1', { 'main.js': 'v2' }, edit)
    vi.setSystemTime(1_060_000)
    await store.writeFiles('p1', { 'main.js': 'v3' }, edit)

    const versions = await store.listVersions('p1')
    expect(versions.map((v) => v.message)).toEqual(['edit', 'create'])
    expect((await store.readVersion('p1', versions[0].versionId)).files).toEqual({ 'main.js': 'v3' })
    await store.close()
  })

  it('mints a new row once the idle window has passed', async () => {
    vi.setSystemTime(1_000_000)
    const store = contentStore()
    await store.writeFiles('p2', { 'main.js': 'v1' }, edit)
    vi.setSystemTime(1_000_000 + 300000 + 1)
    await store.writeFiles('p2', { 'main.js': 'v2' }, edit)

    expect(await store.listVersions('p2')).toHaveLength(2)
    await store.close()
  })

  it('never folds across a different coalesce key', async () => {
    vi.setSystemTime(1_000_000)
    const store = contentStore()
    await store.writeFiles('p3', { 'main.js': 'v1' }, edit)
    await store.writeFiles('p3', { 'main.js': 'v2' }, { message: 'edit', coalesceKey: 'other', coalesceMs: 300000 })

    expect(await store.listVersions('p3')).toHaveLength(2)
    await store.close()
  })

  it('always mints a row for a restore even inside the window', async () => {
    vi.setSystemTime(1_000_000)
    const store = contentStore()
    await store.writeFiles('p4', { 'main.js': 'v1' }, edit)
    await store.writeFiles('p4', { 'main.js': 'v0' }, { message: 'restore abcdef12', coalesceKey: 'edit', coalesceMs: 300000 })

    expect((await store.listVersions('p4')).map((v) => v.message)).toEqual(['restore abcdef12', 'edit'])
    await store.close()
  })

  it('skips the row when the manifest matches the latest version', async () => {
    vi.setSystemTime(1_000_000)
    const store = contentStore()
    await store.writeFiles('p5', { 'main.js': 'v1' }, edit)
    await store.writeFiles('p5', { 'main.js': 'v1' }, edit)

    expect(await store.listVersions('p5')).toHaveLength(1)
    expect((await store.readProject('p5')).files).toEqual({ 'main.js': 'v1' })
    await store.close()
  })

  it('never folds an edit onto a snapshot row that landed inside the window', async () => {
    vi.setSystemTime(1_000_000)
    const store = contentStore()
    await store.writeFiles('p8', { 'main.js': 'v1' }, edit)
    await store.snapshot('p8', { message: 'chat' })
    await store.writeFiles('p8', { 'main.js': 'v2' }, edit)

    const versions = await store.listVersions('p8')
    expect(versions).toHaveLength(3)
    expect(versions.map((v) => v.message)).toEqual(['edit', 'chat', 'edit'])
    const chat = versions.find((v) => v.message === 'chat')
    expect((await store.readVersion('p8', chat.versionId)).files).toEqual({ 'main.js': 'v1' })
    await store.close()
  })

  it('snapshots only when the stored manifest differs from the latest version', async () => {
    const store = contentStore()
    await store.writeFiles('p6', { 'main.js': 'v1' }, { message: 'create', name: 'P6', entry: 'main.js' })
    expect(await store.snapshotUnique('p6', { message: 'unique' })).toBe(false)
    await store.writeFiles('p6', { 'main.js': 'v2' }, { message: 'edit', version: false })
    expect(await store.snapshotUnique('p6', { message: 'unique' })).toBe(true)
    expect(await store.snapshotUnique('p6', { message: 'unique' })).toBe(false)
    expect((await store.listVersions('p6')).map((v) => v.message)).toEqual(['unique', 'create'])
    await store.close()
  })

  it('snapshots the first version when the project has none', async () => {
    const store = contentStore()
    await store.writeFiles('p7', { 'main.js': 'v1' }, { name: 'P7', entry: 'main.js', version: false })
    expect(await store.snapshotUnique('p7', { message: 'unique' })).toBe(true)
    expect((await store.listVersions('p7')).map((v) => v.message)).toEqual(['unique'])
    await store.close()
  })
})
