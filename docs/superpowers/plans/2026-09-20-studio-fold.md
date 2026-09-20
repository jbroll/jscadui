# Studio + compute-frame fold into jscad-web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold `apps/jscad-studio` and `apps/jscad-studio-run` into `apps/jscad-web`, then delete both apps. The compute frame becomes a co-deployed, integral part of jscad-web at `/frame/`; the agent path executes through it.

**Architecture:** Web is already a strict superset of the studio client (7 of 9 shared src files byte-identical; studio `chat`/`toolBridge` superseded by web `aiChat`/`aiBridge`). The frame moves with its protocol intact: same-host `/frame/` + `sandbox="allow-scripts"` (no `allow-same-origin`) keeps the opaque-origin isolation, so no code is trusted by source — AI output, dropped files, shared links, and examples are all untrusted input, and the frame removes their ambient authority (cookies, IndexedDB, same-origin fetch). Staged migration: the agent path (auto-executed, never-reviewed code) moves through the frame first; the editor keeps the local worker until the follow-up below proves the frame as the single engine.

**Tech Stack:** Node 22, ES modules, esbuild (web build + frame bundles), vitest, Playwright (frame protocol e2e), Express API (server, TS 5.7), File System Access API (folder storage, browser-only, memory seam for tests).

## Global Constraints

- jscadui style: ES modules, single quotes, no semicolons. Comments: none unless they say why, one or two lines.
- `git mv` preserves history for every relocated file; one commit per task below.
- All new/ported tests run keyless in plain vitest (folder: `fake-indexeddb` + memory persistence seam; git: injected `fetchFn` seam). Nothing added to CI hooks that needs keys or a browser.
- `file:../../../../rowboat` deps in the server stay valid after the move (depth is identical: `apps/<app>/server` → repo grandparent → `src/rowboat`).
- Deployed service identity is unchanged for the app and API: API stays `jscad-studio-api` on `:3006` behind the web hybrid proxy; no user/group/tenant renames. The `run.*` vhosts retire (operator teardown, Task 8).
- `apps/jscad-studio-run` is fully in scope (Tasks 5–6); nothing of it stays behind.
- Frame sandboxing is non-negotiable: the `/frame/` iframe always carries `sandbox="allow-scripts"` with no `allow-same-origin`; the opaque origin is what isolates model code. Never add `allow-same-origin`, never drop the sandbox attribute.
- One origin variable for the frame: the frame is served from the web origin, so `__RUN_ORIGIN__` and `__APP_ORIGIN__` bake the same value (default `https://jscad.rkroll.com`, dev override `http://localhost:5120`).
- Historical docs (`docs/design/*`, `docs/superpowers/plans/*`, `.superpowers/*`) are not rewritten.

## Prerequisite (already landed, not a task)

`ci/render` now builds jscad-web and asserts `apps/jscad-web/build/main.js` exists. Tasks below assume that gate.

---

### Task 1: Relocate the API server under jscad-web

**Files:**
- Move: `apps/jscad-studio/server/` → `apps/jscad-web/server/` (whole dir: `src/`, `test/`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `deploy.conf`, `RELAY.md`, `rowboat-tenant.prod.json`)
- Modify: `apps/jscad-web/server/package.json:2` (rename)

**Interfaces:**
- Consumes: nothing (server has zero static imports from the studio client; verified by grep).
- Produces: API source of truth at `apps/jscad-web/server/`; package name `@jscadui/jscad-web-server` (used by the Task 8 deploy script and Task 7 doc updates).

- [ ] **Step 1: Move the directory**

```bash
git mv apps/jscad-studio/server apps/jscad-web/server
git status --short | head -n 30
```

Expected: a block of `R` entries under `apps/jscad-web/server/`, nothing else.

- [ ] **Step 2: Rename the package**

In `apps/jscad-web/server/package.json`, replace:

```json
  "name": "@jscadui/jscad-studio-server",
```

with:

```json
  "name": "@jscadui/jscad-web-server",
```

Nothing else references the old name (verified: the only hit repo-wide is this line).

- [ ] **Step 3: Reinstall and run the server suite in its new home**

```bash
cd apps/jscad-web/server && npm install 2>&1 | tail -2 && npx vitest run 2>&1 | tail -5
```

Expected: install succeeds (`file:../../../../rowboat` still resolves — same depth as before); `Test Files 8 passed`, zero failures. These 8 suites (`github, health, loop, providers, relay-allowlist, relay-limiter, relay, syncToken`) never ran in CI (studio vitest only includes `**/*.test.js`); from here on they are the deploy gate for `/api/*`.

- [ ] **Step 4: Prove no stale self-references**

```bash
grep -rn "jscad-studio/server\|studio/server" apps/jscad-web/server/src apps/jscad-web/server/test apps/jscad-web/server/*.json apps/jscad-web/server/*.ts apps/jscad-web/server/*.md 2>/dev/null; echo "grep exit: $?"
```

