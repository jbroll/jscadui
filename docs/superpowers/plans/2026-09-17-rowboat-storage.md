# Rowboat storage for jscad-web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/jscad-web` local-first rowboat storage with per-project `local`/`rowboat` file modes, versioned metadata, and per-project chat persistence that syncs when signed in.

**Architecture:** A new vanilla-JS storage layer under `apps/jscad-web/src/storage/` (schema + local backend + rowboat backend + zip + map assembly) behind one interface; `main.js`/`editor.js`/`aiBridge.js`/`aiChat.js` call it; a new `GET /api/sync-token` route on the studio server mints the 15m data-plane JWT the browser sync loop uses.

**Tech Stack:** ES modules, `@jbroll/rowboat-client` (`buildRowboatDb`, `syncWithServer`, `createBlobClient`, `storeName`), `@jbroll/rowboat-schema` (`rb`, `compileSchema`), `fflate` (`zipSync`/`unzipSync`), `dexie` (blob cache only), `vitest` (node + jsdom), Express + supertest for the token route.

**Spec:** `docs/superpowers/specs/2026-09-17-rowboat-storage-design.md`

## Global Constraints

- jscadui style: ES modules, single quotes, no semicolons. Comments: none unless they say why, one or two lines.
- Settings stay where they are: provider selection in `localStorage`, keys in `@jscadui/key-store`. No settings/key sync across devices.
- Anonymous users get the local store only; sign-in starts the sync loop with a short-lived JWT (15m expiry, same shape as the data-plane tokens).
- Per-project `mode`: `local` (default, current FS/handle behavior) or `rowboat` (bytes as blobs via rowboat file routes, media tables declared so reads are not default-deny).
- Each manifest path names exactly one backend, so collisions cannot occur. Local models can require rowboat parts and vice versa.
- Sharing is schema-ready but off: rows carry group scoping from day one, no share UI or routes in this slice.
- The `view`/`measure` loop is untouched.
- Tests: no live server. Interface tests use a fake local backend plus a recorded sync transcript (mock `fetchFn`); mixed-manifest map assembly is a pure unit test; zip export/import is a round-trip test.
- Existing anonymous local files become `local`-mode projects as-is. No migration UI.
- Branch: current working branch in `/home/john/src/jscadui`. Commit per task.

---

### Task 1: Schema and storage interface with fake local backend

**Files:**
- Create: `apps/jscad-web/src/storage/schema.js`
- Create: `apps/jscad-web/src/storage/index.js`
- Create: `apps/jscad-web/src/storage/local.js`
- Create: `apps/jscad-web/test/storage-interface.test.js`
- Modify: `apps/jscad-web/package.json`
- Read for reference: `apps/jscad-studio/shared/schema.ts:1-86`, `apps/jscad-studio/src/storage/index.js:1-45`, `apps/jscad-web/src/fileSystem.js:39-53`, `apps/jscad-web/test/aiBridge.test.js:1-16`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `schema` in `schema.js`: rowboat schema object with tables `projects`, `files`, `versions`, `conversations`, every table scoped via `rb.scope()`.
  - `kindFromEntry(entry) => 'jscad' | 'openscad'`: `.scad` suffix (case-insensitive) maps to `openscad`, everything else to `jscad`.
  - Storage interface (every backend implements): `listProjects()`, `readProject(id)`, `writeFiles(id, files, { message, name, entry, mode })`, `listVersions(id)`, `readVersion(id, versionId)`, `readConversation(projectId)`, `writeConversation(projectId, messages)`.
  - `createLocalStorage()` in `local.js`: in-memory Map-backed implementation of the interface, `mode` defaults to `'local'`.

- [ ] **Step 1: Add test deps to apps/jscad-web**

  `apps/jscad-web/package.json` already has `vitest`. The interface test runs under node with fake-indexeddb available at the repo root; add it as a devDependency of jscad-web so `npx vitest run` resolves it:

```json
"fake-indexeddb": "^6.0.0"
```

  Run: `cd apps/jscad-web && npm install --no-save fake-indexeddb 2>&1 | tail -3` only if the import fails; otherwise skip the install and note it in the commit message. Do not otherwise edit dependencies in this task.

- [ ] **Step 2: Write the failing interface test**

  Create `apps/jscad-web/test/storage-interface.test.js`:

