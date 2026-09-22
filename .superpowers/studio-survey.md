# jscad-studio implementation survey

Facts gathered 2026-09-16 for planning `jscad-studio`, per
`jscadui` (branch `dev`) `docs/design/jscad-studio.md`. Read via
`git show dev:docs/design/jscad-studio.md` (jscadui working tree was on
`main`; `dev` = `main` + that one doc commit, so every other file surveyed
below is identical on either branch).

## A. jscadui `apps/jscad-web`

### A1. Layout and build

Directories (`/home/john/src/jscadui/apps/jscad-web/`):

- `src/` — app modules: `about.js`, `addV1Shim.js`, `animRunner.js`,
  `demoBrowser.js`, `directoryParser.js`, `drawer.js`, `editor.js`,
  `engine.js`, `error.js`, `examples.js`, `exporter.js`, `fileSystem.js`,
  `gridLayout.js`, `menu.js`, `paramsUI.js`, `reloadDetection.js`,
  `remote.js`, `stats.js`, `str2ab.js`, `studioBridge.js`, `themes.js`,
  `trustedSources.js`, `trustedSourcesUI.js`, `viewState.js`, `welcome.js`,
  `workerSetup.js`.
- `src_bundle/` — esbuild entry points for each IIFE/CJS bundle:
  `bundle.V1_api.js`, `bundle.fs-serviceworker.js`, `bundle.jscad.io.js`,
  `bundle.jscad_io.js`, `bundle.jscad_modeling.js`, `bundle.jscad_text.js`,
  `bundle.jscadui.transform-babel.js`, `bundle.manifold-wasm.js`,
  `bundle.manifold_modeling.js`, `bundle.openscad.js`,
  `bundle.params_core.js`, `bundle.regl.js`, `bundle.render-regl.js`,
  `bundle.threejs.js`, `bundle.worker.js`, `loadJscadIo.js`.
- `src_build/` — the build tooling itself: `esbuildUtil.js`,
  `exampleExclusions.js`, `genExamplesManifest.js`, `hashAssets.js`.
- `static/` — copied verbatim into the output dir: `index.html`,
  `main.css`, `jscadui.manifest`, icons, `animation.js`, `clock.js`,
  `pantograph.js`, `robots.txt`, test fixtures.
- `e2e/` — Playwright specs (`app.spec.js`, `editor.spec.js`,
  `export.spec.js`, `openscad.spec.js`, `params.spec.js`, etc.) plus
  `render-all.mjs` / `smoke-deploy.mjs` scripts.

`build.js` (root of the app):

- Reads `package.json` to inject an About-page dependency list into
  `static/index.html` (`injectAboutInfo`, build.js:33-40).
- `--dev`, `port`, `--serve`, `--skipDocs` are read via
  `parseArgs()` (build.js:47). `dev` selects `outDir = 'build_dev'` vs
  `'build'` (build.js:48).
- Docs: unless `--skipDocs`, it requires a sibling `../../../OpenJSCAD.org`
  checkout, runs `npm run docs` there if `docs/` is missing, and copies
  `docs/` into the output (build.js:49-61, 78-83). This is the same sibling
  checkout `@jscad/modeling` is pulled from (`file:../../../OpenJSCAD.org/packages/modeling`
  in `package.json`).
- Copies `static/` → outDir, `examples/` → `outDir/examples` (with a
  generated `manifest.json` for the demo browser, since there's no server
  autoindex) (build.js:65-76).
- Builds bundles in order, `watch: dev` for the file-watching build:
  `bundle.threejs.js`, `bundle.regl.js`, `bundle.render-regl.js` (esm),
  then CJS-loader bundles `bundle.jscad_modeling.js`,
  `bundle.manifold_modeling.js` (external `@jscad/modeling-for-manifold` to
  avoid circular resolution — build.js:96-105), `bundle.jscad_io.js`,
  `bundle.V1_api.js`, `bundle.params_core.js`,
  `bundle.jscadui.transform-babel.js`, `bundle.openscad.js` (with a
  `nodeBuiltinStubPlugin` stubbing `fs`/`path`/`os`/`fs/promises` for
  Node-only branches in `openscad-parser` — build.js:119-172),
  `bundle.jscad_text.js`.
- Manifold WASM is copied by hand: `copyFileSync('../../node_modules/manifold-3d/manifold.wasm', outDir+'/build/manifold.wasm')` (build.js:108).
- `bundle.worker.js` and `bundle.fs-serviceworker.js` are built as IIFE and
  watched separately (build.js:181,183) — these are the two files that
  change most and are re-served live in dev mode.
- `main.js` is built ESM with a custom loader (`.example.js` files parsed
  as text) (build.js:187-192).
- Content hashing (`hashAssets(outDir)`) runs only when `!dev`
  (build.js:195) — see A1a.
- Dev mode starts `live-server` on the output dir, ignoring `docs/`
  (build.js:200-201); non-dev with `--serve` calls `serve(port)` from
  `serve.js`.

