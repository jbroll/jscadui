# @jscadui/key-store

Provider-key custody for browser apps: keeps a provider API key usable per
request without leaking it to storage the app doesn't control.

Three custody modes:
- `session` — memory only, gone on reload.
- `device` — persisted in `localStorage` on the app's origin.
- `synced` — only AES-GCM ciphertext is persisted (key derived from a
  passphrase with PBKDF2); a passphrase unlocks it into memory.

```js
import { createKeyStore } from '@jscadui/key-store'

const store = createKeyStore()
await store.set('sk-...', 'synced', 'my passphrase')
store.get() // 'sk-...' (still in memory this session)

// later, after reload
await store.unlock('my passphrase') // decrypts into memory
```

Exports: `createKeyStore(options?)` (`options.storage` defaults to
`localStorage`) returning `{ get, set, unlock, clear }`, plus the underlying
`encryptKey(plaintext, passphrase)` and `decryptKey(sealed, passphrase)`.