Expected: exit 1 (no hits). `RELAY.md` contains no `studio` path references (verified).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(jscad-web): relocate API server from jscad-studio"
```

---

### Task 2: Port geometry caps and enforce them in web handleEntities

**Files:**
- Move: `apps/jscad-studio/src/caps.js` → `apps/jscad-web/src/caps.js`
- Move: `apps/jscad-studio/test/caps.test.js` → `apps/jscad-web/test/caps.test.js` (no content change — both dirs share the `test/` → `src/` relative layout, the `../src/caps.js` import resolves in both)
- Modify: `apps/jscad-web/main.js` (one import + one guarded call)

**Interfaces:**
- Consumes: nothing new.
- Produces: `capGeometry(entities, limits)` + `DEFAULT_CAPS` importable from `./src/caps.js` (web entity shape already matches: `{vertices, indices}` typed arrays, same as `countGeometry` reads in `src/stats.js:33-41`).

- [ ] **Step 1: Move both files**

```bash
git mv apps/jscad-studio/src/caps.js apps/jscad-web/src/caps.js
git mv apps/jscad-studio/test/caps.test.js apps/jscad-web/test/caps.test.js
```

- [ ] **Step 2: Run the ported test unmodified**

```bash
npm run test --workspace=@jscadui/jscad-web -- test/caps.test.js 2>&1 | tail -4
```

Expected: `Test Files 1 passed`, 5 tests passed.

- [ ] **Step 3: Wire the cap check into web handleEntities**

In `apps/jscad-web/main.js`, after line 46:

```js
import { updatePipelineStats, countGeometry, createProgressHandler } from './src/stats.js'
```

add:

```js
import { capGeometry, DEFAULT_CAPS } from './src/caps.js'
```

In `handleEntities` (`main.js:132-137`), after:

```js
  const entities = rawEntities instanceof Array ? rawEntities : [rawEntities]
```

add:

```js
  try {
    capGeometry(entities, DEFAULT_CAPS)
  } catch (error) {
    setError(error)
    onProgress(undefined)
    return
  }
```

The try/catch routes the refusal through the existing error banner instead of depending on message-proxy throw semantics; `setError` and `onProgress` are already in scope there. The AI path stays never-throw because `src/aiBridge.js` wraps every dep call in try/catch → error result.

- [ ] **Step 4: Run the web suite and build**

```bash
npm run test --workspace=@jscadui/jscad-web 2>&1 | tail -4
npm run build --workspace=@jscadui/jscad-web 2>&1 | tail -3
```

Expected: all test files pass (now including `test/caps.test.js`); build prints `hashed 16 assets`.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/caps.js apps/jscad-web/test/caps.test.js apps/jscad-web/main.js
git commit -m "feat(jscad-web): enforce geometry caps before render"
```

---

### Task 3: Port linked-folder storage (module + tests, no UI wiring)

**Files:**
- Move: `apps/jscad-studio/src/storage/folder.js` → `apps/jscad-web/src/storage/folder.js`
- Move: `apps/jscad-studio/test/storage-folder.test.js` → `apps/jscad-web/test/storage-folder.test.js`
- Modify: `apps/jscad-web/src/storage/folder.js` (two edits below)

**Interfaces:**
- Consumes: `kindFromEntry` from `./local.js` (byte-identical signature to the deleted `./cloud.js` one, verified line-for-line); web standalone `exportZip(storage, id)` / `importZip(storage, file)` from `./zip.js` work over the storage interface unchanged.
- Produces: `createFolderStorage`, `createMemoryPersistence`, `createIdbPersistence`, `isFolderStorageSupported`, folder error classes. Deliberately NOT registered in `src/storage/projects.js` `storeFor` and NOT added to any menu — neither app ever wired it into UI; the seam (`storeFor` in `projects.js:38`) is where a future task would plug it.

- [ ] **Step 1: Move both files**

```bash
git mv apps/jscad-studio/src/storage/folder.js apps/jscad-web/src/storage/folder.js
git mv apps/jscad-studio/test/storage-folder.test.js apps/jscad-web/test/storage-folder.test.js
```

- [ ] **Step 2: Rewire the kindFromEntry import**

In `apps/jscad-web/src/storage/folder.js`, replace:

```js
import { kindFromEntry } from './cloud.js'
```

with:

```js
import { kindFromEntry } from './local.js'
```

(`cloud.js` is deleted with the studio dir; the helper is identical.)

- [ ] **Step 3: Drop the withZip wrapper, keep compat constants**

Replace:

```js
  return withZip({
    link,
```

with:

```js
  return {
    link,
```

Callers use the standalone `exportZip`/`importZip` from `./zip.js`, which operate over the interface (`readProject`/`writeFiles`) — no per-mode wrapper needed. Keep `META_PATH = '.jscad-studio.json'` and `createIdbPersistence` default `'jscad-studio-folder'` byte-for-byte: existing linked folders and their IndexedDB handles use these names, and renaming would orphan them. Add one why-comment above `META_PATH`:

```js
// Kept from jscad-studio: existing linked folders carry this meta file.
const META_PATH = '.jscad-studio.json'
```

(replacing the existing `const META_PATH = '.jscad-studio.json'` line).

- [ ] **Step 4: Run the ported tests**

```bash
npm run test --workspace=@jscadui/jscad-web -- test/storage-folder.test.js 2>&1 | tail -4
```

