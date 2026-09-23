# Architecture

jscad-web is the JSCAD editor, viewer and agent chat in one page, with an
Express API beside it and a second origin that runs the models. What follows is
the shape of the thing and the reasons behind the parts that are not obvious.
For how to use it, see the [README](../README.md).

## Pieces

```
jscad.rkroll.com
  page (main.js)            editor, viewer, params UI, chat, project drawer
   ├─ /api  →  Express      auth, sync tokens, provider relay, GitHub app
   │                          └─ hosted rowboat: projects, files, versions
   └─ <iframe sandbox="allow-scripts"> →  jscad-run.rkroll.com
        └─ blob worker      evaluates every model          (opaque origin)
```

The page never evaluates model code itself, and there is only one place that
does.

## One engine, one boundary

Model code is JavaScript with the privileges of the origin that serves it. A
model the user opened from a link, a gist or a `#data:` URL is someone else's
code, and on the app origin it could call `/api` with the user's cookie, read
IndexedDB, and send what it found anywhere. The browser protects the server
from the model; it does not protect the user.

The compute frame is the answer to that. It is served from its own host and
embedded as `<iframe sandbox="allow-scripts">`. Leaving `allow-same-origin` off
is the whole point: the frame gets an opaque origin, so code inside it has no
cookies, no IndexedDB, no same-origin fetch and no service worker.

The boundary falls between evaluating and drawing. Evaluating runs arbitrary
code, including `require` from a CDN and transpiled OpenSCAD, so it belongs in
the frame. What comes back is plain data: vertex and normal arrays, colors,
transforms and JSON, none of which can execute. Drawing that data, and every
control around it, stays on the app origin, which is why the canvas is never
tainted and a view capture is a local operation.

`src/frameSetup.js` builds the frame and hands back a `workerApi` with the
shape the local worker's proxy had, so the params UI, the animation runner and
the exporter drive it unchanged.

Creating the frame and the `jscadInit` that follows are top-level awaits, and
everything below them in `main.js` waits about 1.5s on a live host. The chrome
(menu, welcome, about) needs none of it, so it is wired above those awaits:
a click on a button whose listener has not attached is lost, not queued.

The frame's `connect-src` is `https:` plus the run origin and localhost in
dev — wide enough that a model can fetch and run code from any https host,
via `require` from a CDN or a raw `fetch`. That width is deliberate: a model
loaded from a real URL — an example, a `#url=` model, a gist — resolves its
siblings over the network from inside the frame, and there is no fixed list
of hosts to name in advance. The boundary's guarantee is not about which code
runs; it is about what authority it runs with. The frame holds no cookies, no
storage and no same-origin access, so a fetch from it carries a `null` origin
and nothing else, regardless of which host answers or what script that host
hands back. The app origin has to answer examples and OpenSCAD includes with
`Access-Control-Allow-Origin` for the same reason (see Deployment).

### Naming a script

A project's files travel to the frame in a map keyed by bare path
(`src/projectFiles.js`), so a project script names itself against
`PROJECT_BASE` (`http://project.local/`) and every sibling `require` resolves
from the map (`src_frame/fileMap.js`). The app origin's `/swfs/` service-worker
URLs never cross, because a service worker only serves clients it controls and
the frame is not one — that is why the map exists at all, in place of the
serving role a same-origin service worker would otherwise play.

Every compile sends whatever the cache holds, so switching projects empties it
first (`replaceProjectFiles`); otherwise the frame receives the union of every
project opened in the session.

An OpenSCAD `use`/`include` resolves through `src_frame/scadResolve.js`:
against the directory of the file that asked for it, then against that file's
library root (`/examples/openscad/<library>`) as an OPENSCADPATH-like
fallback. The fallback is dropped when `../` in the filename would resolve
above that root. It is the only copy of this logic; the loader in
`@jscadui/require` has no origin to resolve against inside a blob worker.
`src_frame/scadHandler.js` remembers a failed read for 60 s so one transpile
does not fetch the same missing file for every includer, and forgets them all
whenever a new file map arrives or a cache is cleared.

A model loaded from a real URL is different: `main.js` passes the app origin,
not the model's own URL, as the base for a `#url=` model's siblings, so those
resolve relative to `jscad.rkroll.com`, not to wherever the model was fetched
from. The demo browser passes the model's own directory instead. Both cases
resolve over the network rather than through the file map.

