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

Worker notifications relay the same way, so the progress bar and the animation
runner's `entities` pushes work unchanged. Job count is not relayed: the
proxy's own pending-request map on the app side is what drives it.

`src_frame/frame.js` relays every method untouched but one. The app never names
a bundle URL: a script source inside the frame must come from the frame's own
origin, and the app's bundle set has no frame counterpart. So the app sends
`jscadInit` with an `engine` name and the frame fills in the `bundles` map from
its own `__BUNDLE_BASE__`. The same call carries the frame's request timeout:
the app sends `timeoutMs: 120000` from `initFrame()`, and the frame falls back
to 30 s only if no `jscadInit` ever named one.

Both sides check who they are talking to. The frame compares `event.origin`
against `__ALLOWED_ORIGIN__`, baked in at build time. The app cannot do the
same in reverse, because a sandboxed frame reports its origin as `null`, so it
matches on `event.source === iframe.contentWindow` and posts to `'*'`.

A request that outruns the timeout terminates the worker, and the frame notifies
the app with `frameWorkerTerminated`; the next request builds a fresh worker,
which the app's handler re-initializes.

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

### Geometry caps

Geometry from the frame is untrusted input, so `src/caps.js` bounds it before
the first allocation for drawing: 5M vertices, 256MB of buffers, 2000
entities. Over a cap is a model error, not an allocation. `aiEvaluate.js`
re-checks the same caps so the agent cannot be told a model evaluated when
nothing was drawn.

## Agent loop

The loop runs in the browser (`packages/agent-loop`), not on the server. The
page holds the conversation, calls the provider, and serves each tool request
itself through `src/aiBridge.js`. Provider HTTP goes through `/api/relay`,
which exists only because providers do not send CORS headers; it keeps no
session and no storage, checks the caller's origin, resolves the upstream host
at forward time and refuses private addresses.

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
repository through a GitHub App installation.

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
  fallback, so a bad path 404s instead of returning the app.
- `jscad.rkroll.com`, from `deploy.conf`: Apache serves the built bundle with
  SPA fallback and proxies `/api` to the Express service under systemd. Its
  vhost also carries the `/examples/` CORS block from `apache.configure.post.sh`
  (`Access-Control-Allow-Origin: *`, no `Access-Control-Allow-Credentials`,
  scoped to `/examples/` and left off `/api/`) — a model in the frame reads an
  example's sibling files and OpenSCAD includes as a cross-origin GET with a
  `null` origin, which only `*` matches, and `/api/` and the relay deliberately
  reject a `null` origin, so they must not inherit a vhost-wide grant.

The session cookie is host-only on `jscad.rkroll.com`, never `.rkroll.com`.
`deploy-full.sh` deploys the frontend, then the API, then checks
`/api/health`; the run host is deployed separately, first.

## History

jscad-studio and jscad-studio-run were separate apps on two hosts
(`jscad-studio.rkroll.com` and `run.jscad-studio.rkroll.com`). They folded
into jscad-web on 2026-09-20, and the frame briefly moved to `/frame/` on the
app host. The second origin came back as `jscad-run.rkroll.com`: the sandbox
attribute already strips the frame's authority, and the separate origin is a
second, independent control rather than a replacement for it, so it returned
alongside the CORS header `/examples/` needs to answer the frame's
cross-origin reads.