**What a second app needs to build the same way:** its own `build.js`
following this same recipe (own `outDir`, own bundle list), a sibling
`OpenJSCAD.org` checkout for docs/`@jscad/modeling` unless it also passes
`--skipDocs`, and (if it reuses the worker) either its own
`bundle.worker.js` entry or a shared build step that emits one worker
bundle both apps serve.

#### A1a. Hashing step (`src_build/hashAssets.js`)

Production only (`!dev`). Hashes every leaf `build/*.js` (except
`bundle.worker.js`) first, then `bundle.worker.js` (which `importScripts`
the hashed leaves), then `main.css`, then `main.js` (references every
hashed bundle including the worker), then rewrites `main.js`/`main.css`
refs inside `index.html` — `index.html` itself is never hashed, served
no-cache (hashAssets.js:15-58). A second app's build must follow the same
topological order if it wants long-cache bundle URLs.

### A2. Page bootstrap

`static/index.html:139-154`: one inline bootstrap `<script>` (reads
`localStorage` for dark-mode/welcome-dismissed/editor width, synchronous,
before paint) then a single `<script type="module" src="./main.js">`
(index.html:154). No other script tags — worker, editor, renderer all load
as ES module imports inside `main.js`.

`main.js` init order (top-level, awaited sequentially):

1. Global `error`/`unhandledrejection` listeners (main.js:13-19).
2. `Gizmo` + `OrbitControl` camera wiring, appended to `#layout`
   (main.js:76-100).
3. Stats/progress DOM wiring (main.js:103-105).
4. `paramsUI.initParamsController()` (main.js:108).
5. `createWorker(...)` — spins up the Web Worker and the `messageProxy`
   wrapper, i.e. the worker protocol client (main.js:151-156, delegates to
   `workerSetup.js`).
6. File-system drag/drop wiring (main.js:159-185).
7. `installStudioBridge(...)` — exposes `window.jscadStudio` for external
   automation (main.js:200-209; see A2a).
8. `viewState.setEngine(await engine.init(viewState.renderEngine))` —
   render engine (three.js or regl) is initialized **before** the worker
   is told to init, so its GPU-normals capability can be queried
   (main.js:400).
9. `await workerApi.jscadInit({ bundles: workerBundles(), useParamsProxy })`
   (main.js:402) — tells the worker which module bundles (jscad-modeling,
   manifold, etc.) to use.
10. `editor.init(defaultCode, compileFn, saveFn, getFileFn)`
    (main.js:448-494) — CodeMirror is created here, wired to
    `jscadScript(...)` (compile) and a `showSaveFilePicker`-based save.
11. `menu.init`, `welcome.init`, `about.init`, trusted-sources dialog wiring
    (main.js:497-519).
12. `remote.init(...)` — loads a script from a remote URL/hash if present
    (main.js:521-538).
13. `exporter.init(workerApi)` — fetches available export formats from the
    worker (main.js:540).
14. If nothing else loaded a script, load the default example
    (main.js:543-548).
15. Service-worker filesystem init (`fileSystem.initFs`) if not already
    present (main.js:550-557).

#### A2a. `studioBridge.js` — an existing, different, external API

`apps/jscad-web/src/studioBridge.js:1-23` installs `window.jscadStudio =
{ ready, getParams, setParams(obj) }`. This is used today by
`jscad-work render`'s headless-browser bridge and the dev-mode SSE reload
channel (`lib/viewer-server.js` in `jscad-ai-studio`, `BRIDGE_SCRIPT` at
viewer-server.js:11) to push parameter changes into an already-loaded page
and read results back via `page.evaluate`. It is **not** the postMessage
protocol the studio design specifies between two origins — it's an
in-page JS object callable only from the same JS realm (e.g. Playwright's
`page.evaluate`), with no origin check and no structured command/result
shape. It's worth knowing about but does not satisfy the design's compute
frame command surface.

### A3. Worker protocol

Defined by `@jscadui/worker`
(`/home/john/src/jscadui/packages/worker/worker.js`) and wrapped for
transport by `@jscadui/postmessage`
(`/home/john/src/jscadui/packages/postmessage/index.js`).

Handlers exposed via `initWorker()` (worker.js:478,505):

```js
const handlers = { jscadScript, jscadInit, jscadMain, jscadClearTempCache, jscadClearFileCache: clearFileCache, jscadExportData }
```
plus, via a `Proxy`, any exported function on the currently-loaded script
module (worker.js:480-484) — so an arbitrary model file can add ad hoc
RPC-callable exports.

- `jscadInit(options: InitOptions): Promise<void>` (worker.js:165-187).
  `InitOptions = { baseURI?, alias?: Alias[], bundles?: {name:path},
  userInstances?, useParamsProxy? }` (worker.js:30-35).
- `jscadScript(options: RunScriptOptions): Promise<JscadScriptResultWithParams>`
  (worker.js:353-450). `RunScriptOptions = { script?, url, base, root? }`
  (worker.js:17-21). Internally serializes concurrent calls with a script
  lock (`acquireScriptLock`, worker.js:104-135, default 30s timeout) and a
  generation counter that invalidates a timed-out run
  (worker.js:355,362,382,407).