```js
// Storage interface contract against the fake local backend: every mode
// implements the same shape, so the editor and chat can swap backends.
import { describe, expect, it } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'

const MAIN = 'const gear = { teeth: 12 }'

describe('storage interface (local backend)', () => {
  it('writes files then reads them back with kind derived from entry', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p1', { 'main.js': MAIN }, { message: 'first', name: 'Gear', entry: 'main.js' })
    const project = await store.readProject('p1')
    expect(project.files).toEqual({ 'main.js': MAIN })
    expect(project.kind).toBe('jscad')
    expect(project.mode).toBe('local')
  })

  it('derives openscad kind from a .scad entry', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p2', { 'part.scad': 'cube(5);' }, { name: 'Bracket', entry: 'part.scad' })
    expect((await store.readProject('p2')).kind).toBe('openscad')
  })

  it('writes one version row per write and lists them newest first', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p3', { 'main.js': 'v1' }, { message: 'one', name: 'P3', entry: 'main.js' })
    await store.writeFiles('p3', { 'main.js': 'v2' }, { message: 'two' })
    const versions = await store.listVersions('p3')
    expect(versions).toHaveLength(2)
    expect(versions.map((v) => v.message)).toEqual(['two', 'one'])
    const latest = await store.readVersion('p3', versions[0].versionId)
    expect(latest.files).toEqual({ 'main.js': 'v2' })
  })

  it('stores a conversation per project and returns null when absent', async () => {
    const store = createLocalStorage()
    expect(await store.readConversation('missing')).toBeNull()
    const messages = [{ role: 'user', content: 'make a gear' }]
    await store.writeConversation('p4', messages)
    const resumed = await store.readConversation('p4')
    expect(resumed.messages).toEqual(messages)
  })

  it('lists projects newest first', async () => {
    const store = createLocalStorage()
    await store.writeFiles('a', { 'main.js': 'a' }, { name: 'A', entry: 'main.js' })
    await store.writeFiles('b', { 'main.js': 'b' }, { name: 'B', entry: 'main.js' })
    const ids = (await store.listProjects()).map((p) => p.id)
    expect(ids).toEqual(['b', 'a'])
  })
})
```

  Run: `cd apps/jscad-web && npx vitest run test/storage-interface.test.js`
  Expected: FAIL with "Cannot find module '../src/storage/local.js'".

- [ ] **Step 3: Write the schema**

  Create `apps/jscad-web/src/storage/schema.js`. Follows `apps/jscad-studio/shared/schema.ts` but with `mode` scoped to this app (`'local' | 'rowboat'`) and no `settings` table (spec: settings stay in `localStorage`/`key-store`):

```js
import { rb } from '@jbroll/rowboat-schema'
import { z } from 'zod'

export const Project = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  name: rb.text(),
  entry: rb.text(),
  kind: rb.text(),
  mode: rb.text(),
  created: rb.int(),
  updated: rb.int(),
})

export const FileRow = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  projectId: rb.text({ index: true }),
  path: rb.text(),
  hash: rb.media(),
})

export const Version = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  projectId: rb.text({ index: true }),
  versionId: rb.text(),
  created: rb.int(),
  message: rb.text(),
  manifest: rb.json(z.array(z.object({ path: z.string(), hash: rb.media() }))),
})

export const Conversation = z.object({
  id: rb.id(),
  owner_group_id: rb.scope(),
  projectId: rb.text({ index: true }),
  messages: rb.json(z.array(z.unknown())),
  updated: rb.int(),
})

export const schema = {
  projects: Project,
  files: FileRow,
  versions: Version,
  conversations: Conversation,
}
```

  Note: `zod` is not currently a dependency of jscad-web. `@jbroll/rowboat-schema` depends on it, so the import resolves; if `npx vitest run` reports it cannot resolve `zod`, add `"zod": "4.4.3"` to `apps/jscad-web/package.json` dependencies (matching studio) and run `npm install` in `apps/jscad-web`.

- [ ] **Step 4: Implement the local backend and interface index**

  Create `apps/jscad-web/src/storage/local.js`:

```js
export const kindFromEntry = (entry) => (entry.toLowerCase().endsWith('.scad') ? 'openscad' : 'jscad')

export function createLocalStorage() {
  const projects = new Map()
  const versions = new Map()
  const conversations = new Map()

  const now = () => Date.now()

  const listProjects = async () => {
    const rows = [...projects.values()]
    rows.sort((a, b) => b.updated - a.updated)
    return rows.map(({ id, name, entry, kind, mode, created, updated }) => ({
      id, name, entry, kind, mode, created, updated,
    }))
  }

  const readProject = async (id) => {
    const row = projects.get(id)
    if (!row) throw new Error(`projects: not found (${id})`)
    return { ...row, files: { ...row.files } }
  }

  const writeFiles = async (id, files, options = {}) => {
    const { message = '', name, entry, mode = 'local' } = options
    const existing = projects.get(id)
    const entryPath = entry ?? existing?.entry ?? 'main.js'
    const ts = now()
    const row = {
      id,
      name: name ?? existing?.name ?? 'Untitled',
      entry: entryPath,
      kind: kindFromEntry(entryPath),
      mode: existing?.mode ?? mode,
      created: existing?.created ?? ts,
      updated: ts,
      files: { ...files },
    }
    projects.set(id, row)
    const list = versions.get(id) ?? []
    list.unshift({ versionId: crypto.randomUUID(), created: ts, message, files: { ...files }, entry: entryPath })
    versions.set(id, list)
    return { id, entry: entryPath, kind: row.kind }
  }

  const listVersions = async (id) =>
    (versions.get(id) ?? []).map(({ versionId, created, message }) => ({ versionId, created, message }))

  const readVersion = async (id, versionId) => {
    const row = (versions.get(id) ?? []).find((v) => v.versionId === versionId)
    if (!row) throw new Error(`version not found: ${versionId}`)
    return { files: { ...row.files }, entry: row.entry }
  }

  const readConversation = async (projectId) => {
    const row = conversations.get(projectId)
    return row ? { messages: row.messages, updated: row.updated } : null
  }

  const writeConversation = async (projectId, messages) => {
    conversations.set(projectId, { messages, updated: now() })
  }

  return { listProjects, readProject, writeFiles, listVersions, readVersion, readConversation, writeConversation }
}
```

  Create `apps/jscad-web/src/storage/index.js`:

```js
export { schema } from './schema.js'
export { createLocalStorage, kindFromEntry } from './local.js'
```

- [ ] **Step 5: Run the test to verify it passes**

  Run: `cd apps/jscad-web && npx vitest run test/storage-interface.test.js`
  Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-web/src/storage apps/jscad-web/test/storage-interface.test.js apps/jscad-web/package.json
