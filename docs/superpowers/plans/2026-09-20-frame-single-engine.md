# Frame single engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every model jscad-web executes runs in the sandboxed compute frame on its own origin, and the app-origin worker is deleted.

**Architecture:** the frame moves back to `https://jscad-run.rkroll.com` and becomes a transparent relay for the existing `@jscadui/postmessage` worker protocol, so the app keeps calling `workerApi.jscadScript`/`jscadMain` exactly as it does today. Project files travel to the frame as a `{path: content}` map, because a service worker cannot serve another origin's worker. The local worker is deleted only after a full render sweep through the frame matches the recorded baseline.

**Tech Stack:** Node 22, ES modules, esbuild, vitest, Playwright (bundled chromium), Apache + deploy.sh.

**Spec:** `docs/superpowers/specs/2026-09-20-frame-single-engine-design.md`

## Global Constraints

- jscadui style: ES modules, single quotes, no semicolons. Comments only where they say why, one or two lines.
- The frame iframe always carries `sandbox="allow-scripts"` with no `allow-same-origin`. Never add it, never drop the attribute.
- App origin `https://jscad.rkroll.com` (dev `http://localhost:5120`); run origin `https://jscad-run.rkroll.com` (dev `http://localhost:5121`). Env overrides: `FRAME_APP_ORIGIN`, `FRAME_RUN_ORIGIN`.
- No model code ever executes on the app origin or on the server.
- One commit per task. Every task ends green before the next starts.
- Unit tests run under plain vitest with no browser and no keys: `npx vitest run` in `apps/jscad-web`.
- Browser tests: `npx playwright test e2e/<spec>` in `apps/jscad-web`, bundled chromium.
- Never start `run-jscad.js` locally without `--timeout`.

---

### Task 1: Serve the frame from its own origin

**Files:**
- Modify: `apps/jscad-web/build.js:51-59` (origin vars, frame html filter), `apps/jscad-web/build.js:292-299` (frame bundle define), `apps/jscad-web/build.js:300-316` (dev server block)
- Modify: `apps/jscad-web/serve.js:36-41`, `:84-107` (split the frame server out)
- Modify: `apps/jscad-web/main.js:182-190` (iframe src)
- Modify: `apps/jscad-web/e2e/frame.spec.js:10-11` (RUN constant), `apps/jscad-web/playwright.config.js`
- Test: `apps/jscad-web/e2e/frame.spec.js` (existing suite, retargeted)

**Model:** `sonnet` — multi-file build/serve coordination, no new algorithms.

**Interfaces:**
- Produces: `serveFrame(port)` exported from `serve.js`, serving `build/frame` at the server root with the frame headers; `__FRAME_ORIGIN__` defined at build time in the app bundle and read by `main.js`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Split the origin variables in `build.js`**

Replace the `frameOrigin` block at `build.js:51-59` with:

```js
// The frame is a second origin. Its page bakes both: __APP_ORIGIN__ is the only
// sender it answers, __RUN_ORIGIN__ is its own name in the CSP ('self' matches
// nothing inside a sandboxed frame).
const appOrigin = process.env.FRAME_APP_ORIGIN || (dev ? `http://localhost:${port}` : 'https://jscad.rkroll.com')
const runOrigin = process.env.FRAME_RUN_ORIGIN || (dev ? `http://localhost:${port + 1}` : 'https://jscad-run.rkroll.com')
const frameHtmlFilter = {
  filter: (content) => content
    .replaceAll('__RUN_ORIGIN__', runOrigin)
    .replaceAll('__APP_ORIGIN__', appOrigin),
  include: ['frame/index.html'],
}
```

- [ ] **Step 2: Point the frame bundle and the app bundle at those values**

At `build.js:292-299`, the `src_frame/frame.js` build already defines `__ALLOWED_ORIGIN__`; change its value to `JSON.stringify(appOrigin)`. Find the `buildOne` call that builds `main.js` into `outDir` and add to its options:

```js
define: { __FRAME_ORIGIN__: JSON.stringify(runOrigin) },
```

- [ ] **Step 3: Give `serve.js` a frame-only server**

In `serve.js`, delete the `/frame` branch at `:36-41` and the `pathname.replace(/^\/frame\/+/, '')` handling inside `handleFrame`, then export a server that roots the frame build:

```js
export const serveFrame = (port) => {
  const server = http.createServer(async (req, res) => {
    const pathname = url.parse(req.url, true).pathname
    const rel = pathname.endsWith('/') ? `${pathname}index.html` : pathname
    const { status, content, contentType, headers } = await handleFrame(rel)
    res.writeHead(status, { ...headers, ...(contentType ? { 'Content-Type': contentType } : {}) })
    res.end(content)
  })
  server.listen(port)
  console.log(`compute frame on http://localhost:${port}`)
  return server
}
```

and make `handleFrame` resolve `rel` directly against `build/frame`, keeping its path-traversal guard and `frameHeaders`.

- [ ] **Step 4: Start the frame server in dev and in `npm run serve`**

In `build.js`, remove the `/frame` middleware from the `liveServer.start` call and start the frame server beside it:

```js
import { serve, serveFrame } from './serve.js'
...
if (dev) {
  serveFrame(port + 1)
  liveServer.start({ root: outDir, port, open: false, ignore: outDir + '/docs' })
} else if (serveBuild) {
  serveFrame(port + 1)
  serve(port)
}
```

- [ ] **Step 5: Point the iframe at the run origin**

In `main.js:185-190`, replace `frameEl.src = './frame/'` with `frameEl.src = __FRAME_ORIGIN__ + '/'`, and pass that same value to `frameClient(frameEl, __FRAME_ORIGIN__)`. Add `/* global __FRAME_ORIGIN__ */` at the top of `main.js` if the linter needs it.

- [ ] **Step 6: Retarget the frame e2e**

In `e2e/frame.spec.js`, set `const RUN = 'http://localhost:5121'`. Rename the test `model fetch inside /frame/ is allowed` to `model fetch against the run origin is allowed` and have it fetch `${RUN}/index.html`. Leave `model fetch against the app origin outside /frame/ fails` as is, now fetching `http://localhost:5120/api/private`. In `playwright.config.js`, make sure the dev `webServer` command still starts the build (it starts the frame server too, from Step 4).

- [ ] **Step 7: Run the frame e2e**

Run: `cd apps/jscad-web && npx playwright test e2e/frame.spec.js`
Expected: 15 passed.

- [ ] **Step 8: Commit**

```bash
git add apps/jscad-web/build.js apps/jscad-web/serve.js apps/jscad-web/main.js apps/jscad-web/e2e/frame.spec.js apps/jscad-web/playwright.config.js
git commit -m "feat(jscad-web): serve the compute frame from its own origin"
```

---

### Task 2: Deploy configuration for the run host

**Files:**
- Create: `apps/jscad-web/deploy-run.conf`
- Modify: `apps/jscad-web/deploy-full.sh`
- Delete: `apps/jscad-web/deploy/hooks/apache.configure.post.sh`
- Create: `apps/jscad-web/deploy/run-hooks/apache.configure.post.sh`

**Model:** `sonnet` — deploy config by pattern, with a destructive delete to get right.

**Interfaces:**
- Consumes: Task 1's `build/frame` output, unchanged.
- Produces: a deployable run host; nothing later depends on its internals.

- [ ] **Step 1: Write `deploy-run.conf`**

Model it on the recovered original (`git show d2dd397^:apps/jscad-studio-run/deploy.conf`) and on `apps/jscad-web/deploy.conf`:

```bash
# Compute frame host. Serves apps/jscad-web/build/frame as a static site.
# No API, no SPA fallback: an index.html fallback would break the blob
# worker's bundle XHRs.
export DEPLOY_TYPES="letsencrypt apache"
export APP_NAME="jscad-run"
export DOMAIN_NAME="${DOMAIN_NAME:-jscad-run.rkroll.com}"
export REMOTE_HOST="${REMOTE_HOST:-jscad-run.rkroll.com}"
export REMOTE_USER="john"
export LETSENCRYPT_EMAIL="john@rkroll.com"
export APACHE_MODE="static"
export APACHE_CONTENT_DIR="build/frame"
export APACHE_BUILD_CMD="npm --prefix ../.. install --no-audit --no-fund && npm run build"
export APACHE_BUILD_ENABLED="yes"
export APACHE_WEB_ROOT="/var/www/${APP_NAME}"
export APACHE_SPA_MODE="no"
export APACHE_CACHE_STATIC="yes"
export APACHE_SECURITY_HEADERS="no"
```