- `jscadMain(options: RunMainOptions): Promise<JscadMainResult>`
  (worker.js:203-343). `RunMainOptions = { params?, skipLog?,
  userInteractedPaths?, useGpuNormals? }` (worker.js:26-28, 200). Returns
  `{ entities, treeTime, execTime, convTime, proxyState? }`
  (worker.js:310-330), wrapped with `withTransferable(result, transferable)`
  (worker.js:331) so geometry buffers move zero-copy.
- `jscadExportData(params: {format}): Promise<{data: ArrayBuffer[]}>`
  (worker.js:456-474, and overridden per app by
  `bundle.worker.js:225-233`'s `exportData`, which serializes via
  `@jscad/io`'s serializer keyed by `format`).
- `jscadClearFileCache(options: ClearFileCacheOptions): Promise<void>`
  (`{files, root}` — `packages/require/src/require.js:296`).
- `jscadClearTempCache(): Promise<void>` (require.js:303, wrapped per-app
  in `bundle.worker.js:253-256` to also clear the `.scad` transpile
  cache).
- `jscadGetExportFormats?(): Promise<ExportFormatInfo[]>` (custom handler,
  `bundle.worker.js:221-223`).

**Model error shape:** a thrown error inside a handler is caught by
`initMessaging`'s `listener` (postmessage/index.js:150-157) and sent as
`{ method: '__RESPONSE__', error: { message, name, stack }, id }`
(postmessage/index.js:60-70). The receiving side reconstructs an `Error`
and rejects the pending promise (postmessage/index.js:130-136). `jscadMain`
itself wraps a model failure as `jscadMain failed: <message>` before
re-throwing (worker.js:332-342), after clearing the format cache and
geometry state.

**Entities shape:** `jscadMain`/`jscadScript` results carry
`entities: unknown | Array<unknown>` (produced by
`JscadToCommon.prepare(...).all`, worker.js:307) plus timing fields.
`main.js:handleEntities` (main.js:121-146) normalizes to an array,
calls `viewState.setModel(entities)`, and (if `zoomToFit`) computes a
`boundingBox` from `@jscadui/format-common`.

**`@jscadui/postmessage` wrapping:**
`messageProxy(_self, handlers, {onJobCount, debug})` (index.js:202-242)
returns a `Proxy` where calling any property name sends
`{method, params, id}` via `postMessage` and returns a `Promise` that
resolves on the matching `{method:'__RESPONSE__', id}` message
(`sendCmd`, index.js:93-115); properties beginning with `on`
(2 chars, or the 3rd char uppercase) instead fire a one-way `sendNotify`
(index.js:216-220). Every call has a default 5-minute timeout that
rejects and evicts the pending map entry (index.js:99-109, `DEFAULT_TIMEOUT`
= `5*60*1000`, index.js:8).

**Gap for a cross-origin frame:** `initMessaging` registers a bare
`message` listener (`_self.addEventListener('message', wrappedListener)`,
index.js:167) with **no `event.origin` check anywhere** in this package.
It also has no way to reject an unknown method gracefully as a *sent*
error — an unrecognized `method` throws synchronously inside the async
listener body before the try/catch that calls `sendError`
(index.js:144-148 is outside the `try` at 150), so it's only caught by the
outer `wrappedListener`'s `.catch()` (index.js:162-166), which just logs;
the caller's request is left to time out. Both are relevant to the design's
requirement that the compute frame "accepts messages only from the app
origin, checked against `event.origin`" — that check does not exist in
this package today and would need adding, either in the frame's own
message handler or in a wrapped `messageProxy`.

### A4. Editor

- Packages: `codemirror` (`^6.0.1`, the batteries-included meta-package),
  `@codemirror/lang-javascript` (`^6.1.9`), and `@codemirror/commands`
  (`keymap`, `defaultKeymap`) — all direct deps of `@jscadui/jscad-web`
  (`apps/jscad-web/package.json`).
- Created in `apps/jscad-web/src/editor.js:92-113`:
  `new EditorView({ extensions: [basicSetup, javascript(), keymap.of([...])], parent: editorDiv })`,
  where `editorDiv = document.getElementById('editor-container')`.
  Keybindings: `Shift-Enter` → `runScript` (compile without saving),
  `Mod-s` → `save(doc, currentFile)` (editor.js:97-109).
- **Save path:** `editor.js:58-61` `save(code, path)` calls
  `compileFn(code, path)` then `saveFn(code, path)`. `main.js` supplies
  both as the 2nd/3rd args to `editor.init(...)` (main.js:448-494):
  `compileFn` re-resolves the URL and calls `jscadScript({script, url, base})`
  → `workerApi.jscadScript(...)` (main.js:296-312), i.e. save reaches the
  worker by re-running `jscadScript` with the edited source text passed
  inline (no file round-trip needed for the worker to see the edit).
  `saveFn` (main.js:462-492) is a *separate* concern — persisting to disk —
  and uses `showSaveFilePicker` / the service-worker file handle map, not
  the worker.
- **File system provider → `require`:** `@jscadui/fs-provider`
  (`packages/fs-provider/fs-provider.js`) backs a Service Worker
  registered at `/swfs/<id>/` (`registerServiceWorker`, fs-provider.js:163-237)
  that serves dropped/directory-picker files. The worker's `require()`
  (`packages/require/src/require.js:63-270`) reads files via
  `readFileWeb` — a **synchronous XHR** against `self.location.origin`
  (`packages/require/src/readFileWeb.js:4-33`, note the hard
  `new URL(finalUrl, self.location.origin)` at readFileWeb.js:13). A
  `.js` entry `require`-ing a `.scad` part works because `requireHandlers`
  registers a `'scad'` handler (`apps/jscad-web/src_bundle/bundle.worker.js:78-204`)
  that transpiles OpenSCAD source before `require.js` evals it — same file
  type resolution the design's "Projects" section assumes.

### A5. Params UI

- `apps/jscad-web/src/paramsUI.js` wraps `@jscadui/params-controller`
  (`createParamsController`, paramsUI.js:76-79) and
  `@jscadui/params-ui` (`createParamsTree`, paramsUI.js:281-294).
- Parameter definitions arrive from the worker two ways depending on
  `useParamsProxy` (main.js:109, always `true` in this app):
  - **Proxy mode** (worker.js:416-434): `jscadScript` first runs
    `jscadMain({params:{}})` to *discover* params by executing `main()`
    once against a recording proxy (`createProxyState`/`createParamsProxy`
    from `@jscadui/params-core`), then converts the discovered tree to
    `def`/`params` via `toParamDefinitions`/`extractProxyDefaults`. The
    result's `proxyState` (`{discovered, types, classes, tree}`,
    worker.js:313-319) is what `main.js:314-374` uses to build the tree UI.
  - **Flat mode** (worker.js:435-446): `getParameterDefinitionsFromSource(script)`
    (static analysis of the source) combined with an optional
    `getParameterDefinitions()` export, via
    `apps/jscad-web/src/paramsUI.js`'s sibling `genParams` from
    `@jscadui/params` (main.js:377).