git commit -m "feat(jscad-web): storage interface with local backend and schema"
```

---

### Task 2: Rowboat backend with recorded sync transcript (no live server)

**Files:**
- Create: `apps/jscad-web/src/storage/rowboat.js`
- Create: `apps/jscad-web/test/storage-rowboat.test.js`
- Modify: `apps/jscad-web/src/storage/index.js`
- Modify: `apps/jscad-web/package.json`
- Read for reference: `apps/jscad-studio/src/storage/cloud.js:1-110`, `apps/jscad-studio/test/storage-cloud.test.js:64-122`, `/home/john/src/rowboat/packages/client/src/files.ts:1-80`, `/home/john/src/rowboat/packages/client/src/sync.ts:1-60`

**Interfaces:**
- Consumes: Task 1's `schema`, `kindFromEntry`, storage interface shape.
- Produces: `createRowboatStorage({ syncBase, filesBase, identity, getHeaders, dbOptions, fetchFn, blobClient }) => storage interface + { sync, close }`. `sync()` calls `syncWithServer` with `appVersion: 0`. Blob bytes upload at write time via `createBlobClient` and are cached device-locally in a Map (no Dexie in tests; Dexie-backed cache only in the browser wiring from Task 4).

- [ ] **Step 1: Add rowboat deps to jscad-web**

  In `apps/jscad-web/package.json` dependencies add (matching studio versions):

```json
"@jbroll/rowboat-client": "file:../../../rowboat/packages/client",
"@jbroll/rowboat-schema": "file:../../../rowboat/packages/schema",
"dexie": "4.4.4",
"zod": "4.4.3"
```

  Run: `cd apps/jscad-web && npm install 2>&1 | tail -3`
  Expected: install succeeds; `node -e "import('@jbroll/rowboat-client').then(m => console.log(Object.keys(m).sort().join(',')))"` lists `buildRowboatDb,createBlobClient,storeName,syncWithServer`.

- [ ] **Step 2: Write the failing rowboat test (recorded transcript, no live server)**

  Create `apps/jscad-web/test/storage-rowboat.test.js`:

```js
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
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ops: [] })))
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
```

  Run: `cd apps/jscad-web && npx vitest run test/storage-rowboat.test.js`
  Expected: FAIL with "Cannot find module '../src/storage/rowboat.js'".

- [ ] **Step 3: Implement the rowboat backend**

  Create `apps/jscad-web/src/storage/rowboat.js`. Follows `apps/jscad-studio/src/storage/cloud.js` except: `mode` is `'rowboat'`, the blob cache is an injected Map (tests) defaulting to a module-local Map, and `close()` drops the IndexedDB database so transcript tests stay isolated:

```js
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
    const manifest = {}
    for (const [path, content] of Object.entries(files)) {
      const { hash, size } = await blobs.upload(new TextEncoder().encode(content))
      cache.set(hash, content)
      manifest[path] = { hash, size }
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
    const rows = await rowsFor('versions', id)
    rows.sort((a, b) => b.created - a.created)
    return rows.map(({ versionId, created, message }) => ({ versionId, created, message }))
  }

  const readVersion = async (id, versionId) => {
    const rows = await rowsFor('versions', id)
    const row = rows.find((r) => r.versionId === versionId)
    if (!row) throw new Error(`version not found: ${versionId}`)
    const manifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
    const project = await db.table('projects').get(id)
    const files = {}
    for (const { path, hash: media } of manifest) files[path] = await contentOf(media)
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
```

  Update `apps/jscad-web/src/storage/index.js`:

```js
export { schema } from './schema.js'
export { createLocalStorage, kindFromEntry } from './local.js'
export { createRowboatStorage } from './rowboat.js'
```

- [ ] **Step 4: Run both storage tests**

  Run: `cd apps/jscad-web && npx vitest run test/storage-interface.test.js test/storage-rowboat.test.js`
  Expected: PASS. If `sync()` rejects on the canned `{ ops: [] }` transcript, adjust the mock to echo the minimal pull shape the installed `@jbroll/rowboat-client` expects (read its `sync.ts` error, record the exact JSON in a comment above the mock, keep the transcript recorded in the test file).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/storage apps/jscad-web/test/storage-rowboat.test.js apps/jscad-web/package.json
git commit -m "feat(jscad-web): rowboat backend with recorded sync transcript"
```

---

### Task 3: Sync-token route on the studio server

**Files:**
- Modify: `apps/jscad-studio/server/src/index.ts`
- Create: `apps/jscad-studio/server/test/syncToken.test.ts`
- Read for reference: `apps/jscad-studio/server/src/index.ts:48-90`, `apps/jscad-studio/server/test/health.test.ts:1-40`

**Interfaces:**
- Consumes: existing `identity.signJWT` (15m data-plane shape already configured in `createServer`).
- Produces: `GET /api/sync-token` requiring a session; answers `{ token }` where `token` is `signJWT(actor)` bound to `config.rowboatDatabaseId`. No session answers 401 `{ error: 'unauthorized' }`.

- [ ] **Step 1: Write the failing token test**

  Create `apps/jscad-studio/server/test/syncToken.test.ts`:

```ts
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type StudioServer, type ServerConfig } from '../src/index.js'

const AUTH_SECRET = 'test-secret-test-secret-test-secret'

function testConfig(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: ':memory:',
    frontendUrl: 'http://localhost:5120',
    authSecret: AUTH_SECRET,
    trustedOrigins: ['http://localhost:5120'],
    providers: [],
    rowboatDatabaseId: 'db_test_tenant',
    rowboatUrl: 'http://rowboat.test',
  }
}

let server: StudioServer | undefined

afterEach(() => {
  server?.db.close()
  server = undefined
})

describe('sync token', () => {
  it('401s without a session', async () => {
    server = await createServer(testConfig())
    const res = await request(server.app).get('/api/sync-token')
    expect(res.status).toBe(401)
  })

  it('mints a three-part JWT for the session user', async () => {
    server = await createServer(testConfig())
    const agent = request.agent(server.app)
    await agent.post('/api/auth/sign-up/email').send({ email: 'sync@test.com', password: 'password123', name: 'Sync' })
    const res = await agent.get('/api/sync-token')
    expect(res.status).toBe(200)
    expect(res.body.token.split('.')).toHaveLength(3)
  })
})
```

  Run: `cd apps/jscad-studio/server && npx vitest run test/syncToken.test.ts`
  Expected: FAIL (404 on `/api/sync-token`). If the sign-up route shape differs from the test, read the better-auth wiring in `src/index.ts` and fix the test to use the repo's existing session-creation path; keep the 401 case unchanged.

- [ ] **Step 2: Implement the route**

  In `apps/jscad-studio/server/src/index.ts`, after `app.use(express.json())` and before `mountAgentRoutes`, add:

```ts
app.get('/api/sync-token', async (req, res) => {
  const author = await identity.provider.resolveAuthor(req)
  if (!author) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  res.json({ token: await identity.signJWT(author) })
})
```

  This reuses the 15m `issuer`/`audience` JWT config already passed to `createIdentity`; no new config keys.

- [ ] **Step 3: Run the server tests**

  Run: `cd apps/jscad-studio/server && npx vitest run`
  Expected: PASS (health + syncToken suites).

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-studio/server/src/index.ts apps/jscad-studio/server/test/syncToken.test.ts
git commit -m "feat(studio-server): sync-token route for jscad-web rowboat sync"
```

---

### Task 4: Mixed-manifest map assembly and zip round trip

**Files:**
- Create: `apps/jscad-web/src/storage/map.js`
- Create: `apps/jscad-web/src/storage/zip.js`
- Create: `apps/jscad-web/test/storage-map.test.js`
- Create: `apps/jscad-web/test/storage-zip.test.js`
- Modify: `apps/jscad-web/src/storage/index.js`
- Read for reference: `apps/jscad-studio/src/storage/index.js:1-45`, `apps/jscad-web/main.js:298-315`, `packages/require/src/require.js` (how the worker resolves sibling requires)

**Interfaces:**
- Consumes: Task 1's storage interface.
- Produces:
  - `assembleFileMap(manifest, { local, rowboat }) => { [path]: content }` where `manifest` is `{ [path]: 'local' | 'rowboat' }`, `local`/`rowboat` are `{ [path]: content }` maps. Each manifest path names exactly one backend; a path missing from its backend throws `assembleFileMap: <path> missing from <backend>`.
  - `resolveRequire(path, maps)` helper: unlisted sibling requires resolve local-first then rowboat, returning `undefined` when absent.
  - `exportZip(storage, id) => Uint8Array`, `importZip(storage, file) => { id, name, entry, kind }` implemented once over the interface (port of studio's `withZip`).

- [ ] **Step 1: Write the failing map test**

  Create `apps/jscad-web/test/storage-map.test.js`:

```js
// Mixed local/rowboat models merge at load time: manifest files come from
// their tagged backend, unlisted sibling requires resolve local-first.
import { describe, expect, it } from 'vitest'
import { assembleFileMap, resolveRequire } from '../src/storage/map.js'

describe('mixed-manifest map assembly', () => {
  it('takes each manifest path from its tagged backend', () => {
    const files = assembleFileMap(
      { 'main.js': 'local', 'lib/gear.js': 'rowboat' },
      { local: { 'main.js': 'local-main' }, rowboat: { 'lib/gear.js': 'rowboat-gear' } },
    )
    expect(files).toEqual({ 'main.js': 'local-main', 'lib/gear.js': 'rowboat-gear' })
  })

  it('throws naming the path and backend when a manifest file is absent', () => {
    expect(() => assembleFileMap({ 'main.js': 'local' }, { local: {}, rowboat: {} })).toThrow(
      /main\.js.*local/,
    )
  })

  it('resolves unlisted siblings local-first then rowboat', () => {
    const maps = { local: { 'util.js': 'local-util' }, rowboat: { 'util.js': 'rowboat-util', 'only.js': 'r' } }
    expect(resolveRequire('util.js', maps)).toBe('local-util')
    expect(resolveRequire('only.js', maps)).toBe('r')
    expect(resolveRequire('missing.js', maps)).toBeUndefined()
  })
})
```

  Run: `cd apps/jscad-web && npx vitest run test/storage-map.test.js`
  Expected: FAIL with "Cannot find module '../src/storage/map.js'".

- [ ] **Step 2: Implement map assembly**

  Create `apps/jscad-web/src/storage/map.js`:

```js
export function assembleFileMap(manifest, backends) {
  const files = {}
  for (const [path, backend] of Object.entries(manifest)) {
    const content = backends[backend]?.[path]
    if (content === undefined) throw new Error(`assembleFileMap: ${path} missing from ${backend}`)
    files[path] = content
  }
  return files
}

export function resolveRequire(path, maps) {
  return maps.local?.[path] ?? maps.rowboat?.[path]
}
```

- [ ] **Step 3: Write the failing zip test**

  Create `apps/jscad-web/test/storage-zip.test.js`:

```js
// No lock-in: every project exports as a zip of its files and imports from one.
import { describe, expect, it } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { exportZip, importZip } from '../src/storage/zip.js'

const MAIN = 'const gear = { teeth: 12 }'

describe('zip export/import', () => {
  it('round-trips a project through export and import as a new project', async () => {
    const store = createLocalStorage()
    await store.writeFiles(
      'p5',
      { 'main.js': MAIN, 'lib/teeth.js': 'export const n = 12' },
      { message: 'original', name: 'RoundTrip', entry: 'main.js' },
    )
    const zip = await exportZip(store, 'p5')
    const imported = await importZip(store, zip)
    expect(imported.id).not.toBe('p5')
    const project = await store.readProject(imported.id)
    expect(project.files).toEqual({ 'main.js': MAIN, 'lib/teeth.js': 'export const n = 12' })
    expect(project.entry).toBe('main.js')
    expect(project.kind).toBe('jscad')
  })

  it('refuses a zip with no project metadata', async () => {
    const store = createLocalStorage()
    const { zipSync, strToU8 } = await import('fflate')
    const bad = zipSync({ 'main.js': strToU8('hello') })
    await expect(importZip(store, bad)).rejects.toThrow(/metadata/)
  })
})
```

  Run: `cd apps/jscad-web && npx vitest run test/storage-zip.test.js`
  Expected: FAIL with "Cannot find module '../src/storage/zip.js'".

- [ ] **Step 4: Implement zip over the interface**

  Create `apps/jscad-web/src/storage/zip.js` (port of `apps/jscad-studio/src/storage/index.js:7-45`):

```js
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const META_PATH = '.jscad-web.json'

export async function exportZip(storage, id) {
  const project = await storage.readProject(id)
  const meta = { name: project.name, entry: project.entry, kind: project.kind }
  const entries = { [META_PATH]: strToU8(JSON.stringify(meta)) }
  for (const [path, content] of Object.entries(project.files)) entries[path] = strToU8(content)
  return zipSync(entries)
}

export async function importZip(storage, file) {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer())
  const entries = unzipSync(bytes)
  const metaBytes = entries[META_PATH]
  if (!metaBytes) throw new Error('importZip: zip carries no project metadata')
  const meta = JSON.parse(strFromU8(metaBytes))
  const files = {}
  for (const [path, content] of Object.entries(entries)) {
    if (path === META_PATH) continue
    files[path] = strFromU8(content)
  }
  const id = crypto.randomUUID()
  await storage.writeFiles(id, files, { message: 'imported from zip', name: meta.name, entry: meta.entry })
  return { id, name: meta.name, entry: meta.entry, kind: meta.kind }
}
```

  Update `apps/jscad-web/src/storage/index.js` to re-export all four modules:

```js
export { schema } from './schema.js'
export { createLocalStorage, kindFromEntry } from './local.js'
export { createRowboatStorage } from './rowboat.js'
export { assembleFileMap, resolveRequire } from './map.js'
export { exportZip, importZip } from './zip.js'
```

- [ ] **Step 5: Run the storage suite**

  Run: `cd apps/jscad-web && npx vitest run test/storage-`
  Expected: PASS (interface + rowboat + map + zip).

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-web/src/storage apps/jscad-web/test/storage-map.test.js apps/jscad-web/test/storage-zip.test.js
git commit -m "feat(jscad-web): mixed-manifest map assembly and zip round trip"
```

