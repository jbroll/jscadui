# Architecture

jscad-web is the JSCAD editor, viewer and agent chat in one page, served from
one origin, with an Express API beside it. What follows is the shape of the
thing and the reasons behind the parts that are not obvious. For how to use it,
see the [README](../README.md).

## Pieces

```
jscad.rkroll.com
  page (main.js)            editor, viewer, params UI, chat, project drawer
   ├─ local worker          evaluates the editor's model  (same origin)
   ├─ /frame/  <iframe sandbox="allow-scripts">
   │    └─ blob worker      evaluates the agent's model    (opaque origin)
   └─ /api  →  Express      auth, sync tokens, provider relay, GitHub app
                              └─ hosted rowboat: projects, files, versions
```

The page never evaluates model code itself. Evaluation happens in one of two
workers, and which one depends on where the code came from.

## Two engines, one boundary

Model code is JavaScript with the privileges of the origin that serves it. A
model the user opened from a link, a gist or a `#data:` URL is someone else's
code, and on the app origin it could call `/api` with the user's cookie, read
IndexedDB, and send what it found anywhere. The browser protects the server
from the model; it does not protect the user.

The compute frame is the answer to that. `/frame/` is served from this app's
own host and embedded as `<iframe sandbox="allow-scripts">`. Leaving
`allow-same-origin` off is the whole point: the frame gets an opaque origin, so
code inside it has no cookies, no IndexedDB, no same-origin fetch and no
service worker, and its CSP holds `connect-src` to `/frame/` and jsdelivr.

The boundary falls between evaluating and drawing. Evaluating runs arbitrary
code, including `require` from a CDN and transpiled OpenSCAD, so it belongs in
the frame. What comes back is plain data: vertex and normal arrays, colors,
transforms and JSON, none of which can execute. Drawing that data, and every
control around it, stays on the app origin, which is why the canvas is never
tainted and a view capture is a local operation.

Today only the agent's `eval`, `measure`, `check` and `export` cross into the
frame (`src/frameClient.js` on the app side, `src_frame/` on the other). The
editor still compiles through the local worker on the app origin, so a model
the user opens runs with the page's full authority. Moving the editor onto the
frame is the open item in `../../docs/backlog.md`, and the preconditions are
the agent path proven in production plus frame/worker parity across a render
sweep.

### Protocol

`{ id, command, payload }` in, `{ id, ok: true, result }` or
`{ id, ok: false, error }` out. A model error is a result, never a rejection.
Commands are `load`, `params`, `measure`, `check` and `export`. Geometry
buffers ride the transfer list, so they cross without a copy.

Both sides check who they are talking to. The frame compares `event.origin`
against `__ALLOWED_ORIGIN__`, baked in at build time. The app cannot do the
same in reverse, because a sandboxed frame reports its origin as `null`, so it
matches on `event.source === iframe.contentWindow` and posts to `'*'`.

A command that outruns its timeout terminates the worker; the next command
builds a fresh one.

### Why a blob worker

A frame with an opaque origin cannot construct a `Worker` from a URL, and
relative `importScripts` fails inside a blob worker. So the frame builds a
two-line blob that sets `__BUNDLE_BASE__` and `importScripts` the real bundle.
For the same reason the worker's file reads cannot use `readFileWeb`, whose
base is `self.location.origin` (`'null'` here); `build.js` swaps in
`src_frame/readFileFrame.js`, which serves reads from the project file map the
`load` command carried and falls through to the CDN for bare packages.

### Headers

The browser treats the frame as cross-origin even though it is same-host, so
its module script and the worker's bundle fetches need CORS. Three places set
the same headers and must agree:

- `build.js` — dev server middleware.
- `serve.js` — production preview server.
- `deploy/hooks/apache.configure.post.sh` — the deployed vhost.

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
| `eval`, `measure`, `check`, `export` | compute frame |
| `params` | local worker (outside the sandbox) |
| `view` | page, from the live canvas |
| `writeModel` | editor buffer plus a version row |

`params` calls `paramChangeCallback`, which re-runs `jscadMain` on the local
worker. It re-runs whatever that worker last loaded, so it matters once the
user has compiled agent-written source in the editor. `writeModel` only fills
the editor buffer; nothing compiles until the user runs it.

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

Apache serves the built bundle with SPA fallback and proxies `/api` to the
Express service under systemd; `/frame/` is served from the same deploy with
its own header block and no SPA fallback, so a bad path 404s instead of
returning the app. The session cookie is host-only on `jscad.rkroll.com`,
never `.rkroll.com`. `deploy-full.sh` deploys the frontend, then the API, then
checks `/api/health`.

## History

jscad-studio and jscad-studio-run were separate apps on two hosts
(`jscad-studio.rkroll.com` and `run.jscad-studio.rkroll.com`). They folded
into jscad-web on 2026-09-20; the frame moved from its own host to `/frame/`
here, and the sandbox's opaque origin now carries the separation the second
host used to provide.