- **A change re-runs the model** via `paramsUI.runModelUpdate(deps)`
  (paramsUI.js:174-225), which calls `workerApi.jscadMain(paramsCtrl.getWorkerParams())`
  and feeds the result to `handleEntities`. Individual tree edits go
  through `paramsUI.handleTreeParamChange(path, value, onScheduleUpdate)`
  (paramsUI.js:233-255) → `paramsCtrl.setParam(path, value)` → debounced
  (`scheduleModelUpdate`, 50ms, paramsUI.js:135-142) call into
  `runModelUpdate`. Flat-mode legacy sliders instead call the
  `paramChangeCallback` defined in `main.js:249-286`, which calls
  `workerApi.jscadMain(...)` directly.

### A6. Renderer

- `apps/jscad-web/src/engine.js:14-51` `init(engineType)` picks
  `@jscadui/render-threejs`'s `RenderThreejs(THREE)` (statically imported)
  or, for `regl`, dynamically loads `build/bundle.regl.js` +
  `build/bundle.render-regl.js` via `<script>` tags
  (`@jscadui/render-regl`) and calls the resulting global
  `RenderReglBundle.RenderRegl()`. Both viewers are constructed against
  `#viewer` (`document.getElementById('viewer')`, engine.js:15).
- Camera/gizmo/canvas ownership: `main.js:76-100` creates
  `@jscadui/html-gizmo`'s `Gizmo` and `@jscadui/orbit`'s `OrbitControl`
  bound to `[byId('viewer')]`, syncing camera state through
  `apps/jscad-web/src/viewState.js`'s `ViewState` (camera, axes/grid via
  `@jscadui/scene`'s `makeAxes`/`makeGrid`, `setModel`/`updateScene`
  pushing `{items:[...]}` into `viewer.setScene(...)`,
  viewState.js:214-222). Camera position/target persist to
  `localStorage['camera.location']` (viewState.js:191-198) — app-origin
  local storage, unrelated to the worker's origin.
- **Cross-origin note:** nothing in the renderer or camera path assumes
  same-origin with the worker beyond `engine.js`'s `addScript()` loading
  renderer bundles same-origin from the app's own `build/` — that's
  unaffected by moving the *worker* to another origin, since the renderer
  stays on the app origin per the design. The one place that *would* need
  care is `viewState.js`'s `boundingBox(entities)` / `setModel(entities)`
  consuming whatever shape `handleEntities` hands it (main.js:121-146) —
  today that's the raw worker RPC result; under the design it will instead
  be data arriving over a second `postMessage` hop from the iframe, so
  `handleEntities` needs to accept results keyed by transfer instead of a
  direct RPC return, and the viewer's proposed vertex/buffer caps
  (mentioned in the design, not implemented anywhere today — see D) would
  sit in front of `viewState.setModel`.

### A7. Export

Entirely client-side, same JS realm as the worker call: `exporter.js:32-68`
populates a `<select>` from `workerApi.jscadGetExportFormats()`, and on
click calls `exportAsFile(formatName, ext)` (exporter.js:93-103) →
`workerApi.jscadExportData({format})` → the worker's `exportData` handler
(`bundle.worker.js:225-233`, uses `@jscad/io`'s serializer keyed by
`config.serializerKey` from `defaultSerializerConfigs`
(`@jscadui/format-common/src/exportFormats.js`)) → bytes are downloaded via
`@jscadui/scene`'s `downloadBlob` (exporter.js:101). There is no server
round-trip and no separate export context — export runs against whatever
geometry the worker currently holds in `workerState.solids`
(worker.js:476 `currentSolids()`).

