# Single engine: editor execution moves into the compute frame

**Status:** approved 2026-09-20, not yet implemented.

**Goal:** all model code in jscad-web executes in the sandboxed compute frame,
on its own origin. The local worker is deleted. The app page keeps the editor,
viewer, params UI, storage, session and chat, and never evaluates model code.

## Why

The frame today covers only the agent's `eval`, `measure`, `check` and
`export`. Everything the editor compiles — examples, the demo browser, dropped
folders, `#data:` and `#url=` models, gists, and agent-written source once the
user runs it — still executes in `src/workerSetup.js`'s worker on the app
origin, with the page's full authority: `fetch('/api/...')`, IndexedDB
(including the `FileSystemDirectoryHandle` that writes to a real folder on
disk), and unrestricted egress. That path predates the app having a session,
a user's projects, a rowboat tenant and a GitHub App installation. The frame
protects the path that did not need protecting most.

## Scope

In scope:

- The frame becomes the only model engine, on `https://jscad-run.rkroll.com`.
- The frame relays the existing worker protocol rather than exposing a command
  table of its own; the agent's commands collapse onto the same channel.
- Project files reach the frame as a file map. The `swfs` service worker leaves
  the execution path.
- The frame's `connect-src` widens to `https:`.
- `src/workerSetup.js`'s worker is deleted, with no flag and no fallback.

Out of scope:

- Changing the worker protocol itself, the renderer, or the params proxy.
- Server-side execution of any kind.
- Moving the agent loop.

## Architecture

```
jscad.rkroll.com                        jscad-run.rkroll.com
  page (main.js)                          /  (static, no API, no SPA fallback)
    editor, viewer, params UI, chat        <iframe sandbox="allow-scripts">
    storage, session, provider key           frame.js: relay + origin check
    messageProxy(framePort) ───────────►       blob worker: jscad worker bundle
                          ◄─────────── entities, progress, job counts
```

The app holds everything with authority. The frame holds an opaque origin with
no cookies, no storage, no service worker, and the CPU.

### Origins

`build.js` stops assigning one value to both origin variables:

- `__APP_ORIGIN__` — the app. Dev `http://localhost:<port>`, prod
  `https://jscad.rkroll.com`. Overridable with `FRAME_APP_ORIGIN`.
- `__RUN_ORIGIN__` — the frame. Dev is `http://localhost:<port+1>`, prod
  `https://jscad-run.rkroll.com`. Overridable with `FRAME_RUN_ORIGIN`.

The iframe `src` becomes `__RUN_ORIGIN__ + '/'`, absolute. In dev, `build.js`
starts a second static server on `port+1` rooted at `build/frame`, carrying the
same `Permissions-Policy` and `frame-ancestors __APP_ORIGIN__` headers the run
vhost sets; `serve.js` gains the same second root for `npm run serve`. The
app's `/frame/` path, its dev-server middleware branch, its `serve.js` `/frame/`
branch and `deploy/hooks/apache.configure.post.sh` all go away. The run host
serves the frame build as its document root, and still sets
`Access-Control-Allow-Origin: *` on it: the blob worker inherits the sandboxed
document's opaque origin, so its bundle XHRs are cross-origin even against the
run host itself.

The sandbox attribute is unchanged and non-negotiable: `sandbox="allow-scripts"`
with no `allow-same-origin`. The separate origin is a second control, not a
replacement for the first.

### Frame CSP

```
default-src 'none';
script-src __RUN_ORIGIN__ https://cdn.jsdelivr.net blob: 'unsafe-eval';
connect-src https: __RUN_ORIGIN__;
worker-src blob: __RUN_ORIGIN__;
frame-ancestors __APP_ORIGIN__
```

`connect-src https:` is a deliberate widening. Model code resolves sibling
requires over HTTP for examples (36MB on the app origin), remote URLs, gists
and CDN packages; without it those models break, and duplicating the examples
onto the run host would still not cover third-party URLs. The frame has no
credentials and no storage, so the exposure is that a hostile model can post
the user's own source somewhere. It can already do that today from a worker
that additionally holds app-origin authority. Dev builds add
`http://localhost:*` to `connect-src`.

### The relay

`packages/postmessage`'s `messageProxy` already carries the whole protocol:
`{ method, params, id }` requests, `__RESPONSE__` replies with restored error
stacks, worker-to-app handler calls (`entities`, `onProgress`) and job counts,
and a `TRANSFERABLE` symbol for zero-copy buffers. It also takes an
`allowedOrigin` option that filters on `event.origin`
(`packages/postmessage/index.js:119`).

So the frame does not need a command table. It relays:

- App to frame: `messageProxy` talks to a port object, not a `Worker`. The port
  implements `postMessage(message, transfer)` as
  `iframe.contentWindow.postMessage(message, RUN_ORIGIN, transfer)` and
  `addEventListener('message', fn)` as a window listener filtered on
  `event.source === iframe.contentWindow`. A sandboxed frame reports origin
  `null`, so source identity is the only check available on this side; the
  frame's own `allowedOrigin` check is the one that matters.
- Frame to worker: `frame.js` forwards `event.data` to its blob worker with the
  buffers behind it in the transfer list, and forwards every worker message
  back to the app window with `targetOrigin = __APP_ORIGIN__`. Its existing
  `collectBuffers` walk supplies both transfer lists.

