// Rowboat backend without a live server: table reads/writes hit the local
// rowboat store; sync and blob traffic go through a recorded-transcript
// fetchFn whose calls the test asserts on.
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { createRowboatStorage } from '../src/storage/rowboat.js'

const dbOptions = { indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange }
const MAIN = 'const gear = { teeth: 12 }'

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
    const fetchFn = vi.fn(async (url) => {
      if (String(url).endsWith('/sync')) {
        return new Response(JSON.stringify({ ok: true, serverCursor: 1, prePushCursor: 0, echo: {} }))
      }
      return new Response(JSON.stringify({ changes: {}, timestamp: 1, hasMore: false, maxPurgedCursor: 0 }))
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

  it('persists a conversation per project', async () => {
    const store = transcriptStorage(vi.fn(async () => new Response('{}')))
    const messages = [{ role: 'user', content: 'make a gear' }]
    await store.writeConversation('p3', messages)
    expect((await store.readConversation('p3')).messages).toEqual(messages)
    await store.close()
  })
})
