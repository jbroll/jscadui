// Sync loop: anonymous users stay local-only; sign-in starts the interval
// loop with the sync-token JWT.
import { describe, expect, it, vi } from 'vitest'
import { createSyncLoop } from '../src/storage/sync.js'

describe('sync loop', () => {
  it('does not sync when anonymous', async () => {
    const storage = { sync: vi.fn() }
    const loop = createSyncLoop({ storage, getToken: async () => null, intervalMs: 10 })
    loop.start()
    await new Promise((r) => setTimeout(r, 30))
    loop.stop()
    expect(storage.sync).not.toHaveBeenCalled()
  })

  it('syncs immediately and on the interval when signed in', async () => {
    const storage = { sync: vi.fn(async () => {}) }
    const loop = createSyncLoop({ storage, getToken: async () => 'jwt', intervalMs: 10 })
    loop.start()
    await vi.waitFor(() => expect(storage.sync).toHaveBeenCalled())
    loop.stop()
  })

  it('reports sync failures to onError without throwing', async () => {
    const storage = { sync: vi.fn(async () => { throw new Error('offline') }) }
    const onError = vi.fn()
    const loop = createSyncLoop({ storage, getToken: async () => 'jwt', intervalMs: 10, onError })
    await loop.syncNow()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }))
  })
})