`src/workerSetup.js` becomes `src/frameSetup.js`: it builds the iframe, waits
for load, and returns `{ frame, workerApi, handlers }` with the same shape it
returns today, so `main.js`, `src/paramsUI.js`, `src/animRunner.js` and
`src/exporter.js` keep their call sites. `src/frameClient.js` and the frame's
`load`/`params`/`measure`/`check`/`export` commands are deleted; the agent's
tools call the same `workerApi` the editor uses, and `src/aiEvaluate.js` keeps
its geometry cap check.

Liveness moves with it. The frame keeps its per-command timeout, terminating
and rebuilding the worker on expiry; on the app side a terminated worker must
reject every request outstanding in `reqMap`, which today only times out after
five minutes. The relay sends an explicit `workerTerminated` notification the
app turns into a rejection for the pending calls.

### Project files

A service worker intercepts fetches only from clients it controls. The frame's
worker lives on another origin and is not a client of the app's `swfs` service
worker, so no combination of headers lets that worker serve the frame. Project
files therefore travel in the message:

- `jscadSetFiles({ files })` already exists in the frame worker
  (`src_frame/bundle.frame-worker.js`) and populates `self.__PROJECT_FILES__`,
  which `readFileFrame.js` consults before falling through to the network.
- The app sends the map before `jscadScript`, with paths relative to
  `PROJECT_BASE` (`http://project.local/`). Values are strings for text and
  `ArrayBuffer` for extensions `importData.isBinaryExt` treats as binary
  (`packages/require/src/require.js:93`).
- The file watcher re-sends changed entries and calls `jscadClearFileCache`
  before re-running, as it does now.
- A model loaded by URL keeps its real base, so its siblings resolve over the
  network from inside the frame and never enter the map.

`fs-provider` keeps drag-and-drop extraction, `analyzeProject`, alias discovery
and `checkFiles` watching. It loses `registerServiceWorker`, the `swfs` prefix
and `sw.base`; `src/fileSystem.js` builds the map from the same entries it
currently caches. The "cannot start service worker, reload required" path in
`main.js` goes with it, as does `reloadDetection.js` if nothing else uses it.

### Errors

Unchanged in shape. `messageProxy` restores `name`, `message` and `stack`
across the boundary, so `src/error.js` keeps working; its filter on
`bundle.worker.js` frames becomes `bundle.frame-worker.js`, and stacks now
carry the run origin, which `error.js` must strip the same way.

## Migration order

Each step is a commit, and the render gate runs before the step that deletes
the local worker.

1. Split the origin variables in `build.js`, serve the frame from a second dev
   origin, and restore `apps/jscad-web/deploy-run.conf` for
   `jscad-run.rkroll.com`. The app still uses the local worker.
2. Add the relay to `frame.js` and the port to the app; prove it by moving the
   agent's tools onto `workerApi` and deleting `frameClient.js`.
3. Build the project file map in `src/fileSystem.js` and send it with every
   `jscadScript`, still against the local worker, so the map is proven before
   it is load-bearing.
4. Point the editor at the frame: `frameSetup.js` replaces `workerSetup.js`,
   `paramsUI`, `animRunner` and `exporter` follow.
5. Run the full render sweep through the frame on GPU and diff against
   `apps/jscad-web/e2e/render-baseline.json`. No regression, or stop here.
6. Delete the local worker, `bundle.worker.js`'s app build entry, the service
   worker registration and the `/frame/` path on the app origin.
7. Operator steps: DNS and cert for `jscad-run.rkroll.com`, deploy the run
   host, then retire the old `run.*`/`jscad-studio*` vhosts.

## Testing

- `e2e/frame.spec.js` keeps its sandbox assertions and gains: a fetch to the
  app origin from inside the frame carries no credentials, and the frame cannot
  read app-origin storage.
- New protocol e2e over the relay: `jscadInit`, `jscadScript` with a file map,
  `jscadMain` with params, `jscadExportData`, a model error, a timeout that
  terminates the worker, the pending-request rejection that follows, and a
  message from a wrong origin being ignored.
- Unit: the file map builder against a fixture project with a binary entry; the
  port adapter's source filtering.
- `ci/render`: the full 788-model sweep through the frame against
  `render-baseline.json`, as the gate on step 6.
- `app.spec.js` and `ai-chat.spec.js` get a CI entry, since after step 6 they
  cover the only engine. This closes the first item in the backlog's compute
  frame list.

## Risks

- **The render sweep is the only broad parity check.** A model that behaves
  differently through the map (a path the service worker resolved loosely, an
  encoding) shows up there or not at all. Step 3 exists to surface those before
  the engine switches.
- **Eager file maps replace lazy reads.** A dropped folder is read in full
  instead of on demand. Large binary assets in a project become a copy per run
  until the map is diffed rather than resent.
- **Two origins, two deploys.** A frontend deployed without its matching run
  host leaves the app with no engine. `deploy-full.sh` must deploy the run host
  and check it before the app, and the app should fail visibly, not silently,
  when the frame does not answer.
- **`connect-src https:`** lets a hostile model exfiltrate the user's own model
  source. Accepted, and strictly better than the status quo.
- **Manifold in the frame is still broken** (`bundle.manifold_modeling.js`
  resolves `./manifold.wasm` against a `blob:` base). It must be fixed before
  step 4, or the Manifold engine has no home. This is a backlog item today and
  becomes a blocker.

## Decisions

- The frame is the only engine. No flag, no fallback, no dev-only local worker.
- The frame keeps `sandbox="allow-scripts"` with no `allow-same-origin` even
  though it is now a separate origin.
- The frame relays the worker protocol; it does not own a command vocabulary.
- Project files travel as a map; the service worker leaves the execution path.