Expected: pass (verified: the test file imports only `../src/storage/folder.js`, `fake-indexeddb/auto`, and vitest — same relative layout, and `fake-indexeddb` is already a web devDependency).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/storage/folder.js apps/jscad-web/test/storage-folder.test.js
git commit -m "feat(jscad-web): port linked-folder storage from jscad-studio"
```

---

### Task 4: Port git-backed storage and write its missing test

**Files:**
- Move: `apps/jscad-studio/src/storage/git.js` → `apps/jscad-web/src/storage/git.js`
- Create: `apps/jscad-web/test/storage-git.test.js`
- Modify: `apps/jscad-web/src/storage/git.js` (two edits, same as folder)

**Interfaces:**
- Consumes: `kindFromEntry` from `./local.js`; server `/api/git/*` routes (relocated in Task 1, deploy identity unchanged).
- Produces: `createGitStorage`, `GitStorageError`. Same no-UI-wiring rule as Task 3.

- [ ] **Step 1: Move the module**

```bash
git mv apps/jscad-studio/src/storage/git.js apps/jscad-web/src/storage/git.js
```

- [ ] **Step 2: Apply the same two edits**

Replace `import { kindFromEntry } from './cloud.js'` with `import { kindFromEntry } from './local.js'`; replace the `return withZip({` wrapper opener with `return {`; keep `META_PATH = '.jscad-studio.json'` with the same compat comment as Task 3 Step 3.

- [ ] **Step 3: Write the failing test**

Create `apps/jscad-web/test/storage-git.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { GitStorageError, createGitStorage } from '../src/storage/git.js'

const files = {
  'main.js': 'main() {}',
  '.jscad-studio.json': JSON.stringify({ name: 'n', entry: 'main.js' }),
}

const ok = (body) => ({ status: 200, ok: true, json: async () => body })

const storage = (fetchFn) =>
  createGitStorage({ apiBase: 'https://api.test', installationId: '7', owner: 'o', repo: 'r', fetchFn })

describe('git storage', () => {
  it('reads the project without the meta file', async () => {
    const s = storage(async () => ok({ files }))
    const project = await s.readProject()
    expect(project.entry).toBe('main.js')
    expect(project.mode).toBe('git')
    expect(project.files['.jscad-studio.json']).toBe(undefined)
  })

  it('writes with the head sha as expectedSha', async () => {
    const seen = []
    const s = storage(async (url, init) => {
      seen.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
      if (String(url).includes('/versions?')) return ok([{ sha: 'abc', message: 'm', created: 1 }])
      return ok({ commitSha: 'def' })
    })
    const res = await s.writeFiles('o/r:@root', { 'main.js': 'x' }, {})
    const write = seen.find((c) => String(c.url).includes('/write'))
    expect(write.body.expectedSha).toBe('abc')
    expect(res.commitSha).toBe('def')
  })

  it('maps a branch-moved 409 to GitStorageError', async () => {
    const s = storage(async () => ({ status: 409, ok: false, json: async () => ({}) }))
    await expect(s.readProject()).rejects.toThrowError(GitStorageError)
  })

  it('requires apiBase, installationId, owner and repo', () => {
    expect(() => createGitStorage({})).toThrowError(GitStorageError)
  })
})
```

Run:

```bash
npm run test --workspace=@jscadui/jscad-web -- test/storage-git.test.js 2>&1 | tail -4
```

Expected: FAIL with "Cannot find module '../src/storage/git.js'" until Steps 1–2 are done, then PASS (4 tests). If Step 2 is already done, it passes on first run — that still proves the seam (`fetchFn` injection, no network).

- [ ] **Step 4: Run the full web suite**

```bash
npm run test --workspace=@jscadui/jscad-web 2>&1 | tail -4
```

Expected: all files pass, including the new `test/storage-git.test.js`.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/storage/git.js apps/jscad-web/test/storage-git.test.js
git commit -m "feat(jscad-web): port git-backed storage from jscad-studio"
```

---

### Task 5: Co-deploy the compute frame at /frame/

**Files:**
- Move: `apps/jscad-studio-run/src/frame.js` → `apps/jscad-web/src_frame/frame.js`
- Move: `apps/jscad-studio-run/src/fileMap.js` → `apps/jscad-web/src_frame/fileMap.js`
- Move: `apps/jscad-studio-run/src/readFileFrame.js` → `apps/jscad-web/src_frame/readFileFrame.js`
- Move: `apps/jscad-studio-run/src_bundle/bundle.worker.js` → `apps/jscad-web/src_frame/bundle.frame-worker.js` (frame-specific worker entry: blob `__BUNDLE_BASE__`, no openscad lazy-load — openscad-in-frame is a follow-up, not this task)
- Move: `apps/jscad-studio-run/static/index.html` → `apps/jscad-web/static/frame/index.html`
- Move: `apps/jscad-studio-run/test/fileMap.test.js` → `apps/jscad-web/test/frame-filemap.test.js` (one import fix, Step 2)
- Move: `apps/jscad-studio-run/src_build/hashAssets.js` → `apps/jscad-web/src_build/hashFrameAssets.js` (frame-aware topological hashing; web's own `hashAssets.js` is untouched)
- Modify: `apps/jscad-web/build.js` (origin vars + frame build step), `apps/jscad-web/serve.js` (`.wasm` mime + `/frame/` branch)
- Delete in this task: nothing (the 8 bundle sources byte-identical to web's `src_bundle/*` are used in place and vanish with the run dir in Task 7; `test/parity.test.js` needs an external `jscad-ai-studio` checkout and is superseded by the Task 6 e2e — it dies with the dir)

**Interfaces:**
- Consumes: web `src_bundle/*` canonical sources; web `nodeBuiltinStubPlugin` already in `build.js`.
- Produces: `build/frame/index.html` + `build/frame/frame.js` + `build/frame/build/*` (modeling, manifold + `manifold.wasm`, io, model-tools, fluent, params_core, transform-babel, openscad, jscad_text, frame worker). `BUNDLE_BASE` resolves inside the frame dir, so the blob worker and bundle XHRs stay self-contained.

- [ ] **Step 1: Move the frame sources**

```bash
mkdir -p apps/jscad-web/src_frame apps/jscad-web/static/frame
git mv apps/jscad-studio-run/src/frame.js apps/jscad-web/src_frame/frame.js
git mv apps/jscad-studio-run/src/fileMap.js apps/jscad-web/src_frame/fileMap.js
git mv apps/jscad-studio-run/src/readFileFrame.js apps/jscad-web/src_frame/readFileFrame.js
git mv apps/jscad-studio-run/src_bundle/bundle.worker.js apps/jscad-web/src_frame/bundle.frame-worker.js
git mv apps/jscad-studio-run/static/index.html apps/jscad-web/static/frame/index.html
git mv apps/jscad-studio-run/test/fileMap.test.js apps/jscad-web/test/frame-filemap.test.js
git mv apps/jscad-studio-run/src_build/hashAssets.js apps/jscad-web/src_build/hashFrameAssets.js
```

- [ ] **Step 2: Fix the filemap test import**

In `apps/jscad-web/test/frame-filemap.test.js`, replace:

```js
import { createReadFile, PROJECT_BASE } from '../src/fileMap.js'
```

with:

```js
import { createReadFile, PROJECT_BASE } from '../src_frame/fileMap.js'
```

Run:

```bash
npm run test --workspace=@jscadui/jscad-web -- test/frame-filemap.test.js 2>&1 | tail -4
```

Expected: pass.

- [ ] **Step 3: Add the origin filter for the frame page**

In `apps/jscad-web/build.js`, after the `htmlFilter` block (`const htmlFilter = {...}` lines 41–44), add:

```js
// Frame page: bake the web origin as both app and run origin. The frame is
// served same-host at /frame/ under sandbox (opaque origin), so CSP must
// name the origin explicitly — 'self' matches nothing inside the frame.
const frameOrigin = process.env.FRAME_APP_ORIGIN || 'https://jscad.rkroll.com'
const frameHtmlFilter = {
  filter: (content) => content
    .replaceAll('__RUN_ORIGIN__', frameOrigin)
    .replaceAll('__APP_ORIGIN__', frameOrigin),
  include: ['frame/index.html'],
}
```

and extend the static copy call:

```js
copyTask('static', outDir, { include: [], exclude: [], watch, filters: [htmlFilter] })
```

to:

```js
copyTask('static', outDir, { include: [], exclude: [], watch, filters: [htmlFilter, frameHtmlFilter] })
```

(`copyTask` matches filters on the copy-relative path, so `frame/index.html` matches exactly; the about-filter's `index.html` pattern does not touch it. Subdirectories copy recursively when `include` is empty — verified in `@jbroll/jsx6-build/src/copyTask.js`.)

- [ ] **Step 4: Add the frame bundle step to build.js**

Append after the main.js build (`await buildOne('.', outDir, 'main.js', ...)` line 219) and before the `hashAssets(outDir)` call:

```js
/******************************* COMPUTE FRAME (/frame) ***********************/
// Self-contained sandboxed execution page. Bundle set mirrors the app's
// src_bundle sources (canonical, shared) except the worker, which is the
// frame-specific entry (blob __BUNDLE_BASE__ + project file map).
const frameDir = outDir + '/frame'
const frameBuildDir = frameDir + '/build'
if (existsSync(frameBuildDir)) rmSync(frameBuildDir, { recursive: true, force: true })
mkdirSync(frameBuildDir, { recursive: true })
const frameCjs = { '.js': 'js', '.jsx': 'jsx' }
await buildBundle(frameBuildDir, 'bundle.jscad_modeling.js', { format: 'cjs', watch: dev, loader: frameCjs })
await buildOne('src_bundle', frameBuildDir, 'bundle.manifold_modeling.js', watch, {
  format: 'cjs',
  loader: frameCjs,
  external: ['module', '@jscad/modeling-for-manifold'],
})
copyFileSync('../../node_modules/manifold-3d/manifold.wasm', frameBuildDir + '/manifold.wasm')
await buildBundle(frameBuildDir, 'bundle.jscad_io.js', { format: 'cjs', watch: dev, loader: frameCjs })
await buildBundle(frameBuildDir, 'bundle.model-tools.js', {
  format: 'cjs',
  watch: dev,
  loader: frameCjs,
  external: ['@jscad/modeling'],
})
await buildBundle(frameBuildDir, 'bundle.jscad-fluent.js', {
  format: 'cjs',
  watch: dev,
  loader: frameCjs,
  external: ['@jscad/modeling', '@jscad/modeling-for-anchors', '@jbroll/jscad-anchors'],
})
await buildBundle(frameBuildDir, 'bundle.params_core.js', { format: 'cjs', watch: dev, loader: frameCjs })
await buildBundle(frameBuildDir, 'bundle.jscadui.transform-babel.js', { globalName: 'jscadui_transform_babel', watch: dev })
await buildBundle(frameBuildDir, 'bundle.openscad.js', {
  globalName: 'jscadui_openscad',
  watch: dev,
  plugins: [nodeBuiltinStubPlugin],
})
await buildBundle(frameBuildDir, 'bundle.jscad_text.js', {
  format: 'cjs',
  watch: dev,
  loader: frameCjs,
  plugins: [nodeBuiltinStubPlugin],
})
// Frame worker: readFileWeb (origin-based) cannot work in the blob worker,
// so substitute the map-aware loader — same shim pattern as the run app.
await buildOne('src_frame', frameBuildDir, 'bundle.frame-worker.js', watch, {
  format: 'iife',
  plugins: [{
    name: 'read-file-shim',
    setup(build) {
      build.onResolve({ filter: /readFileWeb\.js$/ }, (args) => {
        if (args.path.endsWith('readFileWeb.js') && args.importer.endsWith('packages/require/index.js')) {
          return { path: fileURLToPath(new URL('./src_frame/readFileFrame.js', import.meta.url)) }
        }
      })
    },
  }],
})
await buildOne('src_frame', frameDir, 'frame.js', watch, {
  format: 'esm',
  define: { __ALLOWED_ORIGIN__: JSON.stringify(frameOrigin) },
})
```

Add `fileURLToPath` to the `url` import if absent, and import the frame hasher:

```js
import { hashFrameAssets } from './src_build/hashFrameAssets.js'
```

then after `if (!dev) hashAssets(outDir)` add:

```js
if (!dev) hashFrameAssets(frameDir)
```

`hashFrameAssets` is the moved run hasher: same topological order (leaves → worker → frame.js → index.html rewrite), parameterized by directory. Verify its `hashFile`/`hashAssets` export names match this call when porting; rename inside the moved file only.

- [ ] **Step 5: Serve /frame/ correctly in serve.js**

In `apps/jscad-web/serve.js`: add `'.wasm': 'application/wasm'` to `mimeTypes` (manifold.wasm otherwise serves as octet-stream and `instantiateStreaming` fails). Add a frame branch before the generic static fallback in `handleRequest`:

```js
} else if (pathname === '/frame' || pathname.startsWith('/frame/')) {
  // Compute frame: no SPA fallback (an index.html fallback would break the
  // blob worker's bundle XHRs), CORS on (the sandboxed frame fetches
  // cross-origin from its opaque origin), frame locked to this app.
  return handleFrame(pathname)
}
```

with (adapted from the run app's serve.js, directory rebased to `build/frame`):

```js
const frameHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=()',
  'Content-Security-Policy': 'frame-ancestors \'self\'',
}