## B. checklist

Repo `/home/john/src/checklist`, checked-out branch **`jazz-migration`**
(not `main`) — this branch has materially rearchitected auth and storage
away from what a plain "checklist as it deploys today" read would
suggest; flagged throughout and in Gaps.

### B8. Backend skeleton

- Entry: `backend/src/index.ts`. `createServer(config: ServerConfig)`
  (index.ts:103-185) builds one `better-sqlite3` `Database`
  (`new Database(config.dbPath)`, index.ts:104), registers only
  `registerShareTables(db)` locally (index.ts:108) — RBAC group tables
  now live in hosted rowboat, not this DB (comment, index.ts:106-107).
- **Config/env:** `configFromEnv()` (index.ts:187-276) loads `dotenv` from
  `../.env` then `.env` (index.ts:17-18), reads `PORT`, `BIND_HOST`,
  `AUTH_DB_PATH`, `FRONTEND_URL`, `BETTER_AUTH_SECRET`,
  `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET`, `ROWBOAT_DATABASE_ID`
  (required, throws if absent, index.ts:226-229), `ROWBOAT_URL` (required,
  index.ts:231-236), `ROWBOAT_AGENT_ID` (default `agent:checklist`,
  index.ts:258), SMTP settings, and `CHECKLIST_TEST_AUTH` (test-only
  verification bypass, index.ts:195,271).
- **Health endpoint:** `app.get('/api/health', ...)` returns
  `{status:'ok', timestamp}` (index.ts:163-165), mounted *after*
  `identity.mountAuthRoutes` but before share routes.
- **CORS:** a hand-rolled allow-list middleware, not the `cors` package
  (index.ts:69-89) — echoes `Access-Control-Allow-Origin` only for
  origins in `config.trustedOrigins`, sets `Allow-Credentials: true`, and
  answers `OPTIONS` with 204. `trustedOrigins` is a hardcoded list
  (`localhost:8765/8766/5173`, `https://checklist-app.rkroll.com`,
  `https://appleid.apple.com`, plus `FRONTEND_URL` if set — index.ts:246-253).
- **BetterAuth wiring:** via `@jbroll/rowboat-auth-betterauth`'s
  `createIdentity({db, authSecret, baseUrl: '${baseUrl}/api/auth', jwt:
  {issuer, audience: rowboatDatabaseId, expirationTime:'15m'},
  provisionRootGroup:false, providers, emailAuth, sendEmail,
  sendVerificationEmail})` (index.ts:111-140). Providers are built from env
  as `OAuthProviderConfig[]` — Google (`scopes:['openid','email']`,
  `options:{prompt:'select_account', disableDefaultScopes:true}`) and
  Apple (`scopes:['name','email']`) (index.ts:199-221), only included if
  both client id and secret env vars are set. `identity.mountAuthRoutes(app,
  {groupBackend})` (index.ts:159) must run **before**
  `express.json()` (index.ts:161) because better-auth reads the raw
  request body. The JWT `audience` is the rowboat `databaseId` — every
  token this backend mints is scoped to exactly one rowboat tenant
  database.

### B9. Rowboat as a service

- **Client/SDK modules used by the backend:**
  `@jbroll/rowboat-auth-betterauth` (`createIdentity`, `Identity`,
  `EmailAuthConfig`, `OAuthProviderConfig`, `SendEmail`) and
  `@jbroll/rowboat-sharing` (`mountShareRoutes`, `registerShareTables`,
  `remoteGroupBackend`) — both `file:` deps resolving to
  `/home/john/src/rowboat/packages/{auth-betterauth,sharing}`
  (`backend/package.json`).
- **Group/RBAC calls:** `remoteGroupBackend({baseUrl:
  '${rowboatUrl}/db/${rowboatDatabaseId}/api/sync', token: actor =>
  identity.signJWT(actor)})` (index.ts:152-155) — every group
  read/write goes to hosted rowboat, authenticated **as the acting user**
  (a freshly signed JWT per call), not as a service principal; rowboat's
  own RBAC decides the grant. `config.rowboatAgentId` (`agent:checklist`)
  is used only as a standing actor for invite-accept grants when the
  inviter is offline (index.ts:151,172).
- **Per-user scoping:** enforced entirely by rowboat, keyed by the JWT's
  `sub` and the group ids in the request — this backend has no local
  per-user row scoping beyond `share_invites`/account-merge state.
- **Blobs/files:** the front end talks to rowboat's data plane directly
  (see B10), not through this backend. This backend itself does not call
  an object store API — only sharing/RBAC and identity.

### B10. Front end

- **Vite:** `package.json:14` `"build": "tsc --noEmit && npm run
  build:website && vite build --mode production"`, `"dev:frontend":
  "bash scripts/with-tenant-env.sh npx vite"` — dev proxies `/api` to the
  backend (comment, `src/lib/syncToken.ts:12`).