- [ ] **Step 2: Move the header hook to the run host**

`git mv apps/jscad-web/deploy/hooks/apache.configure.post.sh apps/jscad-web/deploy/run-hooks/apache.configure.post.sh`, then edit it: the `<Location /frame/>` wrapper goes away (the whole vhost is the frame now), so the block becomes the three `Header always set` lines at vhost level, with `Content-Security-Policy "frame-ancestors https://jscad.rkroll.com"` instead of `'self'`. Keep the marker comments and the idempotent installer exactly as they are.

- [ ] **Step 3: Deploy the run host first in `deploy-full.sh`**

In `deploy-full.sh`, add a stage before the frontend deploy that runs the same `deploy.sh update` invocation against `deploy-run.conf`, and a check that `https://jscad-run.rkroll.com/` returns 200 before the app deploy proceeds. The app with no frame has no engine, so the run host must be up first.

- [ ] **Step 4: Verify the config parses**

Run: `bash -n apps/jscad-web/deploy-run.conf && bash -n apps/jscad-web/deploy-full.sh && bash -n apps/jscad-web/deploy/run-hooks/apache.configure.post.sh`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A apps/jscad-web/deploy-run.conf apps/jscad-web/deploy-full.sh apps/jscad-web/deploy
git commit -m "feat(jscad-web): deploy config for the jscad-run compute host"
```

---

### Task 3: The frame relays the worker protocol

**Files:**
- Create: `apps/jscad-web/src/framePort.js`
- Create: `apps/jscad-web/test/frame-port.test.js`
- Modify: `apps/jscad-web/src_frame/frame.js` (replace the command table with the relay)
- Modify: `apps/jscad-web/main.js` (agent tools onto `workerApi`), `apps/jscad-web/src/aiEvaluate.js`
- Delete: `apps/jscad-web/src/frameClient.js`
- Test: `apps/jscad-web/test/frame-port.test.js`, `apps/jscad-web/e2e/frame.spec.js`

**Model:** `opus` — transfer-list and liveness semantics across two hops, plus a protocol swap the whole app rides on.

**Interfaces:**
- Produces: `framePort(iframe, runOrigin)` returning `{ postMessage(message, transfer), addEventListener(type, fn), removeEventListener(type, fn) }`, accepted by `messageProxy` in place of a `Worker`.
- Produces: the frame answers the full worker protocol, so `workerApi.jscadInit`, `jscadScript`, `jscadSetFiles`, `jscadMain`, `jscadMeasure`, `jscadCheck`, `jscadExportData`, `jscadClearTempCache`, `jscadClearFileCache` all work through it.
- Consumes: Task 1's `__FRAME_ORIGIN__`.

- [ ] **Step 1: Write the failing port test**

`apps/jscad-web/test/frame-port.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { framePort } from '../src/framePort.js'

const fakeIframe = () => {
  const contentWindow = { postMessage: vi.fn() }
  return { contentWindow, src: 'https://jscad-run.rkroll.com/' }
}