const handleFrame = async (pathname) => {
  const buildDir = path.resolve(process.cwd(), 'build/frame')
  const rel = pathname === '/frame' ? 'index.html' : pathname.replace(/^\/frame\/+/, '')
  const filePath = path.resolve(buildDir, rel)
  if (!filePath.startsWith(buildDir + path.sep) && filePath !== buildDir) {
    return { status: 403, content: 'forbidden' }
  }
  const stats = await fs.stat(filePath).catch(() => undefined)
  if (!stats || !stats.isFile()) {
    return { status: 404, content: 'not found' }
  }
  const extname = path.extname(filePath)
  const contentType = mimeTypes[extname] || 'application/octet-stream'
  const content = await fs.readFile(filePath)
  return { status: 200, content, contentType, headers: frameHeaders }
}
```

and merge `result.headers` into the response in the server callback (extend the `outHeaders` construction: `const outHeaders = { ...headers, ...(result.headers ?? {}) }` — adapt to the file's actual shape; `frame-ancestors 'self'` is meaningful here because it constrains the embedder, and the embedder is same-origin).

- [ ] **Step 6: Verify the built frame**

```bash
npm run build --workspace=@jscadui/jscad-web 2>&1 | tail -2
ls apps/jscad-web/build/frame/index.html apps/jscad-web/build/frame/frame*.js apps/jscad-web/build/frame/build/bundle.frame-worker*.js apps/jscad-web/build/frame/build/manifold.wasm
grep -o "https\?://[^\"' ]*" apps/jscad-web/build/frame/index.html | head -n 5
```

Expected: build prints `hashed 16 assets`; all four paths exist (hashed names allowed — glob accordingly); baked origins read back (default `https://jscad.rkroll.com`, or `$FRAME_APP_ORIGIN` when set).