- **Auth:** `src/lib/auth-client.ts` is one line:
  `createBetterAuthClient(import.meta.env.VITE_AUTH_URL)` from
  `@jbroll/rowboat-auth-betterauth-react`. `src/components/AuthGate.tsx:3`
  imports `signIn, signOut, useAuthor, useSession` from a local barrel
  `@/rowboat` (re-exporting from `src/rowboat/`, not shown in depth here).
- **Backend calls:** the app almost never calls its own backend for data —
  it calls hosted rowboat directly with a short-lived JWT. The token is
  minted same-origin: `getSyncToken()` (`src/lib/syncToken.ts:29-38`) does
  `fetch('${VITE_AUTH_URL}/api/auth/token', {credentials:'include'})`
  (the session cookie authenticates the mint), caches the JWT, and
  re-mints 60s before `exp`. That token is then sent as
  `Authorization: Bearer <token>` on every `POST ${SYNC_BASE}/groups`
  (`src/lib/rowboat.tsx:73-91`) and every
  `syncWithServer({db, apiBase: SYNC_BASE, ...headers})` call
  (`src/lib/rowboat.tsx:150-158, 210-216`), where `SYNC_BASE =
  import.meta.env.VITE_ROWBOAT_SYNC_BASE` (rowboat.tsx:45-48), a URL
  shaped `<rowboatUrl>/db/<databaseId>/api/sync` baked into the bundle at
  build time (`deploy.conf:27-28`).
- **Data model on the front end:** `@jbroll/rowboat-client`'s
  `buildRowboatDb(storeName(appName, identity), manifest, migrations,
  epoch, dexieOptions)` builds a **Dexie/IndexedDB**-backed `RowboatDb`
  per identity (`src/lib/rowboat.tsx:110-117`); `@jbroll/rowboat-react`'s
  `useRowboat(schema, db)` binds a reactive `RelationalGraph`
  (rowboat.tsx:142); `@jbroll/rowboat-schema`'s `compileSchema(schema)`
  produces the `manifest` (rowboat.tsx:50). This is a schema-driven,
  offline-first relational sync layer, not a generic per-user
  document/blob API — see Gaps.

### B11. Deploy

Two independent `deploy.sh`-framework configs, driven by a **custom**
`deploy-full.sh` (not itself part of the generic `deploy.sh` framework):

- **Frontend** `checklist/deploy.conf`: `DEPLOY_TYPES="letsencrypt apache"`,
  `APP_NAME="checklist-app"`, `DOMAIN_NAME="checklist-app.rkroll.com"`,
  `APACHE_MODE="hybrid"` (static + proxy in one module),
  `APACHE_CONTENT_DIR="."`, `VITE_ROWBOAT_SYNC_BASE` baked in at build
  time, `APACHE_BUILD_CMD="npm run build"`, `APACHE_BUILD_ENABLED="yes"`,
  `APACHE_WEB_ROOT="/var/www/checklist-app"`,
  `APACHE_PROXY_RULES="/api:${APP_PORT}:/api"` (APP_PORT injected by
  `deploy-full.sh`), `APACHE_SPA_MODE="yes"`.
- **Backend** `checklist/backend/deploy.conf`:
  `DEPLOY_TYPES="express_app"` (not `node_app`), `APP_NAME="checklist-api"`,
  same `DOMAIN_NAME`, `EXPRESS_APP_PORT="${APP_PORT}"`,
  `EXPRESS_APP_USER/GROUP="checklist"`, `EXPRESS_APP_BASE_PATH="/var/lib"`,
  `EXPRESS_APP_DATA_PATH="/var/lib/checklist-api-data"`,
  `EXPRESS_APP_MAIN_SCRIPT="dist/index.js"`,
  `EXPRESS_APP_NODE_ENV="production"`,
  `EXPRESS_APP_NODE_OPTIONS="--enable-source-maps --max-old-space-size=512"`.
- `deploy-full.sh [test|prod] [init|update]` (repo root): sets `APP_PORT`
  per environment (`3001` prod, `3002` test), then runs, in order: (1) the
  generic `deploy.sh` against the root (frontend, static+proxy), (2) `cd
  backend && deploy.sh` (backend, `express_app`), verifying
  `https://<host>/api/health` afterward with a 3s `sleep` and, on
  failure, `ssh <host> "sudo journalctl -u checklist-api -n 10"`,
  (3) `npm run test:smoke:<env>`. The systemd unit name it checks is
  `checklist-api` (prod) — `deploy-full.sh:88`. Test env swaps in
  `deploy-test.conf` / `backend/deploy-test.conf` first
  (`deploy_with_config`, deploy-full.sh:53-64) rather than editing
  `deploy.conf` directly.

## C. rowboat

Repo `/home/john/src/rowboat`. Packages relevant to a consuming app:
`packages/{client,react,schema,shared,auth,auth-betterauth,
auth-betterauth-react,backend,object-store-s3,rowboat-cli,rowboat-service,
router}`.

### C12. What a consuming app gets