---

### Task 5: Wire editor saves and writeModel through the storage interface

**Files:**
- Create: `apps/jscad-web/src/storage/session.js`
- Create: `apps/jscad-web/test/storage-session.test.js`
- Modify: `apps/jscad-web/main.js`
- Modify: `apps/jscad-web/src/storage/index.js`
- Read for reference: `apps/jscad-web/main.js:451-497` (editor init compile/save/getFile), `apps/jscad-web/src/aiBridge.js:1-35`, `apps/jscad-web/src/fileSystem.js:59-102`

**Interfaces:**
- Consumes: Tasks 1-2 and 4 (`createLocalStorage`, `createRowboatStorage`, `assembleFileMap`).
- Produces: `createSession({ local, rowboat, getBackend })` returning `{ readThrough(path, manifest), writeThrough(projectId, path, content, { message }) }`. `writeThrough` writes the bytes to the mode backend (local default, rowboat when the manifest tags the path `rowboat`), then records a `versions` row plus `files` hashes either way via `writeFiles`. Anonymous sessions pass `rowboat: null` and every path resolves local.

- [ ] **Step 1: Write the failing session test**

  Create `apps/jscad-web/test/storage-session.test.js`:

```js
// Mode-backend write-through: bytes go to the tagged backend, the version
// row and file hashes land either way.
import { describe, expect, it, vi } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { createSession } from '../src/storage/session.js'

describe('mode write-through', () => {
  it('writes a local path to the local backend and versions it', async () => {
    const local = createLocalStorage()
    const rowboat = { writeFiles: vi.fn(async () => ({})), readProject: vi.fn() }
    const session = createSession({ local, rowboat, getBackend: () => 'local' })
    await session.writeThrough('p1', 'main.js', 'v1', { message: 'edit', name: 'P', entry: 'main.js' })
    expect((await local.readProject('p1')).files['main.js']).toBe('v1')
    expect(rowboat.writeFiles).not.toHaveBeenCalled()
    expect(await local.listVersions('p1')).toHaveLength(1)
  })

  it('writes a rowboat path to the rowboat backend', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    const session = createSession({ local, rowboat, getBackend: () => 'rowboat' })
    await session.writeThrough('p1', 'lib/gear.js', 'gear', { message: 'edit', name: 'P', entry: 'main.js' })
    expect((await rowboat.readProject('p1')).files['lib/gear.js']).toBe('gear')
  })

  it('reads through the tagged backend', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    await local.writeFiles('p1', { 'main.js': 'local-main' }, { entry: 'main.js' })
    await rowboat.writeFiles('p1', { 'lib/gear.js': 'rowboat-gear' }, { entry: 'main.js' })
    const session = createSession({ local, rowboat, getBackend: (path) => (path === 'main.js' ? 'local' : 'rowboat') })
    expect(await session.readThrough('p1', 'main.js')).toBe('local-main')
    expect(await session.readThrough('p1', 'lib/gear.js')).toBe('rowboat-gear')
  })
})
```

  Run: `cd apps/jscad-web && npx vitest run test/storage-session.test.js`
  Expected: FAIL with "Cannot find module '../src/storage/session.js'".