### Protocol

The frame speaks the worker protocol, not one of its own: `src/framePort.js`
wraps the iframe in the `postMessage`, `addEventListener` and
`removeEventListener` a `Worker` offers, so `messageProxy` drives it the way it
drove the local worker. `jscadInit`, `jscadScript`, `jscadSetFiles`,
`jscadMain`, `jscadMeasure`, `jscadCheck`, `jscadGetExportFormats`,
`jscadExportData` and the cache clears all reach the frame's worker. Geometry
buffers ride the transfer list on both hops, so they cross without a copy.

Notifications relay the same way, but the worker sends none: it answers
`jscadMain` with its entities rather than pushing them, so
`frameWorkerTerminated` is the only message the frame originates and the only
one `frameSetup.js` registers with `messageProxy`. `handlers.entities` beside
it is `main.js`'s own sink, which it calls directly for restores and cached
results as well as for a fresh render. Job count is not relayed either: the
proxy's own pending-request map on the app side is what drives it.

`src_frame/frameHost.js` holds the frame's side of all this; `frame.js` is the
entry that hands it the real worker, `parent` and `postMessage`, which is what
makes it unit-testable (`test/frame-host.test.js`).

The frame relays every method untouched but one. The app never names
a bundle URL: a script source inside the frame must come from the frame's own
origin, and the model engine is built only into `build/frame/assets`. The app
origin ships the viewer bundles (three.js, regl, render-regl) and nothing that
runs a model. So the app sends
`jscadInit` with an `engine` name and the frame fills in the `bundles` map from
its own `__BUNDLE_BASE__`. The same call carries the frame's request timeout:
the app sends `timeoutMs: 120000` from `initFrame()`, and the frame falls back
to 30 s only if no `jscadInit` ever named one. `engine` latches: a `jscadInit`
that omits it keeps the last one, which is what the alias path
(`onAliasFound`) depends on, since it re-inits without naming an engine.

Both sides check who they are talking to. The frame requires both
`event.origin === __ALLOWED_ORIGIN__`, baked in at build time, and
`event.source === parent` — same origin is not the same window, and another
tab could otherwise drive the worker. The app cannot check origin in reverse,
because a sandboxed frame reports its origin as `null`, so it matches on
`event.source === iframe.contentWindow` and posts to `'*'`.

Each in-flight request gets its own timer. When one expires the worker is
terminated, since there is no way to cancel just that model: the expired
request is answered `TimeoutError`, every other request the worker was holding
is answered `AbortError`, and the app gets one `frameWorkerTerminated`. The
next request builds a fresh worker, which the app's handler re-initializes. A
worker that fails to load its bundles takes the same path through `onerror`,
so the app sees the load error rather than a timeout a budget later.

Model code runs in the same worker as the code that answers requests, so the
frame does not trust what the worker posts. Each relayed request goes to the
worker under a fresh `crypto.randomUUID()`, and the frame maps it back to the
app's id. A worker message that is not an answer to an id the frame issued is
dropped, so a model cannot answer a request itself to cancel its timer, and
cannot post `frameWorkerTerminated` or any other message to the app. Once the
worker's own listener is attached, `src_frame/sealMessages.js` makes later
`message` listeners and `onmessage` on the worker global inert, so model code
cannot read the ids either.

Nothing waits on a request the frame can answer immediately: a malformed
`jscadInit` is rejected in the listener, a worker that cannot be constructed
fails the request that needed it, and a method the worker has no handler for
is answered with an error by `@jscadui/postmessage` rather than left pending.

A second iframe `load` means the frame navigated, so its worker, file map and
engine are gone. `frameSetup.js` rejects every request still in flight, since
the new frame never saw them, then reports the reload and asks for a re-init,
the same response it gives a terminated worker.

### Why a blob worker

A frame with an opaque origin cannot construct a `Worker` from a URL, and
relative `importScripts` fails inside a blob worker. So the frame builds a
two-line blob that sets `__BUNDLE_BASE__` and `importScripts` the real bundle.
For the same reason the worker's file reads cannot use `readFileWeb`, whose
base is `self.location.origin` (`'null'` here); `build.js` swaps in
`src_frame/readFileFrame.js`, which serves reads from the project file map
`jscadSetFiles` carried and falls through to the CDN for bare packages.

### Headers