**Data/rows (sync, not a generic CRUD doc store):**
- `@jbroll/rowboat-client`'s `buildRowboatDb(name, tables: TableManifest[],
  migrations: SchemaMigration[], epochMs?, options?: RowboatDbOptions):
  RowboatDb` (`packages/client/src/db-factory.ts:21-26`) builds a local
  Dexie-backed store.
- `syncWithServer(opts: SyncOptions, retryDepth = 0): Promise<void>`
  (`packages/client/src/sync.ts:30`) pushes pending local writes (chunked)
  then pulls; `SyncOptions` includes `{db, apiBase, appVersion, author,
  headers}` (used at `checklist/src/lib/rowboat.tsx:152-158`).
- `@jbroll/rowboat-schema`'s `compileSchema(schema)` turns an app's schema
  file into the `TableManifest[]` both `buildRowboatDb` and the sync/pull
  protocol need.
- `@jbroll/rowboat-react`'s `useRowboat(schema, db)` /
  `useSelect(selector)` bind a reactive `RelationalGraph` for React
  components.
- **Tenant creation** is out-of-band, via the CLI, not an API call a
  running app makes: `rowboat-cli provision-tenant --schema <path>
  --jwks-url <app JWKS URL> --issuer <app better-auth issuer>
  --state <output.json> --control-plane-url <rowboat origin>`
  (`checklist/package.json:11-13`, three variants for local/test/prod).
  This writes a `rowboat-tenant.<env>.json` containing the provisioned
  `databaseId` the app's backend then reads as `ROWBOAT_DATABASE_ID`.
- **Group minting** (the RBAC scope unit) is an authenticated HTTP call
  the consuming app's own backend makes on the user's behalf:
  `POST <rowboatUrl>/db/<databaseId>/api/sync/groups` with
  `Authorization: Bearer <JWT signed by the app's identity>`
  (`checklist/src/lib/rowboat.tsx:72-92`, proxied through
  `remoteGroupBackend` server-side per B9).

**Blobs (object store API a consuming app actually calls over HTTP):**
`mountFileRoutes` (`packages/backend/src/file-routes.ts`) mounts, under
`basePath` (checklist config: `/db/:database_id/api/sync/files`,
`packages/rowboat-service/src/server-buildapp.mjs:267`):
- `POST <base>/upload` (file-routes.ts:175)
- `POST <base>/:hash/sign` (file-routes.ts:238) — mints a short-lived HMAC
  token (`signGetToken(secret, hash, exp)`, file-routes.ts:70-72; **not**
  a cloud-provider presigned URL — a token this server itself validates)
- `GET <base>/:hash` (file-routes.ts:266)

Storage is content-addressed (the object key is the object's sha-256
hash, `isHash` guard, `packages/object-store-s3/src/s3-object-store.ts:94-100`);
`@jbroll/rowboat-object-store-s3`'s `S3ObjectStore` (Node-only: `minio`
client, `node:stream`, `node:crypto`) implements `ObjectStore.put/get/
createReadStream/stat/list/delete` server-side
(`packages/object-store-s3/src/s3-object-store.ts:35-236`), scoped per
tenant via `.forNamespace(databaseId)` (s3-object-store.ts:61-65,
`NS_RE = /^[A-Za-z0-9_-]+$/`). **A browser never talks to
`@jbroll/rowboat-object-store-s3` directly** — only to the three HTTP
routes above, which run server-side inside rowboat's own service
(`packages/rowboat-service/src/server-buildapp.mjs:250-269`), not inside
the consuming app's backend.

### C13. Auth model