- [ ] **Step 7: Commit**

```bash
git add apps/jscad-web/src_frame apps/jscad-web/static/frame apps/jscad-web/test/frame-filemap.test.js apps/jscad-web/src_build/hashFrameAssets.js apps/jscad-web/build.js apps/jscad-web/serve.js
git commit -m "feat(jscad-web): co-deploy compute frame at /frame/"
```

---

### Task 6: Route the agent path through the frame

**Files:**
- Move: `apps/jscad-studio/src/frameClient.js` → `apps/jscad-web/src/frameClient.js` (no content change — it already posts to `'*'` with a `contentWindow` source check, and its src-vs-origin assertion passes for a same-host iframe with `origin = location.origin`)
- Modify: `apps/jscad-web/main.js` (hidden iframe + frame-backed agent deps)
- Create: `apps/jscad-web/e2e/frame-host.html`, `apps/jscad-web/e2e/frame-wrong.html`, `apps/jscad-web/e2e/frame-serve.mjs`, `apps/jscad-web/e2e/frame.spec.js` (ported from the run app, rebased to the dev server)
- Modify: `ci/render` (run the frame spec where chromium + the dev server already exist)

**Interfaces:**
- Consumes: Task 5 (`/frame/` served with headers; `frameClient` origin = `location.origin`).
- Produces: `aiDeps.evaluate/measure/check/export` executed inside the sandbox; editor `setParams/save/view` and the worker untouched. `handleEntities` + caps path unchanged (frame results flow through the same function).

- [ ] **Step 1: Move the client**

```bash
git mv apps/jscad-studio/src/frameClient.js apps/jscad-web/src/frameClient.js
```

- [ ] **Step 2: Create the hidden frame and rewire the agent deps**

In `apps/jscad-web/main.js`, near the worker setup (`createWorker` call, ~line 160), add:

```js
import { frameClient } from './src/frameClient.js'
```

(with the other `./src/` imports) and after the worker creation:

```js
// Sandboxed execution for agent-driven code. sandbox without
// allow-same-origin gives the frame an opaque origin: model scripts run with
// no ambient authority (no cookies, storage, or same-origin fetch), while the
// editor keeps the local worker. See Task 6 of docs/superpowers/plans/2026-09-20-studio-fold.md.
const frameEl = document.createElement('iframe')
frameEl.src = './frame/'
frameEl.setAttribute('sandbox', 'allow-scripts')
frameEl.hidden = true
document.body.appendChild(frameEl)
const frame = frameClient(frameEl, location.origin)
```

Replace the `aiDeps` entries (`main.js:713-731`):

```js
  evaluate: async (source, entry = './jscad.model.js') => {
    await jscadScript({ script: source, url: entry, base: currentBase })
    const result = await workerApi.jscadMain(paramsCtrl.getWorkerParams())
    handleEntities(result, {})
    const entities = result.entities instanceof Array ? result.entities : [result.entities]
    return { entityCount: entities.length }
  },
```

with:

```js
  evaluate: async (source, entry = './jscad.model.js') => {
    const loaded = await frame.load({ files: { [entry]: source }, entry })
    if (!loaded.ok) return loaded
    handleEntities(loaded.result, {})
    const entities = loaded.result.entities instanceof Array ? loaded.result.entities : [loaded.result.entities]
    return { entityCount: entities.length }
  },
```

`measure: async (options) => workerApi.jscadMeasure({ options })` with:

```js
  measure: async (options) => (await frame.measure({ options })).result,
```

`check: async (input) => workerApi.jscadCheck({ bed: input?.bed, options: input ?? {} })` with:

```js
  check: async (input) => (await frame.check({ bed: input?.bed, options: input ?? {} })).result,
```

and the `exportModel` body `workerApi.jscadExportData({ format })` with `frame.export({ format })`:

```js
  exportModel: async ({ format }) => {
    const { data } = (await frame.export({ format })).result || {}
    const chunks = (data instanceof Array ? data : [data]).filter((v) => v instanceof ArrayBuffer)
    const size = chunks.reduce((n, v) => n + v.byteLength, 0)
    return { format, size, data: toBase64(chunks) }
  },
```

`setParams`, `view`, and `save` stay exactly as they are (worker/editor-backed). Failures stay results, never throws: `frameClient` resolves `{ ok: false, error }` and `handleToolRequest` catches the rest.

- [ ] **Step 3: Port the frame protocol e2e**

Move and rebase the run app's harness (frame served by the real dev server on 5120; host + attacker micro-servers stay on 5122/5123):

```bash
git mv apps/jscad-studio-run/e2e/host.html apps/jscad-web/e2e/frame-host.html
git mv apps/jscad-studio-run/e2e/wrong.html apps/jscad-web/e2e/frame-wrong.html
git mv apps/jscad-studio-run/e2e/frame.spec.js apps/jscad-web/e2e/frame.spec.js
```

In `frame-host.html`, point the iframe at the folded frame: replace `src="http://localhost:5121/"` with `src="http://localhost:5120/frame/"` (keep `sandbox="allow-scripts"` and the attacker iframe as-is). In `frame.spec.js`, replace `const RUN = 'http://localhost:5121'` with `const RUN = 'http://localhost:5120/frame'` and `http://localhost:5121/` marker base accordingly; HOST stays `http://localhost:5122/host.html` served by the ported helper below.

Create `apps/jscad-web/e2e/frame-serve.mjs`: copy of the run `e2e/serve.mjs` with the frame server deleted (the dev server owns `/frame/`) — keep the host server (serving `frame-host.html` at `/host.html` + `/api/private` exfil probe), the attacker server (`frame-wrong.html`), and the `__mark`/`__mark-count`/`__mark-reset` endpoints; `COMMON_HEADERS` keeps CORS + Permissions-Policy, and its CSP `frame-ancestors` still names the app origin under test. Wire start/stop so the spec file imports it in `beforeAll`/`afterAll` instead of requiring a separate process.

Add one engine-correctness case to `frame.spec.js` (frame result must equal analytic truth, independent of the worker):

```js
test('measure matches analytic volume for a 10mm cube', async ({ page }) => {
  await page.goto(HOST)
  const loadRes = await page.evaluate(({ id, command, payload }) => window.send(id, command, payload), {
    id: 9,
    command: 'load',
    payload: project(
      `const { cube } = require('@jscad/modeling').primitives\n` +
      `const main = () => cube({ size: 10 })\n` +
      `module.exports = { main }\n`,
    ),
  })
  expect(loadRes.ok).toBe(true)
  const measureRes = await page.evaluate(({ id, command, payload }) => window.send(id, command, payload), {
    id: 10,
    command: 'measure',
    payload: {},
  })
  expect(measureRes.ok).toBe(true)
  expect(measureRes.result.volume).toBeGreaterThan(990)
  expect(measureRes.result.volume).toBeLessThan(1010)
})
```

(`project` helper already exists in the spec.)

- [ ] **Step 4: Run the gates**

```bash
npm run test --workspace=@jscadui/jscad-web 2>&1 | tail -4
npm run build --workspace=@jscadui/jscad-web 2>&1 | tail -2
npx playwright test e2e/frame.spec.js 2>&1 | tail -6
```

Run the Playwright line from `apps/jscad-web/` with the dev server up (`node build.js --dev --skipDocs` in the background, as `ci/render` does). Expected: unit suite green (aiBridge tests inject deps, unaffected); build green; frame spec green including the wrong-origin rejection and the volume case. The pre-existing `ai-chat.spec.js` (stub relay) now exercises the frame end-to-end — run it too and require green.

- [ ] **Step 5: Extend ci/render with the frame spec**

In `ci/render`, after the render sweep block, add:

```bash
# ── frame protocol e2e (dev server + chromium already up) ──
echo "Running: npx playwright test e2e/frame.spec.js"
( cd "$APP" && npx playwright test e2e/frame.spec.js )
```

The `trap cleanup EXIT` still tears down the dev server. Verify with `bash -n ci/render`.

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-web/src/frameClient.js apps/jscad-web/main.js apps/jscad-web/e2e/frame-host.html apps/jscad-web/e2e/frame-wrong.html apps/jscad-web/e2e/frame-serve.mjs apps/jscad-web/e2e/frame.spec.js ci/render
git commit -m "feat(jscad-web): route agent execution through sandboxed frame"
```

---

### Task 7: Delete both studio dirs and rewire the repo

**Files:**
- Delete: everything left under `apps/jscad-studio/` (client, static, e2e, tests, configs, tenants, `shared/`, `src_build/`, `src_bundle/`); everything left under `apps/jscad-studio-run/` (frame sources now live in web `src_frame/` + `static/frame/`; identical bundle sources were already canonical in web `src_bundle/`); delete `ci/studio` and `ci/studio-run`
- Modify: `tsconfig.json`, `apps/jscad-web/README.md`, `apps/jscad-web/deploy.conf`, `apps/jscad-web/deploy/hooks/apache.configure.post.sh` (new, Step 2b), `docs/backlog.md`

**Interfaces:**
- Consumes: Tasks 1–6 (server, caps, folder, git, frame, agent path all relocated).
- Produces: zero tracked files under either studio dir; repo references point at the folded locations.

`shared/schema.ts` is deleted here, deliberately: its only importers were studio `src/storage/cloud.js` and `test/storage-cloud.test.js` (both superseded, not ported). Web's live schema is `src/storage/schema.js` (parity-tested + manifest); omitting the `Settings` table was a documented decision of the rowboat-storage plan (settings stay in `localStorage`/`key-store`).

- [ ] **Step 1: Remove the directories and the studio CI jobs**

```bash
rm -rf apps/jscad-studio apps/jscad-studio-run && git add -A && git rm ci/studio ci/studio-run
git status --short | grep -v "^ D apps/jscad-studio" | grep -v "^ D apps/jscad-studio-run" | grep -v "^D ci/studio" || echo "only expected deletions"
```

Expected: every status line is a deletion under the two app dirs or the two ci scripts (the Tasks 1–6 moves already committed — those show nothing now). `node_modules` under the old dirs is gitignored and vanishes with `rm -rf`.

- [ ] **Step 2: Drop the studio paths from the root typecheck**

In `tsconfig.json`, replace:

```json
    // The studio's storage pulls in @jbroll/rowboat-schema -> zod 4 types,
    // which need TS 5; the root gate runs TS 4.9. The studio app is JS
    // (esbuild) and its server typechecks with its own TS 5.7 toolchain.
    "apps/jscad-studio/src/storage",
    "apps/jscad-studio/shared",
    // Same for jscad-web's storage: vanilla JS bundled by esbuild, tested by