The frame is cross-origin, so its module script and the worker's bundle
fetches need CORS. `build.js` (dev server middleware) and `serve.js`
(production preview server) each set this for both hosts they can serve;
`deploy/hooks/apache.configure.post.sh` sets it for whichever host it is
running against, keyed by `APP_NAME`: the run host gets a vhost-wide block
(frame CORS, `frame-ancestors`, `Permissions-Policy`), the app host gets a
narrower one scoped to `/examples/` (see Deployment). The three places must
keep the same shape for a given host.

`build.js` also bakes the app origin into the frame page's CSP and into
`__ALLOWED_ORIGIN__`: `http://localhost:<port>` for a dev build,
`https://jscad.rkroll.com` for production, `FRAME_APP_ORIGIN` to override.
The run host's `frame-ancestors` header reads the same variable:
`deploy-full.sh` exports it before building, defaulting to the app URL, and
`deploy-run.conf` defaults it for a standalone run-host deploy.

### Preview and render

OpenSCAD models read `$preview` to tell F5 (preview) from F6 (render);
NopSCADlib's test files draw nothing outside preview. `$preview` is a run-time
special variable in `@jscadui/openscad-runtime`, not a transpile-time constant,
so one transpiled module serves both modes. The frame worker keeps it `true`
while the model is displayed. An export sets it `false`, re-runs `main()`,
serializes that, then restores the preview run. Only a model that has read
`$preview` pays for the extra runs: the runtime latches `j$.previewUsed` and
the export skips the whole dance when it is clear.

### Geometry caps

Geometry from the frame is untrusted input, so `src/caps.js` bounds it before
the first allocation for drawing: 256MB of buffers and 2000 entities. Over a
cap is a model error, not an allocation. There is no separate vertex cap: a
vertex costs at least 12 bytes, so the buffer cap bounds vertices at about 22M,
and an 8M one refused whole-library `ALL.js` grids that were genuine geometry. `aiEvaluate.js`
re-checks the same caps so the agent cannot be told a model evaluated when
nothing was drawn.

## Agent loop

The loop runs in the browser (`packages/agent-loop`), not on the server. The
page holds the conversation, calls the provider, and serves each tool request
itself through `src/aiBridge.js`. Provider HTTP goes through `/api/relay`,
which exists only because providers do not send CORS headers; it keeps no
session and no storage, checks the caller's origin, resolves the upstream host
at forward time and refuses private addresses. It forwards an allowlist of
headers (content type, accept, provider auth and version, the opencode
session), so the session cookie never reaches a provider.

Tools and where they run:

| Tool | Runs |
|---|---|
| `eval`, `measure`, `check`, `export`, `params` | compute frame |
| `view` | page, from the live canvas |
| `writeModel` | editor buffer plus a version row |

`params` calls `paramChangeCallback`, which re-runs `jscadMain` against
whatever the frame last loaded — the agent's `eval` source or the editor's,
whichever ran last. `writeModel` only fills the editor buffer; nothing compiles
until the user runs it.

## Key custody

The provider key is the user's, in one of three modes (`packages/key-store`):
in memory for the session, in `localStorage` on this origin, or as AES-GCM
ciphertext under a PBKDF2 passphrase that never leaves the browser. The key
rides the relay request to the provider and is never stored server-side, never
logged, and never sent into the frame.

## Storage

Local-first with per-project version history (`src/storage/`). Every editor
compile and every `writeModel` records a version row and file hashes.
Backends: the service-worker FS and file handles (`local`, the default and the
only mode for anonymous users), rowboat blobs and tables (`rowboat`, after
sign-in, synced with a 15-minute JWT from `GET /api/sync-token`), a linked
local folder through `showDirectoryPicker()`, and a connected GitHub
repository through a GitHub App installation. Connecting saves the
installation only when its repository list includes the requested
owner/repo, and every read, write and version listing must name that same
owner/repo. Sign-in is Google or Apple, so the server has no GitHub identity
to check the installation's account against.

A mixed project merges at load: each manifest path names exactly one backend,
and an unlisted sibling resolves local-first then rowboat.
`src/storage/manifest.js` is generated from `schema.js` by
`node scripts/gen-manifest.js`, and a parity test fails on drift. `main.js`
imports the storage leaves directly rather than the index, because the index
re-exports zod-typed schema the root TS 4.9 gate cannot parse.