- [ ] **Step 2: Implement the session**

  Create `apps/jscad-web/src/storage/session.js`:

```js
export function createSession({ local, rowboat, getBackend }) {
  const backendFor = (path) => (getBackend?.(path) === 'rowboat' && rowboat ? rowboat : local)

  const readThrough = async (projectId, path) => {
    const store = backendFor(path)
    const project = await store.readProject(projectId)
    return project.files[path]
  }

  const writeThrough = async (projectId, path, content, options = {}) => {
    const store = backendFor(path)
    let files
    try {
      files = { ...(await store.readProject(projectId)).files }
    } catch {
      files = {}
    }
    files[path] = content
    return store.writeFiles(projectId, files, options)
  }

  return { readThrough, writeThrough }
}
```

  Append to `apps/jscad-web/src/storage/index.js`:

```js
export { createSession } from './session.js'
```

- [ ] **Step 3: Wire main.js compile/save through the session**

  In `apps/jscad-web/main.js`, after the `fileSystem` import add:

```js
import { createLocalStorage, createSession } from './src/storage/index.js'
```

  After the `fsDeps` definition (around line 179), add a module-level session backed by the local store only (rowboat attaches in Task 6 once the sync loop exists):

```js
const storageSession = createSession({ local: createLocalStorage(), rowboat: null, getBackend: () => 'local' })
```

  In the `editor.init` compile callback (around line 453), after `addToCacheWrapper` succeeds, record the version row — keep the existing worker/cache lines, add one call:

