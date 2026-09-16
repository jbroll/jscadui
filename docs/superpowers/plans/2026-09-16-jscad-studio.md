# jscad-studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hosted AI modeling app at `jscad-studio.rkroll.com` where a user describes a part in chat, an agent writes the model, and the model renders in the page, with all model code evaluated in a sandboxed frame on a second origin.

**Architecture:** A new jscadui app beside `apps/jscad-web` reusing its viewer, editor, params UI and worker. Model evaluation moves into `apps/jscad-studio-run`, a hidden sandboxed iframe on `run.jscad-studio.rkroll.com`, which returns geometry by `postMessage`. An Express API owns accounts, storage and the agent loop; the user's provider key stays the user's.

**Tech Stack:** ES modules, esbuild (jscadui's `build.js` recipe), CodeMirror 6, Express, better-sqlite3, BetterAuth via `@jbroll/rowboat-auth-betterauth`, rowboat sync and file routes, vitest, Playwright.

**Spec:** `docs/design/jscad-studio.md`

**Survey of the code this builds on:** `.superpowers/studio-survey.md` (gitignored scratch; regenerate if stale).

## Global Constraints

- App origin `jscad-studio.rkroll.com`; compute frame origin `run.jscad-studio.rkroll.com`.
- The frame is `<iframe sandbox="allow-scripts">` without `allow-same-origin`, hidden, and its page sets a CSP allowing scripts from itself and the package CDN, `connect-src` the CDN only, `frame-ancestors` the app origin, plus a `Permissions-Policy` disabling camera, microphone, geolocation, USB and serial.
- No model code is ever evaluated on the app origin or on the server.
- Every frame command carries an `id`; every result echoes it. A model error is a result, never an unhandled rejection.
- The session cookie is host-only on `jscad-studio.rkroll.com`, never `.rkroll.com`.
- The user's provider key never enters the frame and never enters a log.
- jscadui style: ES modules, no semicolons, single quotes. Comments: none unless they say why, one or two lines.
- Commits end with the two attribution lines this session's system reminder gives.
- Branch: `dev` in `/home/john/src/jscadui`, which is `main` plus the design doc.

---

### Task 1: `@jscadui/model-tools`, shared measure and check

**Files:**
- Create: `packages/model-tools/package.json`, `packages/model-tools/index.js`, `packages/model-tools/src/measure.js`, `packages/model-tools/src/check.js`
- Create: `packages/model-tools/test/measure.test.js`, `packages/model-tools/test/check.test.js`
- Read for reference: `/home/john/src/jscad-ai-studio/lib/measure.js`, `/home/john/src/jscad-ai-studio/lib/check.js`

**Model:** `sonnet` — porting Node code to a browser-safe package, with exact output parity to preserve.

**Interfaces:**
- Produces: `measure(geometry, options) => object` and `check(geometry, options) => object`, returning exactly the JSON shapes `jscad-work measure` and `jscad-work check` print today. Pure functions over geometry plus `@jscad/modeling`; no `node:` imports, no filesystem, no process.

- [ ] **Step 1: Read the current implementations and list every `node:` dependency**

Read both files in `/home/john/src/jscad-ai-studio/lib/`. Write down each Node-only import and each place that reads a file or a CLI option. Those are what this task removes; the geometry math is unchanged.

- [ ] **Step 2: Write the failing tests**

Port the measure and check cases from `/home/john/src/jscad-ai-studio/test/measure.test.js` and `test/check.test.js` that exercise geometry only, building geometry directly with `@jscad/modeling` rather than loading a model file. Keep the expected JSON identical.

Run: `cd packages/model-tools && npx vitest run`
Expected: FAIL, the package does not exist.

- [ ] **Step 3: Create the package**

`package.json` with `"name": "@jscadui/model-tools"`, `"type": "module"`, `"main": "index.js"`, a `test` script running vitest, and `@jscad/modeling` as a peer dependency. `index.js` re-exports `measure` and `check`.

- [ ] **Step 4: Port the code**

Move the geometry logic across unchanged. Where the CLI version took a model path, the package takes geometry. Where it read options from argv, the package takes an options object.

- [ ] **Step 5: Run the tests**

Run: `cd packages/model-tools && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/model-tools
git commit -m "feat(model-tools): browser-safe measure and check"
```

---

### Task 2: An origin check in `@jscadui/postmessage`

**Files:**
- Modify: `packages/postmessage/index.js` (`initMessaging` around line 167, `messageProxy` around line 202)
- Create: `packages/postmessage/test/origin.test.js`

**Model:** `sonnet` — small change in shared transport code every app depends on.

**Interfaces:**
- Produces: `messageProxy(target, handlers, { allowedOrigin, onJobCount, debug })`. When `allowedOrigin` is set, a `message` event whose `event.origin` differs is ignored, with no handler call and no response. When it is absent, behavior is exactly as today, so `apps/jscad-web` is unaffected.

- [ ] **Step 1: Write the failing test**

A test that builds two fake message targets, wires `messageProxy` with `allowedOrigin: 'https://app.test'`, dispatches a `message` event with `origin: 'https://evil.test'` calling a handler that records a call, and asserts the handler never ran and nothing was posted back. A second case with the matching origin asserts the handler did run.

Run: `cd packages/postmessage && npx vitest run`
Expected: FAIL, the handler runs regardless of origin.

- [ ] **Step 2: Implement**

Thread an `allowedOrigin` option from `messageProxy` into `initMessaging`, and in the `message` listener return early when it is set and `event.origin !== allowedOrigin`. Add one comment saying why, no more.

- [ ] **Step 3: Run the tests, and the existing suites**

Run: `cd packages/postmessage && npx vitest run`
Run: `cd packages/worker && npx vitest run`
Run: `cd apps/jscad-web && npx vitest run`
Expected: all pass. jscad-web passes no `allowedOrigin` and must be unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/postmessage
git commit -m "feat(postmessage): optional allowedOrigin check"
```

---

### Task 3: Compute frame, `load` and `params`

**Files:**
- Create: `apps/jscad-studio-run/build.js`, `apps/jscad-studio-run/package.json`
- Create: `apps/jscad-studio-run/static/index.html`
- Create: `apps/jscad-studio-run/src/frame.js`, `apps/jscad-studio-run/src/fileMap.js`
- Create: `apps/jscad-studio-run/src_bundle/bundle.worker.js`
- Create: `apps/jscad-studio-run/test/fileMap.test.js`
- Create: `apps/jscad-studio-run/e2e/frame.spec.js`
- Read for reference: `apps/jscad-web/build.js`, `apps/jscad-web/src_bundle/bundle.worker.js`, `apps/jscad-web/src/workerSetup.js`, `packages/require/src/require.js`, `packages/require/src/readFileWeb.js`

**Model:** `sonnet` — a new app following an existing build recipe, plus a loader substitution that needs care.

**Interfaces:**
- Consumes: Task 2's `allowedOrigin`.
- Produces: a page that answers `postMessage` commands `{ id, command: 'load' | 'params', payload }` with `{ id, ok: true, result }` or `{ id, ok: false, error: { message, name, stack } }`.
  - `load` payload: `{ files: { [path]: string }, entry: string }`. Result: `{ params, entities }`.
  - `params` payload: `{ values: object }`. Result: `{ entities }`, with geometry buffers in the transfer list.

- [ ] **Step 1: Write the file-map test**

`fileMap.test.js` covers the `readFile` the frame passes into `require`: a project path resolves to its text; a missing path throws in the shape `require` expects; a bare package name or an absolute CDN URL is not handled by the map and falls through to the loader's own fetch.

Run: `cd apps/jscad-studio-run && npx vitest run`
Expected: FAIL, nothing exists yet.

- [ ] **Step 2: Build the app skeleton**

Copy `apps/jscad-web/build.js` and cut it down: no docs copy, no examples, no demo manifest. Keep the bundle steps the worker needs (`bundle.jscad_modeling.js`, `bundle.manifold_modeling.js`, `bundle.jscad_io.js`, `bundle.params_core.js`, `bundle.jscadui.transform-babel.js`, `bundle.openscad.js` with the node-builtin stub plugin, `bundle.jscad_text.js`), the `manifold.wasm` copy, and the worker IIFE bundle. Keep `hashAssets` in the same topological order for production builds. `static/index.html` loads one module script and nothing else, and carries the CSP and `Permissions-Policy` meta or is served with those headers.

- [ ] **Step 3: Implement `fileMap.js` and make the test pass**

Run: `cd apps/jscad-studio-run && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Implement `frame.js`**

It creates the worker, wires `messageProxy` with `allowedOrigin` read from a build-time constant, and implements the two commands by calling the worker's `jscadInit`, `jscadScript({ script, url, base })` and `jscadMain({ params })`. Entities come back from `jscadMain` already transferable; forward them with the buffers in the transfer list. Errors become `{ ok: false, error }`, never a throw that escapes.

- [ ] **Step 5: Write the end-to-end frame test**

`e2e/frame.spec.js` in Playwright: serve the built frame, post `load` for a two-file project where the entry requires a sibling, assert geometry comes back; post `params` and assert different geometry; post a model that throws and assert `{ ok: false }` with the message; post from a wrong origin and assert nothing is answered.

Two security cases belong here too, because they are what the origin split buys: a model whose source calls `fetch` against the app origin's API must fail rather than return data, and a model that reads `localStorage` or opens IndexedDB must throw, since a sandboxed frame with an opaque origin has no storage. Both assert on the model error the frame returns.

Run: `cd apps/jscad-studio-run && npx playwright test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-studio-run
git commit -m "feat(studio-run): compute frame with load and params"
```

---

### Task 4: Compute frame, `measure`, `check` and `export`, with timeouts

**Files:**
- Modify: `apps/jscad-studio-run/src/frame.js`, `apps/jscad-studio-run/src_bundle/bundle.worker.js`
- Modify: `apps/jscad-studio-run/e2e/frame.spec.js`
- Create: `apps/jscad-studio-run/test/parity.test.js`

**Model:** `sonnet` — wiring three more commands plus worker lifecycle.

**Interfaces:**
- Consumes: Task 1's `@jscadui/model-tools`, Task 3's command shape.
- Produces: commands `measure` (payload `{ options }`), `check` (payload `{ bed, options }`), `export` (payload `{ format }`, result `{ data }` as an ArrayBuffer in the transfer list). Plus: a command that exceeds `timeoutMs` terminates the worker and answers `{ ok: false, error: { name: 'TimeoutError' } }`, and the next command starts a fresh worker.

- [ ] **Step 1: Write the parity test**

For each fixture model in `/home/john/src/jscad-ai-studio/test/fixtures/`, compare the frame's `measure` result against `jscad-work measure` output for the same file, asserting deep equality. Run the CLI through `execFile`. This is the test that keeps the browser and the CLI honest.

Run: `cd apps/jscad-studio-run && npx vitest run parity`
Expected: FAIL, the command does not exist.

- [ ] **Step 2: Implement the three commands**

`measure` and `check` call `@jscadui/model-tools` against the worker's current geometry. `export` calls the worker's `jscadExportData({ format })`, which `bundle.worker.js` already implements through `@jscad/io`.

- [ ] **Step 3: Implement the timeout**

Wrap each command in a race against `timeoutMs`. On timeout, `worker.terminate()`, answer the timeout error, and mark the worker for recreation on the next command.

- [ ] **Step 4: Extend the end-to-end test**

Add cases for each command and for a model that never returns, asserting the timeout error and that a following `load` still works.

Run: `cd apps/jscad-studio-run && npx vitest run && npx playwright test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-studio-run
git commit -m "feat(studio-run): measure, check, export, and command timeouts"
```

---

### Task 5: Studio app shell

**Files:**
- Create: `apps/jscad-studio/build.js`, `apps/jscad-studio/package.json`, `apps/jscad-studio/static/index.html`, `apps/jscad-studio/main.js`
- Create: `apps/jscad-studio/src/frameClient.js`, `apps/jscad-studio/src/caps.js`
- Create: `apps/jscad-studio/test/caps.test.js`
- Read for reference: `apps/jscad-web/main.js` (init order, `handleEntities` at 121-146), `apps/jscad-web/src/{engine,viewState,editor,paramsUI}.js`

**Model:** `sonnet` — assembling existing pieces into a new page, with one new guard.

**Interfaces:**
- Consumes: Task 3 and 4's frame commands.
- Produces:
  - `frameClient(iframe, origin)` returning `{ load, params, measure, check, export: exportModel }`, each returning a promise of the command result.
  - `capGeometry(entities, limits)` throwing a model error when over `limits.vertices`, `limits.bytes` or `limits.entities`, checked before any allocation for drawing. Default limits live in one exported constant.
  - A page that renders a model, edits it in CodeMirror, and shows parameter controls, all against the frame rather than a local worker.

- [ ] **Step 1: Write the caps test**

Cases: entities under the limits pass through unchanged; a vertex count over the limit throws; a total buffer size over the limit throws; an entity count over the limit throws; the check reads sizes from buffer metadata without copying.

Run: `cd apps/jscad-studio && npx vitest run`
Expected: FAIL.

- [ ] **Step 2: Implement `caps.js` and pass the test**

- [ ] **Step 3: Build the page**

`build.js` follows `apps/jscad-web/build.js` but omits the worker bundle: this app has no worker. It bundles the renderer (`bundle.threejs.js`, `bundle.regl.js`, `bundle.render-regl.js`) and `main.js`. `index.html` carries the hidden iframe pointing at the run origin.

- [ ] **Step 4: Port the init order from jscad-web**

Reuse gizmo and orbit wiring, `viewState`, `paramsUI`, `editor.init(...)`, and `handleEntities`, with two substitutions: entities arrive from `frameClient` rather than a worker RPC, and `capGeometry` runs before `viewState.setModel`. The editor's compile path calls `frameClient.load`; its save path calls the storage layer added in Task 9.

- [ ] **Step 5: End-to-end smoke**

A Playwright test that loads the page against a built frame, types in the editor, and asserts the canvas draws and the parameter controls appear.

Run: `cd apps/jscad-studio && npx vitest run && npx playwright test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-studio
git commit -m "feat(studio): app shell rendering through the compute frame"
```

---

### Task 6: API skeleton

**Files:**
- Create: `apps/jscad-studio/server/package.json`, `apps/jscad-studio/server/src/index.ts`, `apps/jscad-studio/server/src/config.ts`
- Create: `apps/jscad-studio/server/test/health.test.ts`
- Read for reference: `/home/john/src/checklist/backend/src/index.ts`

**Model:** `sonnet` — following an existing server closely.

**Interfaces:**
- Produces: `createServer(config)` returning an Express app with `GET /api/health` answering `{ status: 'ok', timestamp }`, BetterAuth routes mounted before `express.json()`, and a CORS allow-list echoing only configured origins with credentials. `configFromEnv()` reads `PORT`, `BIND_HOST`, `AUTH_DB_PATH`, `FRONTEND_URL`, `BETTER_AUTH_SECRET`, the OAuth client ids and secrets, `ROWBOAT_URL` and `ROWBOAT_DATABASE_ID`, throwing when a required one is missing.

- [ ] **Step 1: Write the failing tests**

`health.test.ts`: the health route answers 200 with the shape; an origin not in the allow-list gets no `Access-Control-Allow-Origin`; `configFromEnv()` throws naming the variable when `ROWBOAT_DATABASE_ID` is absent.

Run: `cd apps/jscad-studio/server && npx vitest run`
Expected: FAIL.

- [ ] **Step 2: Implement, following checklist's `index.ts`**

`createIdentity({ db, authSecret, baseUrl, jwt: { issuer, audience: rowboatDatabaseId, expirationTime: '15m' }, providers })`, then `identity.mountAuthRoutes(app)` before `express.json()`, then the health route. The cookie is host-only.

- [ ] **Step 3: Run the tests**

Run: `cd apps/jscad-studio/server && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-studio/server
git commit -m "feat(studio-server): express skeleton with auth and health"
```

---

### Task 7: Provider clients

**Files:**
- Create: `apps/jscad-studio/server/src/providers/types.ts`, `providers/anthropic.ts`, `providers/openaiCompatible.ts`
- Create: `apps/jscad-studio/server/test/providers.test.ts`

**Model:** `sonnet` — two adapters against recorded responses.

**Interfaces:**
- Produces: `createProvider({ kind, apiKey, model, baseUrl }) => { send(messages, tools) : AsyncIterable<Event> }`, where `Event` is `{ type: 'text', text }`, `{ type: 'tool_use', id, name, input }`, or `{ type: 'done', stopReason }`. `kind` is `'anthropic'` or `'openai'`. Both adapters stream, and both surface a provider that cannot call tools as an error naming the provider rather than silently continuing.

- [ ] **Step 1: Write the failing tests**

Recorded streaming responses for each provider: one plain answer, one that requests a tool, one that requests two tools in a turn, and one error response. Assert the event sequence.

Run: `cd apps/jscad-studio/server && npx vitest run providers`
Expected: FAIL.

- [ ] **Step 2: Implement both adapters, then pass**

- [ ] **Step 3: Commit**

```bash
git add apps/jscad-studio/server/src/providers apps/jscad-studio/server/test/providers.test.ts
git commit -m "feat(studio-server): anthropic and openai-compatible providers"
```

---

### Task 8: Agent loop and SSE

**Files:**
- Create: `apps/jscad-studio/server/src/agent/loop.ts`, `agent/tools.ts`, `agent/routes.ts`
- Create: `apps/jscad-studio/server/test/loop.test.ts`
- Modify: `apps/jscad-studio/server/src/index.ts`

**Model:** `opus` — the correctness of the tool round trip, turn state and cancellation is the heart of the product.

**Interfaces:**
- Consumes: Task 7's provider interface.
- Produces:
  - `TOOLS`, the definitions for `eval`, `params`, `measure`, `check`, `view`, `export` and `writeModel`.
  - `runTurn({ conversation, provider, requestTool, onText }) => Promise<Conversation>`, where `requestTool(name, input)` returns a promise the caller resolves from the browser.
  - Routes: `POST /api/chat/:projectId` starts a turn and streams SSE events (`text`, `tool_request`, `done`, `error`); `POST /api/chat/:projectId/tool/:callId` accepts a tool result from the browser and resolves the matching promise.

- [ ] **Step 1: Write the failing tests**

Against a fake provider: a turn with no tool call streams text and ends; a turn that asks for `measure` produces a `tool_request`, waits, and continues after the result arrives; a tool result that never arrives times out and ends the turn with an error; a second turn on the same conversation sees the prior messages; a client disconnect cancels the turn.

Run: `cd apps/jscad-studio/server && npx vitest run loop`
Expected: FAIL.

- [ ] **Step 2: Implement the loop, then the routes, then pass the tests**

- [ ] **Step 3: Commit**

```bash
git add apps/jscad-studio/server/src/agent apps/jscad-studio/server/test/loop.test.ts apps/jscad-studio/server/src/index.ts
git commit -m "feat(studio-server): agent loop with browser-executed tools"
```

---

### Task 9: Chat panel and tool bridge

**Files:**
- Create: `apps/jscad-studio/src/chat.js`, `apps/jscad-studio/src/toolBridge.js`
- Create: `apps/jscad-studio/test/toolBridge.test.js`
- Modify: `apps/jscad-studio/main.js`, `apps/jscad-studio/static/index.html`

**Model:** `sonnet` — UI plus a dispatch table.

**Interfaces:**
- Consumes: Task 5's `frameClient`, Task 8's SSE events.
- Produces: `handleToolRequest(name, input, { frame, viewer })` returning the tool result. `view` is served by the viewer, setting the camera and capturing the canvas as a PNG data URL. `writeModel` goes to the storage layer. Everything else forwards to the frame.

- [ ] **Step 1: Write the failing test**

Each tool name routes to the right place, with fakes for frame and viewer: `measure` reaches the frame, `view` reaches the viewer and returns a data URL, `writeModel` reaches storage, an unknown tool returns an error result rather than throwing.

Run: `cd apps/jscad-studio && npx vitest run toolBridge`
Expected: FAIL.

- [ ] **Step 2: Implement the bridge, then the chat panel**

The panel renders the conversation, streams assistant text as it arrives, shows each tool call as a line the user can expand, and POSTs each tool result back.

- [ ] **Step 3: Run the tests**

Run: `cd apps/jscad-studio && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-studio/src/chat.js apps/jscad-studio/src/toolBridge.js apps/jscad-studio/test/toolBridge.test.js apps/jscad-studio/main.js apps/jscad-studio/static/index.html
git commit -m "feat(studio): chat panel and tool bridge"
```

---

### Task 10: Cloud storage on rowboat

**Files:**
- Create: `apps/jscad-studio/shared/schema.ts`, `apps/jscad-studio/src/storage/cloud.js`, `apps/jscad-studio/src/storage/index.js`
- Create: `apps/jscad-studio/test/storage-cloud.test.js`
- Read for reference: `/home/john/src/checklist/src/lib/rowboat.tsx`, `/home/john/src/checklist/src/lib/syncToken.ts`, `/home/john/src/rowboat/packages/backend/src/file-routes.ts`

**Model:** `sonnet` — following checklist's data plane exactly, including the parts that are easy to get wrong.

**Interfaces:**
- Produces: a storage interface every mode implements: `listProjects()`, `readProject(id) => { files, entry }`, `writeFiles(id, files, { message })`, `listVersions(id)`, `readVersion(id, versionId)`. The cloud implementation compiles the schema with `@jbroll/rowboat-schema`, builds the local store with `buildRowboatDb`, syncs with `syncWithServer`, and stores file contents as blobs through rowboat's file routes.

- [ ] **Step 1: Define the schema and provision a dev tenant**

Tables: `projects` (id, name, entry, kind, mode, created, updated), `files` (projectId, path, hash), `versions` (projectId, versionId, created, message, manifest), `conversations` (projectId, messages, updated) so a session resumes where it stopped, and `settings` (provider, model, keyMode, encryptedKey) per user. Declare the media tables the file routes need, or blob reads stay default-deny. Provision with `rowboat-cli provision-tenant` as checklist's scripts do, and record the `databaseId` in the dev env file.

- [ ] **Step 2: Write the failing tests**

Against a local rowboat, or a recorded sync transcript if a local instance is unavailable: writing files then reading them back returns identical content; a version row appears per write; `kind` is derived from the entry's extension; reading a blob requires the media-table grant.

Run: `cd apps/jscad-studio && npx vitest run storage-cloud`
Expected: FAIL.

- [ ] **Step 3: Implement and pass**

- [ ] **Step 4: Zip export and import**

The spec promises no lock-in, so every project exports as a zip of its files and imports from one, entry included. Add `exportZip(id)` and `importZip(file)` to the storage interface, implemented once over the interface rather than per mode. Test a round trip: export a project, import it as a new one, and assert the file map and entry match.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-studio/shared apps/jscad-studio/src/storage apps/jscad-studio/test/storage-cloud.test.js
git commit -m "feat(studio): cloud project storage on rowboat"
```

---

### Task 11: Linked local folder

**Files:**
- Create: `apps/jscad-studio/src/storage/folder.js`
- Create: `apps/jscad-studio/test/storage-folder.test.js`

**Model:** `sonnet` — one adapter behind an existing interface.

**Interfaces:**
- Consumes: Task 10's storage interface.
- Produces: the same interface backed by a `FileSystemDirectoryHandle`, with the handle kept in IndexedDB, a permission re-request on reconnect, and a clear error when the handle is stale or permission is denied. Versions come from the folder's own git, so `listVersions` reports that history is external rather than inventing rows.

- [ ] **Step 1: Write the failing tests**

With a fake directory handle: reading a project lists its files; writing updates them; a denied permission surfaces as a named error; a stale handle surfaces as a different named error. Feature detection reports unsupported on a browser without `showDirectoryPicker`.

Run: `cd apps/jscad-studio && npx vitest run storage-folder`
Expected: FAIL.

- [ ] **Step 2: Implement and pass**

- [ ] **Step 3: Commit**

```bash
git add apps/jscad-studio/src/storage/folder.js apps/jscad-studio/test/storage-folder.test.js
git commit -m "feat(studio): linked local folder storage"
```

---

### Task 12: Connected git repository

**Files:**
- Create: `apps/jscad-studio/server/src/git/github.ts`, `git/routes.ts`
- Create: `apps/jscad-studio/src/storage/git.js`
- Create: `apps/jscad-studio/server/test/github.test.ts`

**Model:** `opus` — this writes to a user's real repository, and the failure modes cost them history.

**Interfaces:**
- Produces: a GitHub App installation flow, installation-token minting, and `readProject`, `writeFiles` and `listVersions` over the Contents API. Every write carries the file SHA, is confined to the project's paths, and never force pushes. Disconnecting deletes the stored installation record.

- [ ] **Step 1: Write the failing tests**

Against recorded API responses: reading a project's files; a write that commits once with the agent's message; a write whose SHA has moved failing with a conflict error and writing nothing; an attempted write outside the project's paths being refused before any request; disconnect removing the record.

Run: `cd apps/jscad-studio/server && npx vitest run github`
Expected: FAIL.

- [ ] **Step 2: Implement and pass**

- [ ] **Step 3: Commit**

```bash
git add apps/jscad-studio/server/src/git apps/jscad-studio/src/storage/git.js apps/jscad-studio/server/test/github.test.ts
git commit -m "feat(studio): connected git repository storage"
```

---

### Task 13: Key custody

**Files:**
- Create: `apps/jscad-studio/src/keys.js`
- Create: `apps/jscad-studio/test/keys.test.js`
- Modify: `apps/jscad-studio/src/chat.js`, `apps/jscad-studio/server/src/agent/routes.ts`

**Model:** `sonnet` — small surface, but a mistake leaks a secret.

**Interfaces:**
- Produces: `keyStore` with `set(key, mode)`, `get()`, `clear()`, and `unlock(passphrase)`. Mode `session` keeps the key in memory only; `device` stores it in `localStorage` on the app origin; `synced` encrypts with AES-GCM under PBKDF2 and stores only ciphertext. The key travels to the server per request and is never logged, never persisted server-side, and never sent to the frame.

- [ ] **Step 1: Write the failing tests**

Round-trip encrypt and decrypt; a wrong passphrase fails without revealing anything; `session` mode leaves `localStorage` untouched; `clear()` removes every trace; a smoke assertion that the frame's message payloads never contain the key.

Run: `cd apps/jscad-studio && npx vitest run keys`
Expected: FAIL.

- [ ] **Step 2: Implement and pass**

- [ ] **Step 3: Commit**

```bash
git add apps/jscad-studio/src/keys.js apps/jscad-studio/test/keys.test.js
git commit -m "feat(studio): three key custody modes"
```

---

### Task 14: Deploy

**Files:**
- Create: `apps/jscad-studio/deploy.conf`, `apps/jscad-studio/server/deploy.conf`, `apps/jscad-studio-run/deploy.conf`, `apps/jscad-studio/deploy-full.sh`
- Create: `apps/jscad-studio/e2e/smoke-deploy.mjs`
- Read for reference: `/home/john/src/checklist/deploy.conf`, `/home/john/src/checklist/backend/deploy.conf`, `/home/john/src/checklist/deploy-full.sh`

**Model:** `sonnet` — configuration mirroring a working example.

**Interfaces:**
- Produces: three deploy configs and a driver that deploys the front end, then the API, then the run host, then checks health and runs the smoke test.

- [ ] **Step 1: Write the configs**

Front end: `DEPLOY_TYPES="letsencrypt apache"`, `APACHE_MODE="hybrid"`, `APACHE_SPA_MODE="yes"`, `APACHE_PROXY_RULES="/api:${APP_PORT}:/api"`, `DOMAIN_NAME="jscad-studio.rkroll.com"`. API: `DEPLOY_TYPES="express_app"`. Run host: `DEPLOY_TYPES="letsencrypt apache"`, static only, `DOMAIN_NAME="run.jscad-studio.rkroll.com"`, with the CSP and `Permissions-Policy` headers set by the vhost.

- [ ] **Step 2: Write the smoke test**

It loads the app, signs in with the test credentials, creates a project, runs one turn against a stub provider, and asserts a rendered canvas and an STL download.

- [ ] **Step 3: Deploy to the test environment and run it**

Expected: health check passes, smoke test passes.

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-studio/deploy.conf apps/jscad-studio/server/deploy.conf apps/jscad-studio-run/deploy.conf apps/jscad-studio/deploy-full.sh apps/jscad-studio/e2e/smoke-deploy.mjs
git commit -m "feat(studio): deploy configuration for both origins"
```

---

## Order and checkpoints

Tasks 1 and 2 are independent and can run in parallel. Task 3 needs 2; Task 4 needs 1 and 3; Task 5 needs 4. Tasks 6 and 7 are independent of the browser work. Task 8 needs 7; Task 9 needs 5 and 8. Task 10 needs 6; Tasks 11 and 12 need 10. Task 13 needs 9. Task 14 needs everything.

Two checkpoints worth stopping at:

- After Task 5, the app renders and edits models through the frame with no accounts and no agent. That is the moment to confirm the origin boundary holds in a real browser.
- After Task 9, one full turn works end to end. That is the moment to judge whether the agent loop is good enough before building three storage modes on top of it.