No storage access crosses into the frame: no session, no directory handle, no
repository token. A project's file contents do cross, because a model's
`require` of a sibling has to resolve inside the frame.

## Deployment

Two hosts, both required — an app with no frame has no engine, so the run
host deploys first:

- `jscad-run.rkroll.com`, from `deploy-run.conf`: the frame, with no SPA
  fallback, so a bad path 404s instead of returning the app. Its content dir is
  `build/frame`, whose bundles live in `assets/`, not `build/`: deploy.sh
  publishes a content dir's `dist/` or `build/` child when it has one, and a
  `build/` child there would publish the bundles in place of the frame page.
- `jscad.rkroll.com`, from `deploy.conf`: Apache serves the built bundle with
  SPA fallback and proxies `/api` to the Express service under systemd. Its
  vhost also carries the `/examples/` CORS block from `apache.configure.post.sh`
  (`Access-Control-Allow-Origin: *`, no `Access-Control-Allow-Credentials`,
  scoped to `/examples/` and left off `/api/`) — a model in the frame reads an
  example's sibling files and OpenSCAD includes as a cross-origin GET with a
  `null` origin, which only `*` matches, and `/api/` and the relay deliberately
  reject a `null` origin, so they must not inherit a vhost-wide grant.

The session cookie is host-only on `jscad.rkroll.com`, never `.rkroll.com`.
`deploy-full.sh` builds the workspace once, deploys the run host and confirms
it answers, then the frontend, then the API, then `/api/health`, then
`e2e/smoke-deploy.mjs` against the live app URL. Both checks go through
`wait_for_ok`, which retries for 15 s and reads `curl -f`'s exit code: a fresh
vhost needs a moment, and any non-2xx has to fail the deploy. Both hosts went
live 2026-09-21.

`deploy.sh` sources `lib/platform.sh` from `common.sh` before it reads a
stage's own config, so an inherited `REMOTE_HOST` makes that sourcing run
remote detection over ssh and exit the script with status 0 — a silent no-op
that `set -e` reads as success, not a failure. `deploy-full.sh` unsets
`REMOTE_HOST` on entry and never exports one stage's into the next; each of
the three `deploy.sh` invocations (run host, frontend, API) takes its host from
its own config file. Because a no-op stage leaves the previous build serving,
which passes every other check, the smoke gate also compares the served build
against the one just built.

### Smoke gate

`e2e/smoke-deploy.mjs` is the only check that runs against the live site
rather than a local build. It proves: the app boots and a model renders, the
demo browser reads `manifest.json` instead of the directory listing that 403s
in production (see backlog), an include-heavy model (`mcad/hardware_test.scad`)
resolves its includes from the live host, a grid (`01-basics/ALL.js`) renders
with no `ALL: FAILED` cell (a dead cell draws a marker and the page still
settles `ok`), no model draws zero vertices, and the CORS split holds — `/examples/` answers `Access-Control-Allow-Origin: *`
and `/api/health` answers none.

With `--build build`, it first checks that the app host serves the build in
that directory, and with `--frame-url` the frame host too. The build id is the
content hash in each `index.html`'s entry name (`main.<hash>.js`,
`frame.<hash>.js`): the entry's hash covers every bundle it loads, and
`index.html` is served no-cache. `deploy-full.sh` passes both flags.

It waits for the first render before touching the menu. `main.js` wires the
menu partway through a boot that awaits the compute frame, so a click landing
before that hits a button with no listener and is lost; waiting afterwards
never recovers it, which is why the menu click retries rather than waiting.

`e2e/page-console.mjs` is the companion for when a check fails with nothing
but a timeout: it opens a URL in the same bundled chromium and prints every
console message, uncaught error, failed request and non-2xx response, with
`--click`, `--init` and `--eval` to reach a specific step.

## History

jscad-studio and jscad-studio-run were separate apps on two hosts
(`jscad-studio.rkroll.com` and `run.jscad-studio.rkroll.com`). They folded
into jscad-web on 2026-09-20, and the frame briefly moved to `/frame/` on the
app host. The second origin came back as `jscad-run.rkroll.com`: the sandbox
attribute already strips the frame's authority, and the separate origin is a
second, independent control rather than a replacement for it, so it returned
alongside the CORS header `/examples/` needs to answer the frame's
cross-origin reads.