```js
await storageSession.writeThrough('default', path, script, { message: 'edit', entry: path }).catch((err) => console.warn('storage write failed:', err))
```

  In the `save` callback (the `writeModel` path, around line 465) and in the `aiDeps.save` handler (around line 611), route the same way: the local FS/handle write stays first, the session `writeThrough` follows as the version/hash record. Do not change the `view`/`measure` loop or the worker `require` path in this task.

- [ ] **Step 4: Run the tests**

  Run: `cd apps/jscad-web && npx vitest run test/storage-session.test.js test/aiBridge.test.js`
  Expected: PASS. `aiBridge` is unchanged behavior (it still calls `deps.save`); this task only changes what `main.js` passes as `save`.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/storage apps/jscad-web/test/storage-session.test.js apps/jscad-web/main.js
git commit -m "feat(jscad-web): editor saves and writeModel through storage session"
```

---

### Task 6: Sync loop, conversation persistence, and jscadScript file-map merge

**Files:**
- Create: `apps/jscad-web/src/storage/sync.js`
- Create: `apps/jscad-web/test/storage-sync.test.js`
- Modify: `apps/jscad-web/main.js`
- Modify: `apps/jscad-web/src/aiChat.js`
- Modify: `apps/jscad-web/test/aiChat.test.js`
- Read for reference: `apps/jscad-web/main.js:298-315` (`jscadScript`), `apps/jscad-web/src/aiChat.js:25-119`, `apps/jscad-web/src/aiAccount.js:53-62` (`getSession`), `apps/jscad-studio/src/storage/cloud.js:79-87` (sync shape)

**Interfaces:**
- Consumes: Tasks 1-5 (all storage modules, session wiring).
- Produces:
  - `createSyncLoop({ storage, getToken, intervalMs, onError }) => { start, stop, syncNow }`. `start()` no-ops when `getToken()` returns null (anonymous local-only); otherwise it calls `storage.sync()` immediately and every `intervalMs` (default 30000). Failures go to `onError`, never throw out of the interval.
  - `aiChat.initChat` accepts `storage` (`{ readConversation, writeConversation }`) plus `projectId`; on init it loads prior messages into the panel, and after each completed turn it persists the full transcript. Storage failures warn, never break the turn.
  - `jscadScript` in `main.js` assembles one file map from both backends via `assembleFileMap` before calling the worker; unlisted sibling requires resolve local-first then rowboat.

- [ ] **Step 1: Write the failing sync-loop test**

  Create `apps/jscad-web/test/storage-sync.test.js`:

```js
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
```

  Run: `cd apps/jscad-web && npx vitest run test/storage-sync.test.js`
  Expected: FAIL with "Cannot find module '../src/storage/sync.js'".

- [ ] **Step 2: Implement the sync loop**

  Create `apps/jscad-web/src/storage/sync.js`:

```js
export function createSyncLoop({ storage, getToken, intervalMs = 30000, onError = () => {} }) {
  let timer = null

  const syncNow = async () => {
    try {
      const token = await getToken()
      if (!token) return
      await storage.sync()
    } catch (err) {
      onError(err)
    }
  }

  const start = async () => {
    const token = await getToken().catch(() => null)
    if (!token) return
    await syncNow()
    timer = setInterval(syncNow, intervalMs)
  }

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop, syncNow }
}
```

  Export it from `apps/jscad-web/src/storage/index.js`:

```js
export { createSyncLoop } from './sync.js'
```

- [ ] **Step 3: Wire the sync loop and rowboat store into main.js**

  Replace the Task 5 `storageSession` stub with both backends: keep `createLocalStorage()` for anonymous, lazily build `createRowboatStorage` after sign-in is detected via the existing `/api/auth/get-session` probe (same fetch as `src/aiAccount.js:53-62`). Token fetch hits `GET /api/sync-token` with `credentials: 'include'`; a non-ok response means anonymous (return null, stay local-only). Pass `getHeaders: async () => ({ authorization: `Bearer ${token}` })` into the rowboat store and `getToken` into `createSyncLoop`. Start the loop once at boot; it no-ops until sign-in. Blobs upload on write (rowboat backend) and download on demand (read-through cache). No share UI or routes.

- [ ] **Step 4: Persist chat conversations per project**

  In `apps/jscad-web/src/aiChat.js`, extend `initChat({ container, requestTool, getProvider, runTurnFn, storage, projectId })`: after building the panel, `await storage?.readConversation(projectId)` (guarded try/catch) and render each stored message via the existing `addMessage`. Track the transcript array alongside rendering; after each completed turn (success or tool path), `await storage?.writeConversation(projectId, transcript)` in a try/catch that warns only. When `storage` is absent the chat behaves exactly as today.

  Add to `apps/jscad-web/test/aiChat.test.js`:

```js
it('loads a stored conversation and persists the turn', async () => {
  document.body.innerHTML = '<div id="chat"></div>'
  const container = document.getElementById('chat')
  const storage = {
    readConversation: async () => ({ messages: [{ role: 'user', content: 'old' }], updated: 1 }),
    writeConversation: vi.fn(async () => {}),
  }
  initChat({
    container,
    requestTool: async () => '{}',
    getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
    runTurnFn: async ({ onText }) => { onText('hi'); return { messages: [] } },
    storage,
    projectId: 'p1',
  })
  await vi.waitFor(() => expect(container.querySelector('.chat-messages').textContent).toMatch(/old/))
  container.querySelector('.chat-input').value = 'hello'
  container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() => expect(storage.writeConversation).toHaveBeenCalledWith('p1', expect.any(Array)))
})
```

  In `main.js`, pass the active storage (`readConversation`/`writeConversation` bound to the current project id) and `projectId` into `initChat`.

- [ ] **Step 5: Merge the file map in jscadScript**

  In `main.js` `jscadScript({ script, url, base, root })`: before `workerApi.jscadScript`, build the manifest for the current project (each known path tagged by its owning backend), fetch local files from the FS cache plus rowboat files via the rowboat store's `readProject`, merge with `assembleFileMap`, and hand the single map to the worker's `require` path. Unlisted sibling requires resolve local-first then rowboat via `resolveRequire`. Keep the worker call signature unchanged; the `view`/`measure` loop is untouched.

- [ ] **Step 6: Run the full jscad-web suite**

  Run: `cd apps/jscad-web && npx vitest run`
  Expected: PASS (all storage suites plus existing `aiChat`, `aiBridge`, `directoryParser`, `gridLayout`, `studioBridge`, `trustedSources`).

- [ ] **Step 7: Commit**

```bash
git add apps/jscad-web/src/storage apps/jscad-web/test apps/jscad-web/main.js apps/jscad-web/src/aiChat.js
git commit -m "feat(jscad-web): sync loop, conversation persistence, file-map merge"
```

---

## Order and checkpoints

Tasks 1 and 3 start in parallel (different apps, no shared files). Task 2 needs Task 1. Task 4 needs Task 1. Task 5 needs Tasks 1, 2 and 4. Task 6 needs Task 5.

- After Task 2, the rowboat backend round-trips offline and the token route mints a JWT. That is the moment to confirm the data-plane shape matches the installed `@jbroll/rowboat-client` before wiring the UI.
- After Task 6, anonymous editing works exactly as today (local mode), sign-in starts sync, chats resume per project, and mixed local/rowboat models compile. That is the moment for a browser smoke plus the prod push the spec lists as owner actions (provision the prod rowboat tenant and record its `databaseId`; create `/etc/jscad-relay/providers.json`; run `deploy-full.sh prod`; smoke including the relay origin probe).