```

with:

```json
    // Same for jscad-web's storage: vanilla JS bundled by esbuild, tested by
```

The web storage exclusion below it stays. The moved server keeps its own TS 5.7 toolchain (`apps/jscad-web/server/tsconfig.json`).

- [ ] **Step 2b: Add the /frame/ header hook for production**

The stock apache security block emits `X-Frame-Options: SAMEORIGIN` (fine — the embedder is same-origin) but no per-path headers, and the blob worker's bundle XHRs need CORS on `/frame/build/*`. Deploy.sh hook format is `{module}.{stage}.{timing}.sh` under `deploy/hooks/`. Create `apps/jscad-web/deploy/hooks/apache.configure.post.sh`, modeled on the retired run hook's idempotent marker-block technique, writing this block scoped to the frame path:

```
    # jscad-web frame headers (managed by deploy hook; do not edit)
    <Location /frame/>
        Header always set Access-Control-Allow-Origin "*"
        Header always set Content-Security-Policy "frame-ancestors 'self'"
        Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), usb=(), serial=()"
    </Location>
    # end jscad-web frame headers
```

No other apache change is needed (verified against `deploy.sh/modules/apache/build.sh`): existing files and directories pass through the SPA fallback untouched, so `/frame/` + `/frame/build/*` serve as files; unknown sub-paths fall back to root `index.html`, which the frame never requests. Mirror the run hook's replace-not-duplicate behavior (marker-bounded regex replace, abort unless exactly one insertion point).

- [ ] **Step 3: Reword the web README API reference**

In `apps/jscad-web/README.md`, replace:

```md
  short-lived JWT from the studio API's `GET /api/sync-token` (15m expiry).
```

with:

```md
  short-lived JWT from the app API's `GET /api/sync-token` (15m expiry, served by `server/` in this dir).
```

- [ ] **Step 4: Update the web deploy header**

In `apps/jscad-web/deploy.conf`, replace:

```bash
# JSCAD Web Deployment Configuration (with integrated AI chat)
# Deploy hybrid SPA + API proxy to jscad.rkroll.com. Replaces the standalone
# studio copy previously served on this domain (its vhost is removed after
# this deploy lands).
```

with:

```bash
# JSCAD Web Deployment Configuration (with integrated AI chat + API)
# Deploy hybrid SPA + API proxy to jscad.rkroll.com. The API is server/ in
# this dir (relocated from the retired jscad-studio app); the proxy below
# targets it.
```

and replace:

```bash
# Apache module configuration (hybrid: static app + /api proxy to the studio API)
```

with:

```bash
# Apache module configuration (hybrid: static app + /api proxy to server/ below)
```

- [ ] **Step 5: Correct the backlog Deploy section**

In `docs/backlog.md`, replace:

```md
jscad.rkroll.com runs `dev` with the AI chat folded in (2026-09-17): the
frontend is jscad-web hybrid plus the studio API on :3006, the compute frame
on jscad-run.rkroll.com.
```

with:

```md
jscad.rkroll.com runs `dev` with the AI chat folded in (2026-09-17): the
frontend is jscad-web hybrid plus the app API (`apps/jscad-web/server`) on
:3006, with the compute frame served from the same deploy at `/frame/`.
jscad-studio and jscad-studio-run were folded into jscad-web and removed
(2026-09-20); the `run.*` vhosts retire with the next deploy (operator step).
```

- [ ] **Step 6: Verify the gates**

```bash
npm run typecheck 2>&1 | tail -3
npx eslint tsconfig.json apps/jscad-web/README.md 2>&1 | tail -3; echo "eslint exit: $?"
grep -rn "apps/jscad-studio" --include="*.js" --include="*.ts" --include="*.mjs" --include="*.json" --include="*.sh" --include="*.conf" . 2>/dev/null | grep -v node_modules | grep -v package-lock | grep -v "/dist/" | grep -v "/build" | grep -v docs/superpowers | grep -v .superpowers
```

Expected: typecheck passes; remaining `apps/jscad-studio` hits are historical docs only (`docs/design/*`, old plans) — each must be eyeballed, none may be live code, CI, or deploy config. (`apps/jscad-studio-run` matches the same grep via the shared prefix — same rule applies.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat!: remove jscad-studio and jscad-studio-run, folded into jscad-web"
```

(The `!` marks the breaking change: `ci/studio`, `ci/studio-run`, the studio frontend, the frame host, and the `run.*` vhosts' source of truth are gone.)

---

### Task 8: Successor full-deploy script beside the moved server

**Files:**
- Create: `apps/jscad-web/deploy-full.sh` (adapted from the deleted `apps/jscad-studio/deploy-full.sh`)
- Delete: nothing (source is gone with Task 7; the content below carries it over)

**Interfaces:**
- Consumes: Task 1 (server at `apps/jscad-web/server/` with its `deploy.conf`), Task 7 (both studio dirs gone, `/frame/` header hook in place).
- Produces: one 3-step deploy (frontend + API + smoke) for the folded app. No run-host step: the frame ships inside the frontend build.

The old script's `test` env pointed at `jscad-studio-test` domains whose DNS never existed; the successor deploys prod only until a web test domain is provisioned. Retiring the `run.*` vhosts/DNS is an operator step at deploy time, not repo code — it is called out in the script header and the backlog, nothing more. Step 3's `cd ../jscad-studio-run` resolves from the web dir; step 4 uses web's own `e2e/smoke-deploy.mjs`.

- [ ] **Step 1: Write the script**

Create `apps/jscad-web/deploy-full.sh`:

```bash
#!/bin/bash
# Deploy the full app: frontend (with integral /frame/), then API, then
# health and smoke. Successor of the retired jscad-studio/deploy-full.sh.
# The compute frame needs no step of its own: it builds and ships inside the
# frontend (build/frame/). Retire the run.* vhosts/DNS as an operator step
# once this deploy is verified.
#
# Usage: ./deploy-full.sh [update|init]
#
# Environment (prod only):
#   - jscad.rkroll.com      -> frontend + /frame/ + API
#
# A test domain is not provisioned yet; do not re-add the old
# jscad-studio-test hostnames (their DNS never existed).

set -e

MODE="${1:-update}"

DEPLOY_SH="../../../deploy.sh/deploy.sh"

export APP_PORT="${APP_PORT:-3006}"
export DOMAIN_NAME="jscad.rkroll.com"
export REMOTE_HOST="jscad.rkroll.com"
export APP_URL="https://jscad.rkroll.com"

echo "=== jscad-web Full Deployment ==="
echo "App: $APP_URL"
echo "Mode: $MODE"
echo ""

echo "[1/3] Deploying Frontend..."
"$DEPLOY_SH" "$MODE" .
echo "✓ Frontend deployed ($APP_URL)"
echo ""

echo "[2/3] Deploying API..."
cd server
"../../../../deploy.sh/deploy.sh" "$MODE" .
cd ..
echo "✓ API deployed"
echo ""

echo "[3/3] Health check + smoke test..."
sleep 3
if curl -sf "$APP_URL/api/health" > /dev/null; then
    echo "✓ Backend health check passed"
else
    echo "✗ Backend health check FAILED"
    exit 1
fi
curl -sf "$APP_URL/frame/" > /dev/null && echo "✓ Frame page served" || { echo "✗ Frame page FAILED"; exit 1; }

APP_URL="$APP_URL" node e2e/smoke-deploy.mjs
echo ""
echo "=== Deployment Complete ==="
echo "App: $APP_URL"
```

Then:

```bash
chmod +x apps/jscad-web/deploy-full.sh && bash -n apps/jscad-web/deploy-full.sh && echo SYNTAX-OK
```

Expected: `SYNTAX-OK`. The script is not executed here (it deploys to production); the smoke path is covered by web e2e in CI.

- [ ] **Step 2: Commit**

```bash
git add apps/jscad-web/deploy-full.sh && git commit -m "feat(jscad-web): full-deploy script for frontend+API"
```

---

### Task 9: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run every gate**

```bash
npm run build --workspace=@jscadui/jscad-web 2>&1 | tail -2
npm run test --workspace=@jscadui/jscad-web 2>&1 | tail -4
cd apps/jscad-web/server && npx vitest run 2>&1 | tail -3; cd ../../..
npm run lint 2>&1 | tail -3
```

Expected: web build prints `hashed 16 assets` and `build/frame/` holds `index.html`, hashed `frame*.js`, `build/bundle.frame-worker*.js`, and `manifold.wasm`; web suite all pass (including `caps`, `storage-folder`, `storage-git`, `frame-filemap`); server suite `Test Files 8 passed`; lint clean (warnings-only pre-existing state unchanged — compare against `main` if unsure).

- [ ] **Step 2: Review the branch**

```bash
git log --oneline -10 && git status --short
```

Expected: 9 commits (Tasks 1–8 plus the earlier `ci/render` assertion); status clean except the two known untracked files (`.superpowers/`, the stale eval plan) that predate this work.

- [ ] **Step 3: Confirm the render baseline is untouched**

```bash
git diff --stat main -- apps/jscad-web/e2e/render-baseline.json; git status --short apps/jscad-web/build | head -3
```

Expected: no diff on the baseline; `build/` is gitignored (no stray build outputs staged).

## Order and checkpoints

- Tasks 1–6 are order-independent of each other (disjoint file sets) but all must land before Task 7 deletes the source dirs.
- After Task 1, the API has a new home and its suite runs green there — safe moment to sanity-check `server/src/index.ts` mounts before continuing.
- After Task 5, `build/frame/` exists with baked same-host origins — safe moment to load `/frame/` in a browser and watch the console before wiring the agent path.
- After Task 7, `grep apps/jscad-studio` outside historical docs must be empty — that is the fold's done-criteria alongside the Task 9 gates.
- Browser e2e (`app.spec.js`, `ai-chat.spec.js`, `frame.spec.js`) and the render sweep are CI/GPU-only; they are not re-run locally, but Task 6 changes only the agent execution path they cover through the same `handleEntities` signature.
- Explicit follow-up (not this plan): migrate the editor path onto the frame so all model execution is sandboxed (single engine). Preconditions: agent path proven in production + frame/worker parity held for a full render sweep. No code is trusted by source — that migration, not this one, completes the threat model.