A consuming app's user maps to a rowboat tenant purely through **JWT
audience/issuer matching**, established once at provisioning time: the
app's better-auth JWKS URL and issuer are registered against a specific
`databaseId` by `provision-tenant` (see above); at runtime the app mints
its own JWTs (via `identity.signJWT(actor)` from
`@jbroll/rowboat-auth-betterauth`, `iss`/`aud` matching what was
registered) and rowboat's router verifies them against that app's public
JWKS — rowboat never sees the user's password or session cookie, only a
short-lived (`15m` in checklist's config) bearer JWT whose `sub` is the
app's own better-auth user id. Read authorization inside rowboat for
sync/group routes is RBAC (per-group role checks); for the file/blob
routes, **reads are default-deny** unless the mount passes both `auth` (or
`authFactory`) and a non-empty `tables` list building row-owner read authz
(`packages/backend/src/file-routes.ts:26-29` comment, and
`packages/rowboat-service/src/server-buildapp.mjs:243-249`'s comment:
"READ authz stays default-deny... deferred until a tenant schema actually
declares `rb.media()`"). checklist's current mount passes
`tables: appData.mediaTables ?? []` — empty unless a schema declares
media tables.

## D. Gaps

Things the design assumes or needs that do not exist yet, found while
surveying A-C:

1. **No sandboxed second-origin compute frame exists anywhere in
   jscadui or jscad-ai-studio.** The worker today only ever runs
   same-origin, spawned as a `new Worker('./build/bundle.worker.js')`
   directly in the app page (`apps/jscad-web/src/workerSetup.js:22`).
   There is no iframe, no `sandbox="allow-scripts"` usage, no CSP
   configuration, and no `Permissions-Policy` header anywhere in the
   `jscadui` repo. The whole "compute frame" component is new.

2. **`@jscadui/postmessage` has no origin checking.** `initMessaging`
   (`packages/postmessage/index.js:36-194`) listens for any `message`
   event with no `event.origin` filter (index.js:167) — the design's "The
   frame accepts messages only from the app origin, checked against
   `event.origin`" requirement is not implemented in the shared package
   the whole worker protocol is built on. It would need to be added
   either to the frame's handler or as a new option on `messageProxy`.

3. **The worker's `require()`/`readFileWeb` path is synchronous XHR
   against `self.location.origin`** (`packages/require/src/readFileWeb.js:4-33`),
   and local project files are served by a **same-origin Service
   Worker** (`@jscadui/fs-provider`'s `registerServiceWorker`,
   `packages/fs-provider/fs-provider.js:163-237`, prefix `/swfs/`). Under
   the two-origin design, the compute frame (run origin) cannot reach
   either the app origin's service worker or its storage; the design
   already accounts for this ("Files never reach the compute frame in
   any mode; it receives source text and returns data") but the current
   `jscadScript({script, url, base, root})` call still resolves
   *sibling* file `require`s (a `.js` requiring a `.scad` part, or
   relative imports) via `resolveUrl`/`readFileWeb` against `base`/`root`
   URLs, which assumes those siblings are fetchable from wherever the
   worker's origin is. Multi-file projects (not just a single entry file)
   crossing into the compute frame is unimplemented; today only a single
   `{script, url, base}` triple is passed to `jscadScript`.

4. **No agent loop, no tool-call loop, no SSE server exists anywhere in
   the surveyed repos.** `jscad-ai-studio/scripts/lib/{claude-cli-client.js,
   ollama-client.js}` implement only `messages.create({messages}) =>
   {content:[{type:'text', text}]}` — no `tools`/`tool_use`/`tool_result`
   handling in either client. The only existing SSE code in
   `jscad-ai-studio` is `lib/viewer-server.js`'s one-way dev-reload
   channel (`GET /__studio/events`, `BRIDGE_SCRIPT` at
   viewer-server.js:11) that pushes `{reload}` or `{params}` into a page
   already holding `window.jscadStudio` — a different, narrower surface
   than what the design's chat/tool loop needs (see A2a).

5. **`jscad-work`'s model tools (`eval`, `params`, `measure`, `check`,
   `dfm`, `export`, `render`, `parts`, `compare`, `interference`) are
   Node-only CLI commands** (`jscad-ai-studio/lib/cli.js:192-`, `COMMANDS`
   object), invoked via `bin/jscad-work.js`. None of them run in a
   browser/worker context today; the design's "measure and check code
   moves out of `jscad-ai-studio/lib` into a package both the CLI and this
   frame use" is not started — there is currently one implementation,
   in Node, not a shared package.

6. **No GitHub App / Contents API integration exists** in any surveyed
   repo — the "Connected git repository" storage mode has no code to
   build on.

7. **No client-side WebCrypto key-encryption code exists** in
   `jscad-ai-studio` or `checklist` — the "Synced" key-custody mode
   (AES-GCM + PBKDF2 passphrase) is wholly new.

8. **rowboat's object-store HTTP routes exist and are usable**
   (`POST <base>/upload`, `POST <base>/:hash/sign`, `GET <base>/:hash` —
   C12), but **read authorization is default-deny** until a schema
   declares media tables and the mount is given `tables`/`authFactory`
   (C13) — a real, not hypothetical, blocker for "Cloud (default)"
   project storage as described, since a project's model files would be
   blobs a user needs to read back.

9. **checklist's current (branch `jazz-migration`) data-plane is a
   schema-compiled, Dexie/IndexedDB-backed relational sync graph
   (`@jbroll/rowboat-client`/`-schema`/`-react`), not a generic per-user
   document/version-row API.** The design's "Cloud (default)... Files as
   blobs in rowboat's object store, with metadata in the user's
   database... a version row and a blob" is achievable (the blob routes
   exist per C12), but "metadata in the user's database" would mean
   designing a `TableManifest` schema (à la checklist's `shared/schema.ts`)
   for projects/files/versions and going through the same
   provision-tenant + sync machinery checklist uses — there is no
   simpler direct-SQL path documented or used anywhere in the surveyed
   code.

10. **No viewer-side geometry size caps exist today.** `viewState.setModel`
    (`apps/jscad-web/src/viewState.js:175-178`) and `handleEntities`
    (`apps/jscad-web/main.js:121-146`) accept and render whatever the
    worker returns with no vertex-count, buffer-size, or entity-count
    limit — the design's "viewer caps" defense-in-depth item is entirely
    unbuilt.

11. **`deploy.conf`'s `DEPLOY_TYPES` vocabulary actually used in this
    infra is `letsencrypt apache` (hybrid static+proxy) and
    `express_app`** (checklist), not `letsencrypt apache_proxy node_app`
    as the design's Deployment section names — a planning detail to
    reconcile against whatever `deploy.sh` module names actually exist
    (not audited here; only checklist's usage was surveyed).
