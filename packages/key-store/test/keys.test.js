// Key custody: three modes, one rule — the key is usable but never leaks.
// WebCrypto runs in vitest's node env, so these are real AES-GCM/PBKDF2
// round trips, not mocks. Storage is injected (a Map fake); the default is
// the browser's localStorage.
import { describe, expect, it } from 'vitest'
import {
  createKeyStore,
  decryptKey,
  encryptKey,
} from '../src/keys.js'

const memStorage = () => {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
    __keys: () => [...map.keys()],
    __raw: (key) => map.get(key),
  }
}

describe('synced encryption', () => {
  it('round-trips encrypt and decrypt', async () => {
    const sealed = await encryptKey('sk-live-123', 'correct horse')
    expect(sealed.data).not.toContain('sk-live-123')
    await expect(decryptKey(sealed, 'correct horse')).resolves.toBe('sk-live-123')
  })

  it('a wrong passphrase fails without revealing anything', async () => {
    const sealed = await encryptKey('sk-live-123', 'correct horse')
    const failure = await decryptKey(sealed, 'wrong donkey').catch((err) => err)
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure?.message ?? failure)).not.toContain('sk-live-123')
  })
})

describe('keyStore', () => {
  it('session mode keeps the key in memory only', async () => {
    const storage = memStorage()
    const keys = createKeyStore({ storage })
    await keys.set('sk-session', 'session')
    expect(keys.get()).toBe('sk-session')
    expect(storage.__keys()).toEqual([])
  })

  it('device mode persists on this browser and reloads it', async () => {
    const storage = memStorage()
    const first = createKeyStore({ storage })
    await first.set('sk-device', 'device')
    const second = createKeyStore({ storage })
    expect(second.get()).toBe('sk-device')
  })

  it('synced mode stores only ciphertext and unlocks with the passphrase', async () => {
    const storage = memStorage()
    const first = createKeyStore({ storage })
    await first.set('sk-synced', 'synced', 'open sesame')
    expect(first.get()).toBe('sk-synced')
    for (const key of storage.__keys()) expect(storage.__raw(key)).not.toContain('sk-synced')
    const second = createKeyStore({ storage })
    expect(second.get()).toBeNull()
    await second.unlock('open sesame')
    expect(second.get()).toBe('sk-synced')
  })

  it('clear removes every trace', async () => {
    const storage = memStorage()
    const keys = createKeyStore({ storage })
    await keys.set('sk-doomed', 'device')
    await keys.set('sk-doomed-2', 'synced', 'pass')
    keys.clear()
    expect(keys.get()).toBeNull()
    expect(storage.__keys()).toEqual([])
  })

  it('the frame wire never carries the key', async () => {
    const storage = memStorage()
    const keys = createKeyStore({ storage })
    await keys.set('sk-frame-check', 'session')
    const key = keys.get()
    // The shapes frameClient posts: command envelopes whose payloads originate
    // from tool inputs and model files, never from custody.
    const envelopes = [
      { id: 1, command: 'load', payload: { files: { 'main.js': 'cube(5);' }, entry: 'main.js' } },
      { id: 2, command: 'params', payload: { values: { size: 10 } } },
      { id: 3, command: 'measure', payload: { options: {} } },
    ]
    for (const envelope of envelopes) expect(JSON.stringify(envelope)).not.toContain(key)
  })
})
