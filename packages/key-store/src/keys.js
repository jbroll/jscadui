// Provider-key custody: the user's key is usable per request but never leaks.
// session keeps it in memory only; device persists it on this browser's app
// origin; synced persists only AES-GCM ciphertext (PBKDF2 from a passphrase)
// and decrypts into memory on unlock. Nothing here ever sends the key to the
// frame — it rides only the POST body to the API, which never stores it.
const STORE_KEY = 'jscad-studio.key'
const PBKDF2_ITERATIONS = 100_000

const bytes = (length) => crypto.getRandomValues(new Uint8Array(length))
const b64encode = (data) => btoa(String.fromCharCode(...data))
const b64decode = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0))

async function passwordKey(passphrase, salt, usages) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

export async function encryptKey(plaintext, passphrase) {
  const salt = bytes(16)
  const iv = bytes(12)
  const key = await passwordKey(passphrase, salt, ['encrypt'])
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)))
  return { salt: b64encode(salt), iv: b64encode(iv), data: b64encode(data) }
}

export async function decryptKey(sealed, passphrase) {
  const key = await passwordKey(passphrase, b64decode(sealed.salt), ['decrypt'])
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(sealed.iv) }, key, b64decode(sealed.data))
  return new TextDecoder().decode(data)
}

export function createKeyStore(options = {}) {
  const storage = options.storage ?? globalThis.localStorage
  let memoryKey = null

  const store = {
    // A fresh page load starts with empty memory; device-mode keys reload
    // lazily, synced-mode keys wait for unlock with the passphrase.
    get: () => {
      if (memoryKey !== null) return memoryKey
      const raw = storage.getItem(STORE_KEY)
      const stored = raw ? JSON.parse(raw) : null
      if (stored?.mode === 'device' && typeof stored.key === 'string') memoryKey = stored.key
      return memoryKey
    },

    set: async (key, mode, passphrase) => {
      store.clear()
      if (mode === 'session') {
        memoryKey = key
      } else if (mode === 'device') {
        storage.setItem(STORE_KEY, JSON.stringify({ mode, key }))
        memoryKey = key
      } else if (mode === 'synced') {
        if (!passphrase) throw new Error('key custody: synced mode needs a passphrase')
        storage.setItem(STORE_KEY, JSON.stringify({ mode, sealed: await encryptKey(key, passphrase) }))
        memoryKey = key
      } else {
        throw new Error(`key custody: unknown mode (${mode})`)
      }
    },

    unlock: async (passphrase) => {
      const raw = storage.getItem(STORE_KEY)
      const stored = raw ? JSON.parse(raw) : null
      if (!stored || stored.mode !== 'synced' || !stored.sealed) {
        throw new Error('key custody: nothing to unlock')
      }
      memoryKey = await decryptKey(stored.sealed, passphrase)
      return memoryKey
    },

    clear: () => {
      memoryKey = null
      storage.removeItem(STORE_KEY)
    },
  }
  return store
}
