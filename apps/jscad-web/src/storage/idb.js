// IndexedDB mirror for the local backend. `createLocalStorage` keeps its Maps
// as the working copy and writes every change through here, so a reload reads
// back what the last session stored. `indexedDB` is absent in the compute
// frame and in a private-mode browser; the factory then returns null and the
// Maps are the only store, so the app keeps working without persistence.

export const LOCAL_DB_NAME = 'jscad-web-local'
const DB_VERSION = 1
const STORES = ['projects', 'versions', 'conversations']

export function createIdbPersistence({ indexedDB = globalThis.indexedDB, dbName = LOCAL_DB_NAME } = {}) {
  if (!indexedDB) return null

  let dbPromise = null
  const open = () => {
    dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error(`indexedDB blocked opening ${dbName}`))
    })
    return dbPromise
  }

  const write = async (store, fn) => {
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      fn(tx.objectStore(store))
    })
  }

  return {
    load: async (store) => {
      const db = await open()
      return new Promise((resolve, reject) => {
        const request = db.transaction(store, 'readonly').objectStore(store).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    },
    save: (store, key, value) => write(store, (s) => s.put(value, key)),
    drop: (store, key) => write(store, (s) => s.delete(key)),
  }
}