describe('framePort', () => {
  it('posts to the frame window with the run origin and the transfer list', () => {
    const iframe = fakeIframe()
    const listeners = []
    const port = framePort(iframe, 'https://jscad-run.rkroll.com', {
      addEventListener: (type, fn) => listeners.push([type, fn]),
      removeEventListener: () => {},
    })
    const buffer = new ArrayBuffer(8)
    port.postMessage({ method: 'jscadMain', id: 1, params: [] }, [buffer])
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledWith(
      { method: 'jscadMain', id: 1, params: [] },
      'https://jscad-run.rkroll.com',
      [buffer],
    )
  })

  it('delivers only messages whose source is the frame window', () => {
    const iframe = fakeIframe()
    let hostListener
    const port = framePort(iframe, 'https://jscad-run.rkroll.com', {
      addEventListener: (type, fn) => { hostListener = fn },
      removeEventListener: () => {},
    })
    const seen = []
    port.addEventListener('message', (event) => seen.push(event.data))
    hostListener({ source: iframe.contentWindow, data: { method: '__RESPONSE__', id: 1 } })
    hostListener({ source: { other: true }, data: { method: '__RESPONSE__', id: 2 } })
    expect(seen).toEqual([{ method: '__RESPONSE__', id: 1 }])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/frame-port.test.js`
Expected: FAIL, cannot resolve `../src/framePort.js`.

- [ ] **Step 3: Write `src/framePort.js`**

```js
/**
 * A Worker-shaped port over a cross-origin iframe, so messageProxy can drive
 * the compute frame the way it drives a worker.
 *
 * The frame's document is sandboxed without allow-same-origin, so it reports
 * event.origin 'null' and no explicit targetOrigin can match it on the way in.
 * Identity of the frame's window is the only check this side can make; the
 * frame's own allowedOrigin check is what keeps strangers out.
 * @param {HTMLIFrameElement} iframe
 * @param {string} runOrigin
 * @param {{addEventListener:Function,removeEventListener:Function}} [host]
 */
export const framePort = (iframe, runOrigin, host = window) => {
  const wrapped = new Map()
  return {
    postMessage: (message, transfer = []) =>
      iframe.contentWindow.postMessage(message, runOrigin, transfer),
    addEventListener: (type, fn) => {
      const filtered = (event) => {
        if (event.source !== iframe.contentWindow) return
        fn(event)
      }
      wrapped.set(fn, filtered)
      host.addEventListener(type, filtered)
    },
    removeEventListener: (type, fn) => {
      const filtered = wrapped.get(fn)
      if (!filtered) return
      wrapped.delete(fn)
      host.removeEventListener(type, filtered)
    },
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/frame-port.test.js`
Expected: 2 passed.

- [ ] **Step 5: Replace the frame's command table with a relay**

In `src_frame/frame.js`, delete the `commands` object, `workerBundles`, the `load`/`params`/`measure`/`check`/`export` handlers and the per-command `Promise.race`. Keep `createWorker`, `collectBuffers`, `ALLOWED_ORIGIN` and `BUNDLE_BASE`. The whole message path becomes:

```js
const post = (message, transfer) => parent.postMessage(message, ALLOWED_ORIGIN, transfer)

let { worker } = createWorker()
const attach = (w) => {
  w.onmessage = (event) => post(event.data, collectBuffers(event.data))
}
attach(worker)

window.addEventListener('message', (event) => {
  if (event.origin !== ALLOWED_ORIGIN) return
  if (!worker) {
    ({ worker } = createWorker())
    attach(worker)
  }
  worker.postMessage(event.data, collectBuffers(event.data))
})
```

`createWorker` no longer wraps the worker in `messageProxy` — the frame is a pipe, not a client — so it returns `{ worker }` only.

- [ ] **Step 6: Keep the timeout and report a terminated worker**

A model that never returns still has to be killable, and the app has to learn about it. In `frame.js`, track the newest request id seen and arm a timer per inbound request:

```js
const DEFAULT_TIMEOUT_MS = 30000
let timer
const armTimeout = (ms) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    worker.terminate()
    worker = null
    post({ method: 'frameWorkerTerminated', params: [{ reason: `model exceeded ${ms} ms` }] })
  }, ms)
}
```

Arm it on every inbound message carrying an `id`, clear it whenever a `__RESPONSE__` goes back out. `main.js` registers a `frameWorkerTerminated` handler that calls `setError(new Error(reason))` and re-issues `jscadInit`, so the next compile starts from a live worker.

- [ ] **Step 7: Move the agent's tools onto `workerApi`**

In `main.js`, delete the `frameClient` import and the `frame` constant, and build the agent deps from `workerApi` instead:

```js
measure: async (options) => await workerApi.jscadMeasure({ options }),
check: async (input) => await workerApi.jscadCheck({ bed: input?.bed, options: input ?? {} }),
exportModel: async ({ format }) => { const { data = [] } = await workerApi.jscadExportData({ format }) ... },
```

`createEvaluate` in `src/aiEvaluate.js` takes `workerApi` in place of `frame`, calls `workerApi.jscadSetFiles({ files })` then `workerApi.jscadScript({ script, url, base, root })` with `PROJECT_BASE` from `src_frame/fileMap.js`, and keeps its `capGeometry` check. `unwrap` disappears: `messageProxy` rejects on error instead of returning `{ ok: false }`, so the tool wrappers catch and return `errorResult(error)` the way `aiBridge.js` already does.

- [ ] **Step 8: Delete `src/frameClient.js`**

```bash
git rm apps/jscad-web/src/frameClient.js
```

- [ ] **Step 9: Update the frame e2e to the relay protocol**

`e2e/frame-host.html`'s `window.send` currently posts `{ id, command, payload }`. Change it to post `{ method, params: [payload], id }` and to resolve on the matching `__RESPONSE__`, so the specs read:

```js
const res = await page.evaluate(() => window.send('jscadScript', { script, url, base, root }))
```

Rewrite each existing assertion in those terms: a sibling require still returns entities, a params re-run still changes vertices, a model error still comes back as an error (now a rejection the host turns into `{ ok: false, error }`), the wrong-origin sender is still never answered, storage still throws, the third-party and app-origin fetches still fail, the manifold model still loads (`jscadInit` with the manifold bundle name), and the timeout still terminates the worker — that test now also asserts a `frameWorkerTerminated` message arrived.

- [ ] **Step 10: Run both suites**

Run: `cd apps/jscad-web && npx vitest run && npx playwright test e2e/frame.spec.js`
Expected: unit suite passes with the new port test; frame e2e passes with 16 tests.

- [ ] **Step 11: Commit**

```bash
git add -A apps/jscad-web
git commit -m "feat(jscad-web): relay the worker protocol through the frame"
```

---

### Task 4: Project files as a map

**Files:**
- Create: `apps/jscad-web/src/projectFiles.js`
- Create: `apps/jscad-web/test/project-files.test.js`
- Modify: `apps/jscad-web/main.js:433-470` (`jscadScript` wrapper)
- Test: `apps/jscad-web/test/project-files.test.js`

**Model:** `sonnet` — one new pure module plus a call-site change.

**Interfaces:**
- Produces: `collectProjectFiles(sw)` → `Promise<Record<string, string|ArrayBuffer>>`, keyed by path without a leading slash, reading from the `SwHandler`'s `Cache`; `isBinaryPath(path)` → `boolean`.
- Consumes: `getSwHandler()` from `src/fileSystem.js`.

- [ ] **Step 1: Write the failing test**

`apps/jscad-web/test/project-files.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { collectProjectFiles, isBinaryPath } from '../src/projectFiles.js'

const fakeSw = (entries) => ({
  base: 'http://localhost:5120/swfs/',
  cache: {
    keys: async () => Object.keys(entries).map((path) => ({ url: `http://localhost:5120/swfs/${path}` })),
    match: async (request) => {
      const path = new URL(request.url ?? request).pathname.replace('/swfs/', '')
      const body = entries[path]
      return {
        text: async () => String(body),
        arrayBuffer: async () => (body instanceof ArrayBuffer ? body : new TextEncoder().encode(String(body)).buffer),
      }
    },
  },
})

describe('collectProjectFiles', () => {
  it('reads text entries as strings keyed by path', async () => {
    const files = await collectProjectFiles(fakeSw({ 'main.js': 'export const a = 1', 'lib/part.js': 'x' }))
    expect(files['main.js']).toBe('export const a = 1')
    expect(files['lib/part.js']).toBe('x')
  })

  it('reads binary entries as ArrayBuffer', async () => {
    const files = await collectProjectFiles(fakeSw({ 'part.stl': new ArrayBuffer(4) }))
    expect(files['part.stl']).toBeInstanceOf(ArrayBuffer)
  })

  it('returns an empty map with no handler', async () => {
    expect(await collectProjectFiles(undefined)).toEqual({})
  })
})

describe('isBinaryPath', () => {
  it('classifies by extension', () => {
    expect(isBinaryPath('a/b/part.stl')).toBe(true)
    expect(isBinaryPath('a/b/model.js')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/project-files.test.js`
Expected: FAIL, cannot resolve `../src/projectFiles.js`.

- [ ] **Step 3: Write `src/projectFiles.js`**

```js
// The worker bundles' importData treats only .stl as binary
// (src_frame/bundle.frame-worker.js), so only those cross as ArrayBuffer.
const BINARY_EXT = new Set(['stl'])

/** @param {string} path */
export const isBinaryPath = (path) => BINARY_EXT.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase())

/**
 * The frame's worker is on another origin, so the file service worker cannot
 * serve it: a service worker only sees fetches from clients it controls. The
 * project travels in the message instead.
 * @param {{base:string,cache:Cache}|undefined} sw
 * @returns {Promise<Record<string,string|ArrayBuffer>>}
 */
export const collectProjectFiles = async (sw) => {
  if (!sw?.cache) return {}
  const files = {}
  for (const request of await sw.cache.keys()) {
    const path = new URL(request.url).pathname.replace(new URL(sw.base).pathname, '')
    const response = await sw.cache.match(request)
    if (!response) continue
    files[path] = isBinaryPath(path) ? await response.arrayBuffer() : await response.text()
  }
  return files
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/project-files.test.js`
Expected: 4 passed.

- [ ] **Step 5: Send the map with every script run**

In `main.js`'s `jscadScript` wrapper (`:433`), before `workerApi.jscadScript(...)`:

```js
await workerApi.jscadSetFiles({ files: await collectProjectFiles(fileSystem.getSwHandler()) })
```

The local worker ignores `jscadSetFiles` harmlessly at this point (its handler sets a global nothing reads), which is the point: the map is proven in place before the engine depends on it.

- [ ] **Step 6: Run the app e2e**

Run: `cd apps/jscad-web && npx playwright test e2e/app.spec.js`
Expected: unchanged results — the map is inert on the local worker.

- [ ] **Step 7: Commit**

```bash
git add apps/jscad-web/src/projectFiles.js apps/jscad-web/test/project-files.test.js apps/jscad-web/main.js
git commit -m "feat(jscad-web): collect project files into a map for the frame"
```

---

### Task 5: The editor runs in the frame

**Files:**
- Create: `apps/jscad-web/src/frameSetup.js`
- Delete: `apps/jscad-web/src/workerSetup.js`
- Modify: `apps/jscad-web/main.js` (worker creation, `paramChangeCallback`, unload), `apps/jscad-web/src/error.js:44-49`, `apps/jscad-web/static/frame/index.html` (CSP)
- Modify: `apps/jscad-web/e2e/frame.spec.js` (app-origin assertions)
- Test: `apps/jscad-web/e2e/app.spec.js`, `apps/jscad-web/e2e/frame.spec.js`

**Model:** `opus` — the engine swap, with params-proxy, animation, export and error-stack behavior all riding on it.

**Interfaces:**
- Produces: `createFrame({ onError, onProgress, onEntities, onJobCount })` → `{ frameEl, workerApi, handlers }`, the same shape `createWorker` returned, plus `createJobTracker` moved across unchanged.
- Consumes: `framePort` (Task 3), `collectProjectFiles` (Task 4).

- [ ] **Step 1: Write `src/frameSetup.js`**

```js
import { messageProxy } from '@jscadui/postmessage'
import { framePort } from './framePort.js'

/**
 * The compute frame stands in for the local worker. sandbox without
 * allow-same-origin gives it an opaque origin: model code runs with no
 * cookies, no storage and no same-origin fetch.
 */
export const createFrame = async ({ onError, onProgress, onEntities, onJobCount, runOrigin }) => {
  const frameEl = document.createElement('iframe')
  frameEl.src = runOrigin + '/'
  frameEl.setAttribute('sandbox', 'allow-scripts')
  frameEl.hidden = true
  const ready = new Promise((resolve) => frameEl.addEventListener('load', resolve, { once: true }))
  document.body.appendChild(frameEl)
  await ready

  const handlers = {
    entities: (result, options = {}) => onEntities(result, options),
    onProgress,
    frameWorkerTerminated: ({ reason }) => onError(new Error(reason)),
  }
  const workerApi = messageProxy(framePort(frameEl, runOrigin), handlers, { onJobCount })
  return { frameEl, workerApi, handlers }
}
```

Move `createJobTracker` from `workerSetup.js` into this file unchanged, then `git rm apps/jscad-web/src/workerSetup.js`.

- [ ] **Step 2: Switch `main.js` over**

Replace the `createWorker` call at `main.js:173-179` with `await createFrame({ ... , runOrigin: __FRAME_ORIGIN__ })`, delete the separate iframe construction at `:182-190`, and replace `worker.terminate()` in the unload handler (`:825`) with removing the iframe. `paramsUI`, `animRunner` and `exporter` keep their call sites because `workerApi` keeps its shape; verify by grep that no `workerApi.` call site was missed.

- [ ] **Step 3: Widen the frame CSP**

In `static/frame/index.html`, change `connect-src __RUN_ORIGIN__/frame/ https://cdn.jsdelivr.net` to `connect-src https: __RUN_ORIGIN__ http://localhost:*`. Examples (36MB on the app origin), `#url=` models and gists all resolve siblings over HTTP from inside the worker. The frame holds no credentials and no storage, so the exposure is a hostile model posting the user's own source somewhere, which it can already do today from a worker that also holds app-origin authority.

- [ ] **Step 4: Fix the error-stack filter**

In `src/error.js:44-49`, the stack filter drops frames containing `bundle.worker.js`; add `bundle.frame-worker.js`, and strip the run origin from displayed paths the same way the app origin is stripped.

- [ ] **Step 5: Replace the app-origin e2e assertions**

`model fetch against the app origin outside /frame/ fails` no longer holds and must be replaced, not deleted. Add to `e2e/frame-serve.mjs` an endpoint `/__whoami` that answers `{ cookie: req.headers.cookie ?? null, origin: req.headers.origin ?? null }` with `Access-Control-Allow-Origin: *`, and write:

```js
test('a model fetch carries no cookies and a null origin', async ({ page }) => {
  await gotoHost(page)
  const res = await page.evaluate(() => window.send('jscadScript', {
    script: `const main = async () => {\n` +
      `  const r = await fetch('http://localhost:5122/__whoami')\n` +
      `  const body = await r.json()\n` +
      `  if (body.cookie) throw new Error('cookie leaked: ' + body.cookie)\n` +
      `  if (body.origin !== 'null') throw new Error('origin was ' + body.origin)\n` +
      `  return []\n` +
      `}\n` +
      `module.exports = { main }\n`,
    url: 'http://project.local/main.js', base: 'http://project.local/', root: 'http://project.local/',
  }))
  expect(res.ok).toBe(true)
})
```

- [ ] **Step 6: Run the browser suites**

Run: `cd apps/jscad-web && npx playwright test e2e/frame.spec.js e2e/app.spec.js e2e/ai-chat.spec.js`
Expected: all pass. A failure here means the engine swap broke a user-facing path; fix before committing.

- [ ] **Step 7: Commit**

```bash
git add -A apps/jscad-web
git commit -m "feat(jscad-web): run the editor's models in the compute frame"
```

---

### Task 6: Render sweep gate

**Files:**
- Modify: none unless the sweep finds a regression.
- Test: `apps/jscad-web/e2e/render-baseline.json` (comparison only)

**Model:** `sonnet` — run the sweep, triage the diff.

**Interfaces:**
- Consumes: the whole app after Task 5.
- Produces: a pass/fail verdict that gates Task 7.

- [ ] **Step 1: Run the full sweep on GPU**

Run it through simple-ci on the gpu host (`ci/render`), never locally: it is memory-intensive and the local box has fewer workers. The sweep drives the real app, so after Task 5 it exercises the frame by construction.

- [ ] **Step 2: Diff against the baseline**

Compare the run against `apps/jscad-web/e2e/render-baseline.json` (776/788 recorded, job 07ff0ae0ffbdb0f2). Any model that passed on the baseline and fails now is a frame regression and must be fixed before Task 7.

- [ ] **Step 3: Record the result**

Append the job id, the pass count and the triage of any new failure to the Deploy section of `docs/backlog.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/backlog.md
git commit -m "test(jscad-web): render sweep through the frame matches baseline"
```

---

### Task 7: Delete the local engine

**Files:**
- Modify: `apps/jscad-web/build.js` (drop the app's `bundle.worker.js` entry), `apps/jscad-web/main.js` (service-worker failure path), `apps/jscad-web/src/fileSystem.js`
- Delete: any file left with no importer after the change

**Model:** `opus` — a deletion pass where the risk is removing something still load-bearing.

**Interfaces:**
- Consumes: Task 6's green sweep. Do not start this task without it.
- Produces: no app-origin path that can execute model code.

- [ ] **Step 1: Confirm the worker bundle has no consumer**

Run: `cd apps/jscad-web && grep -rn "bundle.worker.js" --include=*.js --include=*.html . | grep -v node_modules | grep -v build`
Expected: only `build.js`'s build entry and `src/error.js`'s stack filter. If anything else appears, stop and report.

- [ ] **Step 2: Drop the bundle and its entry**

Remove the `buildBundle(outDir + '/build', 'bundle.worker.js', ...)` call from `build.js` and delete `apps/jscad-web/src_bundle/bundle.worker.js` if nothing else imports it (the frame has its own `src_frame/bundle.frame-worker.js`).

- [ ] **Step 3: Keep the file service worker, drop its execution role**

The `SwHandler` stays: `analyzeProject`, `fileDropped`, `checkFiles` and the drop/watch paths all read its `Cache`, and Task 4's map is built from it. What goes is the assumption that it feeds an engine — `main.js`'s "cannot start service worker, reload required" branch becomes a warning, not an error that blocks running a model, since a failed registration now costs file watching rather than execution.

- [ ] **Step 4: Rebuild and run everything**

Run: `cd apps/jscad-web && npm run build && npx vitest run && npx playwright test e2e/frame.spec.js e2e/app.spec.js`
Expected: build succeeds with no `bundle.worker.js` in `build/`, all suites pass.

- [ ] **Step 5: Commit**

```bash
git add -A apps/jscad-web
git commit -m "feat(jscad-web)!: delete the app-origin model worker"
```

---

### Task 8: Documentation and CI

**Files:**
- Modify: `apps/jscad-web/docs/architecture.md`, `apps/jscad-web/README.md`, `docs/backlog.md`
- Modify: the CI entry that runs jscad-web browser tests (`ci/web`)
- Delete: `docs/superpowers/specs/2026-09-20-frame-single-engine-design.md`, `docs/superpowers/plans/2026-09-20-frame-single-engine.md`

**Model:** `haiku` — prose and config edits against files that already say most of it.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Rewrite the architecture doc's execution sections**

In `apps/jscad-web/docs/architecture.md`, the "Two engines, one boundary" section becomes one engine: the frame on `jscad-run.rkroll.com`, the relay in place of the command table, the file map in place of the service worker's serving role, and the widened `connect-src` with its reasoning. The "Deployment" section gains the run host and the deploy ordering. The "History" section records that the second origin came back.

- [ ] **Step 2: Update the README**

`apps/jscad-web/README.md`'s Compute frame section: all model execution is in the frame, the frame is a separate origin, headers live in `serve.js` and `deploy/run-hooks/`, and `FRAME_APP_ORIGIN`/`FRAME_RUN_ORIGIN` override the baked values. Drop the three-places-must-agree paragraph, which is now two.

- [ ] **Step 3: Close the backlog items**

Delete the compute frame items this work completed: the CI entry for browser e2e, the `params` tool outside the sandbox, the iframe created on every page load if Task 5 left it eager (otherwise keep it), and the editor migration item itself.

- [ ] **Step 4: Add the browser e2e to CI**

Add `app.spec.js` and `ai-chat.spec.js` to the `ci/web` entry so the only engine has a gate.

- [ ] **Step 5: Delete the spec and the plan**

```bash
git rm docs/superpowers/specs/2026-09-20-frame-single-engine-design.md docs/superpowers/plans/2026-09-20-frame-single-engine.md
```

- [ ] **Step 6: Commit**

```bash
git add -A apps/jscad-web/docs apps/jscad-web/README.md docs/backlog.md
git commit -m "docs(jscad-web): one engine, on its own origin"
```

---

## Operator steps (not tasks)

These are John's, in this order, after Task 8 merges:

1. DNS `jscad-run.rkroll.com` at the app host's address.
2. `cd apps/jscad-web && ./deploy-full.sh` — run host first, then frontend and API.
3. Retire the `jscad-studio.rkroll.com` and `run.jscad-studio.rkroll.com` vhosts.
