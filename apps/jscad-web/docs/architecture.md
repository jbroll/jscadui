# Architecture

jscad-web is the JSCAD editor, viewer and agent chat in one page, with an
Express API beside it and a second origin that runs the models. What follows is
the shape of the thing and the reasons behind the parts that are not obvious.
For how to use it, see the [README](../README.md).

## Pieces

```
jscad.rkroll.com
  page (main.js)            editor, viewer, params UI, chat, project drawer
   ├─ /api  →  Express      auth, sync tokens, provider relay
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

The frame's `connect-src` is `https:` plus the run origin, the app origin, and
localhost in dev. The app origin is named because it serves examples and
models; the `jscad` local build serves it over plain http, which `https:` does
not cover. The list is wide enough that a model can fetch and run code from any https host,
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
from the map (`src_frame/fileMap.js`, over agent-loop's `createReadFile`, which the eval uses too). The app origin's `/swfs/` service-worker
URLs never cross, because a service worker only serves clients it controls and
the frame is not one — that is why the map exists at all, in place of the
serving role a same-origin service worker would otherwise play.

Every compile sends whatever the cache holds, so switching projects empties it
first (`replaceProjectFiles`); otherwise the frame receives the union of every
project opened in the session.

The worker holds one file map, and a load awaits file collection before it
reaches the frame, so two loads can overlap and finish in either order.
`src/scriptRuns.js` sends a script together with its map in one turn, so no
other load's map lands between them, and `main.js` drops any load that a newer
one has started after, before it sends and again before it draws or reports
an error. A parameter change takes a run from the same counter and draws only
if no load or other parameter change started while its `jscadMain` ran; the
redraw after a render-engine switch takes a run the same way. A parameter
change never drops a load, which still has to build the params UI. An `ALL.js`
grid yields between cells, so a newer `jscadScript` can start in the same
worker once the script lock times out; the worker bumps
`__jscadScriptGeneration` and the grid stops at its next cell rather than
share the WASM heap with it.

An OpenSCAD `use`/`include` resolves through `src_frame/scadResolve.js`:
against the directory of the file that asked for it, then against that file's
library root (`/examples/openscad/<library>`) as an OPENSCADPATH-like
fallback. The fallback is dropped when `../` in the filename would resolve
above that root. It is the only copy of this logic; the loader in
`@jscadui/require` has no origin to resolve against inside a blob worker.
`src_frame/scadHandler.js` remembers a failed read for 60 s so one transpile
does not fetch the same missing file for every includer, and forgets them all
whenever a new file map arrives or a cache is cleared.

The transpiler writes each included file's path into a `require()` call, and
`require` resolves a bare path against the script's root. So a file on the
entry's origin, when that is the app or the project, is named by its bare
pathname, and a file on any other origin keeps its full URL. The full URL also
serves as the `fromFile` its own includes resolve against, which keeps them on
their origin. The transpiled-file cache is keyed by full URL, so two origins
with the same path do not share an entry. The transpiler's own cache is keyed
by the names it writes, bare paths included, so the handler keeps one per entry
origin. Keeping bare names keeps project files in `require`'s local cache,
which project switches and edits clear; a full URL would land in its module
cache, which they do not. Both caches empty on `jscadClearTempCache`. An edit
reported through `jscadClearFileCache` drops every project-origin entry, since
an include is inlined into each file that includes it; entries from other
origins, such as a library's, stay. An editor run with no project clears
nothing, so the handler also remembers the source each entry was built from:
an entry whose source differs, or an include whose read differs, is
transpiled again. It also records which files each file includes and the
content last read for each, and a cache hit re-reads the whole include chain.
That covers an include of an include, which the transpiler inlines from its
own cache without reading it. App-origin files are not re-read, since they
change only with a redeploy.

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

Notifications relay the same way. The worker sends two, a grid's
`jscadCells` and `jscadProgress` (see Streamed runs). It also sends
`jscadClaim`, a request with its own id that the frame answers itself and
never relays to the app. `frameWorkerTerminated`
is the only message the frame originates; `frameSetup.js` registers
`jscadCells`, `jscadProgress` and `frameWorkerTerminated` with `messageProxy`.
`handlers.entities` beside it is `main.js`'s own sink, which
it calls directly for restores and cached results as well as for a fresh
render. Job count is not relayed either: the
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
the app sends `timeoutMs: 120000` from `initFrame()`, or the value of the
`engine.modelTimeoutMs` localStorage key when one is set (the render sweep sets
it for every model and grid), and the frame falls back
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
next request builds a fresh worker, which `frameSetup.js` re-initializes (see
the replay below). A
worker that fails to load its bundles takes the same path through `onerror`,
so the app sees the load error rather than a timeout a budget later.

The frame keeps a list of workers: the active one the app's requests go to,
the members of any grid run, and one idle worker kept warm, `poolSize + 1` at
most. `poolSize` defaults to `max(1, min(hardwareConcurrency - 1, 2))`.
Memory sets that limit, not cores. On a 15 GB, 22-thread laptop with about
6 GB in use by other programs, the top-level `ALL.js` at four workers took
available memory down to 0.7 GB and grew swap by 2.8 GB, while the browser's
own resident memory read only 3.5 GB (shared memory for the cell buffers is not
counted per process). Leaves that take under a second alone ran for over a
minute and `sierpinski_pyramid.scad` hit the 120s budget. At two workers the
same grid drew all 835 cells in 610s, with available memory staying above
2 GB. `jscadInit`'s `poolSize` overrides it and the frame strips it, as it does
`timeoutMs`. The app sends it from the `engine.poolSize` localStorage key when
one is set. Each worker holds its own bundles, WASM instances and file map,
which is what bounds the pool's size. Members leave the pool when their run
ends: once a grid run settles, the frame ends every idle worker but one,
without telling the app. The one kept has a WASM heap under the recycle budget
(see Streamed runs), preferring one that holds the current script, then the
smallest heap; when every idle worker is over the budget, none is kept.

Every worker gets a copy of every `jscadInit` (as rewritten), `jscadSetFiles`,
`jscadClearTempCache` and `jscadClearFileCache` the app sends, as the frame's
own requests whose answers go nowhere, but never a script. The frame keeps
those messages in order so it can replay them into a new worker; a new
`jscadSetFiles` drops the file map and cache clears before it, since the map
replaces them, and a new `jscadInit` drops the previous one, so the mirror
holds at most one init. File buffers are copied for each worker rather than
transferred. The frame also records the params of the last `jscadScript` and the last
attempted `jscadMain`, even when that run failed, so an export replays what the
user last set rather than older successful params; a new script clears the
recorded `jscadMain`, since its params belong to the previous model. Each
worker records the script it has loaded (`slot.script`), compared by identity
with that recorded `jscadScript`; a worker without it reloads the script with
`runMain: false` before it runs `jscadMain`, `jscadExportData`, `jscadMeasure`
or `jscadCheck`.

On a kill an idle worker is promoted to active at once, preferring one that
already holds the current script, and a new idle worker is started and set up
from the recorded messages; the app still gets its answers and
`frameWorkerTerminated`. The frame also retires the active worker without
telling the app when an answer it relays has `error.name === 'RuntimeError'` or
`trapped: true`: a trapped WebAssembly instance is not trusted with the next
run. The retired worker's other requests are answered `AbortError` and an idle
worker is promoted the same way. If no replacement worker can start, the old
worker keeps serving instead of leaving the frame with no active worker. A promoted worker has the setup but no model,
so before it runs `jscadMain`, `jscadExportData`, `jscadMeasure` or
`jscadCheck` the frame sends it the last script with `runMain: false`, and for
the last three also the last `jscadMain` with `stream: false`, since they read
that run's solids. The replay carries neither the app's `held` nor its `runId`:
the worker must not hash meshes for an answer the frame drops. Progress posted
during the reload is relayed and restarts the kill timer, so a large export
cannot time out for lack of beats; cells are dropped, since no app run waits on
them, but still restart the timer. When no `jscadMain` has run since that script loaded,
those three reload it with `runMain: true` instead, so the load's own run
provides the solids; a grid streams its cells, which the frame drops because no
app run is pending, and `withSolids` re-runs it as it does after any grid.
Requests that arrive meanwhile wait behind the reload in order; a reload that
fails answers the request with its error. A reload script step that traps
retires the worker at once instead of running the queued requests on the
trapped worker; a main replay step that traps still lets the request it was made
for run, so a model whose run traps can still be exported, and the next app run
that traps retires the worker. A `jscadScript`
from the app loads the worker itself and skips this, including while it is
still running, since it is the model the app expects. The cost is each idle
worker's memory: the loaded bundles, WASM instances and file map, held from the
first script onward. The frame also keeps its own copy of the last file map in
its list of mirrored messages, so a project's files are held once per worker
plus the frame's own copy. A promotion costs a script load, and since the
transpile cache lives in each worker, the promoted worker transpiles the
model's OpenSCAD includes again.

A warm worker exists so that a trapped WebAssembly instance or a run the user
has moved past can be dropped at once. Without one the frame could only wait
for the run to finish or kill the worker, and a kill costs a cold start:
bundles, WASM and the replay.

A load, a parameter change and a render-engine redraw send `supersede: true`
with their `jscadScript` or `jscadMain`. When one arrives while the active
worker has an app `jscadMain` or `jscadScript` it started at least 500 ms ago
(`ABANDON_AFTER_MS`, defined in `src_frame/constants.js` and re-exported from `src_frame/frameHost.js`), the frame answers
that request and every other app `jscadMain` or `jscadScript` on the worker
`SupersededError` and, unless an export, measure or check is in flight, retires
the worker the same way as a trap and sends the new
request to the promoted worker, after the reload for a `jscadMain`. An export,
measure or check is never superseded: the stale runs are answered, the worker
is kept, and the new request queues behind the export instead of aborting it. When every
pending run is younger, they are left alone and the new one queues behind them
on the same worker, since starting over costs more than the rest of a short
run. A `jscadMain` never abandons a pending `jscadScript`: the run queues behind
the load instead, and a newer superseding run replaces the queued one, since the
worker would otherwise run each 500 ms update in full. The
retired worker's other app requests are answered `AbortError`, except setup
(`jscadSetFiles` and the other mirrored methods) that the promoted worker also
received, which is answered with the promoted worker's answer to its copy. The
frame strips `supersede` before the message reaches a worker.

After a promotion a run waits behind the reload, and the app, seeing that run
in flight for 500 ms, sends another superseding run every 500 ms while it
waits. So a superseding request also answers `SupersededError` to every app
`jscadMain` still queued behind a reload and removes it; none of them has
started, so nothing is retired. A queued `jscadScript` stays, as a pending one
does, and so does a queued `jscadMain` that a queued export, measure or check
after it will read. On the app side, `runModelUpdate` and `runParamChange` (`src/paramsUI.js`)
share one work token and keep coalescing updates while a run
younger than 500 ms is in flight, and send the new run at once when it is
older. Each path drains the other's queue on settling, so neither strands the
other. A rejection named `SupersededError` sets no error, and a run a newer one
replaced draws nothing.

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

Either way the new worker starts empty, and a parameter change or an export
would run against no model; an export would serialize an empty scene and
report success. So `frameSetup.js` records what set the worker up, from
successful calls only: the `jscadInit`s (the last one naming an engine, every
alias, and the latest), the last `jscadSetFiles`, the last `jscadScript`, and
the params of the last `jscadMain` after it. On restart it replays them in that
order, and any request made meanwhile waits for the replay. A script that
failed or timed out is not replayed, and neither is one whose replay fails. A
replay request answered by a kill ends the replay, and the restart that kill
reports is not replayed, so a budget too small for the replay cannot start a
loop. Until an init naming an engine succeeds, the replay retries the last one
attempted. Nothing else re-inits on a restart: `main.js` used to send
`jscadInit` on every `frameWorkerTerminated`, and when that init was what
timed out (a 1 ms budget, or a worker that cannot load) each restart caused
the next, about one `setError` every 2 ms for as long as the page was open.
In
those cases `jscadMain`, `jscadExportData`, `jscadMeasure` and `jscadCheck` are
refused with "the model stopped and could not be reloaded" until a script loads
again.

### Why a blob worker

A frame with an opaque origin cannot construct a `Worker` from a URL, and
relative `importScripts` fails inside a blob worker. So the frame builds a
two-line blob that sets `__BUNDLE_BASE__` and `importScripts` the real bundle
(`src_frame/blobWorker.js`). The worker's blob URL is revoked when the worker
is terminated, since the pool starts and retires workers as runs come and go.
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

### `%` and `#` ghosts

A transpiled OpenSCAD `main()` returns `[solid, ...ghosts]` when the model
uses `%` or `#`. Ghosts are plain geom3/geom2 objects with `previewOnly: true`
and a translucent color (background grey, highlight pink). The worker draws
them as entities but keeps them out of `workerState.solids`, so export never
sees them; `run-jscad.js` and grid cells drop them the same way.

### Geometry caps

Geometry from the frame is untrusted input, so `src/caps.js` bounds it before
the first allocation for drawing: 256MB of buffers and 2000 entities. Over a
cap is a model error, not an allocation. There is no separate vertex cap: a
vertex costs at least 12 bytes, so the buffer cap bounds vertices at about 22M,
and an 8M one refused whole-library `ALL.js` grids that were genuine geometry.
Manifold meshes arrive indexed without normals: about 18 bytes a triangle for
a typical mesh (about half a vertex, 12 bytes, plus 12 bytes of indices), so
the 256 MB cap covers about 15M triangles. A streamed run, a grid or a
multi-part model sent with a `runId`, is capped per batch at `DEFAULT_CAPS`
(256 MB, 2,000 entities) and in total at `STREAM_CAPS` (1.5 GB, 20,000
entities); see Streamed runs. A load the caps refuse is a failed build, so
the chat's build report cannot say a model built when nothing was drawn.

### Indexed meshes and GPU normals

A Manifold mesh expanded to three vertices a triangle with a normal each costs
84 bytes a triangle; indexed without normals it costs about 18. So both
viewers set `supportsGpuNormals`, and the app passes `useGpuNormals` with each
load and render-engine redraw; the worker keeps it for later runs. It makes `ManifoldGeom3` return Manifold's own indexed
mesh (`vertProperties`, `triVerts`) with no `normals`. Manifold interleaves any
extra vertex properties after x, y, z, so the raw mesh keeps only the first
three. `format-threejs` gives a mesh with no normals a `flatShading: true`
material, and three.js takes the face normal from screen-space derivatives, as
regl already did; meshes with normals keep the smooth-capable material, and the
smooth option computes normals from positions with `toCreasedNormals`. Plain
jscad geometry is already indexed and keeps its CPU normals.

Nothing outside the viewers reads the render layout. Export, measure and check
work from the solids' `polygons`, which the flag does not change, and
`exportStlText` computes each facet normal from the triangle's positions and
ignores any `normals`.

### Streamed runs

An `ALL.js` grid does not return its geometry. While the worker runs a model's
`main`, for a load or a `jscadMain`, it sets `globalThis.__jscadStream`, and
the grid emits each placed cell through it as a `jscadCells` notification
(`{ entities, runId }`), then disposes the cell. The result is
`{ entities: [], streamed: true, runId }`, where `runId` is the one the app
sent in the request options.

A model that is not a grid but still returns more than one solid streams too,
as long as the request carries a `runId`: the worker posts each solid as its
own `jscadCells` batch, in the order `main` returned them, after `main`
returns rather than as it runs. Unlike the grid case the worker keeps the
solids afterward, so export, measure and check need no re-run for this path.
Each batch holds one solid, so instancing only groups matching geometry within
a batch, not across the model's parts.

A generated `ALL.js` is an item list plus one call,
`gridModule(items, { spacing, cellSize }, require)`, from
`examples/lib/grid-utils.js`, which holds the loop, name deduplication,
failure markers and trap handling that used to live in the generated template.
The file's own `require` is passed in so item paths resolve against the grid's
directory. `main` takes `globalThis.__jscadStream`, hides it from leaf code
while it walks the grid, and restores it after. Grids are gitignored build
artifacts, never tracked: `organize-corpus.js` regenerates them with
`--no-rename` after batching, as do `deploy-full.sh` and `npm run
generate-all`.

A sub-grid, an item that is itself a grid, runs its own leaves under a world
transform, `ctx · translate(x, y) · scale(s)`, where `s = cellSize / max(width,
depth)` and `width` and `depth` are the sub-grid's extent, which follows from
its item count alone (`gridExtent`); a sub-grid module that exports no
`extent` is fitted to the cell as if it were one item. So every leaf streams on its own, and the
per-cell budget applies to a leaf, not to a whole sub-grid. A sub-grid whose
leaves are all small or flat is placed slightly differently than it was when
it arrived as one normalized cell. Failure markers take the same transform.

With `claims: true` in `jscadInit` (the frame always sets it), the stream hook
gains `claim(key, url)`. A leaf's key is its index path (`"2/14"`); item lists
are static, so every worker in a run computes the same keys. The grid claims
each leaf before running it and skips one it loses without requiring it; a
sub-grid is walked by every worker regardless of claims, so every worker
requires every grid file in the tree but transpiles only the leaf files it
wins. A sub-grid whose grid file fails to load is claimed under its own key
before it is marked, so only one worker draws its skull and logs the failure.
A `stream: false` run, such as export's re-run or an animation frame, has no
claim hook and runs every leaf itself, as does the chat's scratch `run`,
which calls `main` without the stream hook.

Every streaming `jscadMain` or `jscadScript` is a run. Its first won claim
fans it out: the same request goes to up to `poolSize - 1` more workers,
which join late and take whatever keys are still open. A worker joining a
`jscadMain` run loads the newest `jscadScript` the frame had relayed when that
`jscadMain` arrived (`sentScript`), not necessarily the last script that
finished loading, since a load can still be in flight when the run starts; a
load that answers with an error resets `sentScript` back to the last good
script. A `jscadCells`
notification is relayed only when its `runId` names an open run the sending
worker still belongs to; relaying one clears that member's current leaf, so a
worker lost afterward is not reported as having lost it. The app gets one
answer, once the run's last member has answered: the primary member's answer
merged with `entities: []`, `streamed: true`, `runId`, `lost`, and the params
every member discovered (`src_frame/mergeProxyStates.js`), since each worker
discovers only the leaves it ran itself. Members merge in claim order, the
frame's view of grid order — each member is ranked by its first won claim, so
the params UI keeps its shape between pooled runs instead of following answer
arrival. The primary claims before the run fans out, so it stays first. A run
nobody claims into behaves as a single request, as before.

Losing a member: a trap or a timeout stops only that member. The frame
retires it and, while the run is open, adds a replacement that joins late. A
trapped member always gets one, since it stops walking the grid after its
trapped leaf streams a skull; a timeout or other loss gets one only when the
member was on a leaf. A timed-out member's current leaf is freed for re-run
once, so a replacement can claim it and its cells and params still arrive; the
leaf goes into `lost` only when no replacement claims it, or when the
replacement loses it too, which `streamRuns.js` reports as an error while
keeping the cells already drawn. `frameWorkerTerminated` is posted only when
no member remains and none can start.

Recycling a member: a WebAssembly heap grows and never shrinks, so each worker
keeps the heap of the largest leaf it has run, and the pool's memory is the sum
of those high-water marks. Measured with `e2e/grid-memory.mjs` on NopSCADlib's
tests grid at pool 4, the worker heaps reached 1.56, 1.09, 0.96 and 1.32 GB (4.9
of 5.3 GB total), and the top-level `ALL.js` on a 22-core, 15 GB laptop grew to
9 GB and stalled. Every claim carries the worker's heap size (`slot.heap`). A
member that claims with a heap of at least `RECYCLE_HEAP_BYTES` (1 GiB,
`gridRun.js`) after it has won a leaf in the run is marked to recycle: that
claim and every later one is refused, and its timers restart as for any claim.
When it answers, the frame retires it and, while the run is open, adds a
replacement that joins late, as for a trap. The won-a-leaf guard keeps a fresh
worker that starts over budget from being recycled before it makes progress.
The cost of each recycle is a worker start, a script reload, and the model's
OpenSCAD includes transpiled again, since the transpile cache lives in the
worker. A `stream: false` run makes no claims and is never recycled.

Supersede: a superseding request answers a fanned-out run `SupersededError`
at once, closes it to claims and stops relaying its cells; a member on a leaf
it started at least `ABANDON_AFTER_MS` ago is retired, and the rest finish
their leaf, find later claims refused, and go idle. A superseding request
also closes a run that has not fanned out yet, without answering it, so an
old grid can no longer fan out once it is superseded. The ordinary supersede
rules answer that request instead. A superseding `jscadMain` leaves a grid
load alone either way, and never retires a worker still holding a pending app
`jscadScript`.

The frame's side of this splits across four files: `src_frame/workerSlot.js`
(a worker's own start, request tracking, timers and end), `workerPool.js`
(the worker list, idle workers, promotion, setup replay, reload), `gridRun.js`
(fan-out, claims, lost leaves, recycling, finishing a run) and `frameHost.js` (message
routing, the `jscadInit` rewrite, the supersede entry points).

A cell that fails draws a skull and crossbones: `examples/lib/skull.svg` as an
upright relief facing the default camera, an off-white plate with the black
linework standing proud of it. `examples/lib/build-skull-mesh.mjs` turns the
drawing into triangles at build time (manifold-3d cross-sections: each stroke
is outlined at its width, and a later white fill hides the lines it covers) and
writes them to `examples/lib/skull-mesh.js`; re-run it whenever `skull.svg`
changes. At run time no boolean runs. `failureMarker()` colours the two stored
meshes with the model's library, so on manifold they become two manifolds.
Once `__allWasmTrap` is set, or when `failureMarker()` or placing it fails, the
grid uses `prebuiltSkull()` instead: the same two meshes as plain geom3s with
the cell placement in their `transforms`, which need no WASM. It returns an
array, so the grid's `[prebuiltSkull(...)]` is nested; the stream hook and the
worker's result both flatten it.

Export, measure and check need the solids. A grid run disposes each cell as it
streams, so when the last run was a grid they re-run `jscadMain` with
`stream: false`, `solidsOnly: true` and with `__jscadProgress` set, which posts one
`jscadProgress` per cell. `solidsOnly` skips the mesh conversion: the export
reads the solids back out, so entity arrays would be built only to be
discarded, at grid-scale memory cost. Manifold evaluation still runs, warming
the cache the serializer reads. Export skips its `$preview` re-run for a streamed
grid, since the grid is re-run for the export anyway. The re-run holds the
whole grid's solids in memory again, so exporting a large streamed grid can still fail.
The worker answers concurrent requests freely, so concurrent re-runs serialize
on a shared promise chain in `withSolids.js`: each runs whole before the next
starts, since they share `__jscadProgress` and the solids store.
Animation frames also run with `stream: false`, since each frame draws the
result it returns.

The frame relays `jscadCells` only while a `jscadScript` or `jscadMain` request
is pending and `jscadProgress` only while a `jscadExportData`, `jscadMeasure`
or `jscadCheck` request is; any other worker post is still dropped. Each
relayed message restarts every pending request's kill timer in the frame, and
`proxy.resetTimeouts()` restarts the app's RPC timers, so the model budget
applies to one cell rather than the whole grid.

`src/streamRuns.js` holds one run at a time. A load, a parameter change, a tree
update and the redraw after a render-engine switch each begin one with a fresh
`runId` and their `scriptRuns` staleness check, and send that `runId` with the
request. Notifications carry no request id, and an older request keeps
emitting until the worker stops it, so the tag is what separates runs: a batch
is accepted, and a streamed result finishes the run, only when its `runId` is
the current run's and the run is not stale. Anything else is dropped and leaves
the current run alone. Run ids are random UUIDs, so model code sharing the
worker cannot guess one: a spoofed batch names no open run and drops without
restarting the kill timers. A `frameSetup` replay re-sends requests with the
`runId`s they first carried, whose runs are closed, so its batches are dropped
too. A result that is not streamed discards the open run without drawing, so a
pending redraw cannot paint over it. Model code can post its own `jscadCells`,
so a batch is untrusted: a `vertices`, `indices`, `normals` or `colors` field
that is not a typed array is a model error, since the byte cap counts only
typed arrays and a fake `length` would stall the counting and bounding-box
loops. Each batch is then checked against the per-batch caps (256 MB, 2,000
entities) and the run's total against 1.5 GB and 20,000 entities. Any failure,
including a throw while counting, ends the run with the error before the batch
is added and leaves the drawn cells in place, as a kill does.

Redraws coalesce to one per 250 ms and pass the run's whole entity array, which
starts empty, so the first redraw replaces the previous model. The three.js
renderer keeps built objects keyed by entity object across `setScene`, so each
redraw builds only the new cells. `render-regl`, which is not the default,
still rebuilds everything on each redraw, bounded by the 250 ms coalescing.
With zoom-to-fit on, the camera fits the
running bounding box. The final `streamed` result draws what is pending, sets
`data-vertices` from the running count and clears the error. `data-cells`
counts accepted batches for the render sweep's per-cell hang guard.

### Mesh reuse

Nothing produces the same geometry objects across runs: plain jscad, Manifold
and the OpenSCAD runtime rebuild every part, so reuse is by content, not by
object. `src/meshRefs.js` keeps the meshes the last completed run drew, keyed by the
`hash` the worker puts on each mesh, plus the previous map: a `remember` from
an animation frame no longer strands an in-flight run's
refs, which resolve against the map before it. Every request that carries a
`runId` also
sends `held`, the list of those hashes, and the worker sends a mesh whose hash
is listed as a `ref` with no buffers (see `docs/WORKER_PROTOCOL.md`). The worker
hashes meshes only for a request that carries `held`, so a run without it (an
animation frame) returns meshes with no `hash`. The app
resolves each ref before the cap checks, in both the whole-result and the
streamed path, so a resolved mesh's bytes count toward the caps as if the
worker had sent them. A ref whose `color`, `transforms`, `isTransparent` and
`opacity` all equal the held mesh's, compared element by element, resolves to
the held entity object itself. The three.js renderer keys built objects by
entity object, so that mesh is not rebuilt, and the same held entity twice in
one scene reuses the one built object. A ref that differs in any of them
resolves to a new entity with the ref's values and the held mesh's buffers,
so the renderer builds a new object but the buffers are not copied again. A
ref to a hash the page does not hold is a model error.

The map is replaced only when a run completes: after a whole result is drawn,
or after a streamed run finishes, with the entity array it last drew. A
streamed run's later batches still refer to the previous run's meshes, so it
must not be replaced mid-run, and a run that ends in an error leaves it as it
was. Loading a different script URL and switching the render engine clear it.
`render-regl` rebuilds every entity on each draw, so it gains nothing from
reuse beyond the smaller messages.

## Demo menu

Browse Demos (`src/demoBrowser.js`) walks `examples/` one directory at a time.
It reads `examples/manifest.json`, which `src_build/genExamplesManifest.js`
writes at build time: each directory's URL pathname maps to `{ dirs, files }`,
with `exclude.txt`, `skip.txt` and `lib/` directories already applied.
Production Apache has autoindex off, so without the manifest the menu has
nothing to read. When there is no manifest, the menu parses the server's live
directory listing instead (`src/directoryParser.js`), which applies no
exclusions.

A directory with no files and exactly one subdirectory is skipped: the menu
opens the subdirectory, and the breadcrumb shows the chain as one crumb
(`dotscad/examples/`, `nopscadlib/NopSCADlib/tests/`). These levels come from a
library's include layout, and the files cannot move without breaking includes.
The skip happens in the browser, not the generator, so the manifest stays a
plain copy of the served tree and the same rule applies to a live listing. With
a live listing a library's source files show up, so its directories are not
pass-throughs and the menu shows every level as before. File URLs stay the
real paths.

A directory can group its models with a `categories.json`,
`{ "<category>": ["<model base name>", ...] }`. The manifest then lists one
virtual subdirectory per category, in the map's order, ahead of the real
subdirectories. Grouped models leave the parent's listing, and a category
whose models are all skipped is left out. A virtual entry carries `href`, a
map from each listed name to its URL relative to the virtual directory
(`"box.scad": "../box.scad"`). The menu resolves a name through `href` when
present, so loading a model loads the real file. An entry without `href`
behaves as before. `generate-all-files.js` writes one grid per category,
`ALL.<category>.js`, next to the models so its items stay `./name.scad`. The
manifest lists it as `ALL.js` inside the category, and the directory's own
`ALL.js` aggregates the category grids. NopSCADlib's 148 tests are the one
user: `apps/jscad-web/test/nopscadlib-categories.test.js` fails when a test is
missing from the map or listed twice, so a refreshed vendor copy cannot drop
models from the menu.

## Agent loop

The loop runs in the browser (`packages/agent-loop`), not on the server. The
page holds the conversation, calls the provider, and serves each tool request
itself through agent-loop's `dispatchTool`, called from `main.js`. Provider HTTP goes through `/api/relay` on
the origin `build.js` stamps in as `__RELAY_ORIGIN__` (`src_build/relayOrigin.js`):
the app's own origin for a deployed or `jscad-chat` launcher build, production
for the `:5120` dev server, `RELAY_ORIGIN` when set, and
`localStorage['jscad-ai.relay']` overrides all of them. The relay exists only
because providers do not send CORS headers; it keeps no
session and no storage, checks the caller's origin, resolves the upstream host
at forward time and refuses private addresses. Browsers send no `Origin` on a
same-origin GET, so the model-list GET from the app's own origin passes on
`Sec-Fetch-Site: same-origin` instead. It forwards an allowlist of
headers (content type, accept, provider auth and version, the opencode
session), so the session cookie never reaches a provider.

Two relays implement this: production's Express routes (`server/src/relay/`)
and the `jscad-chat` launcher's `node:http` handler. Both take the header set,
origin rule, default allowlist, allowlist validation, sub-path join,
private-address check and token-bucket limiter from one file,
`server/src/relay/policy.js`. It lives in the server tree because the server
builds and deploys on its own with `tsc` and cannot import from outside it,
and it is plain JS with JSDoc because the launcher runs under plain `node`,
which cannot load the server's TypeScript. The server's `tsconfig.json` sets
`allowJs` and `checkJs`, so `tsc` type-checks the file and emits it into
`dist/`. `scripts/local/relay.test.js` fails if agent-loop's
`PROVIDER_BASE_URLS` or the account dialog's provider list drifts from the
shared default allowlist. The limits differ only in burst: 10 per client in
production, 60 for the launcher's one user.

The `jscad-chat` launcher's relay (`scripts/local/relay.js`) also appends each
forwarded POST to `<dir>/YYYY-MM-DD.jsonl` (`chatLogDir` in
`packages/agent-loop/log/log-dir.js`: `<jscad-chat-evals clone>/logs` when
that repo is cloned at `~/src/jscad-chat-evals` or `$JSCAD_CHAT_DATA`, else
`~/.local/state/jscad-chat/logs` with `$XDG_STATE_HOME` when set;
`JSCAD_CHAT_LOG=<dir>` moves it regardless, `=0` turns it off): time, the
`x-jscad-chat-id` header the chat sends, provider kind, sub-path, status, the
request body without `tools`, the response text and the elapsed ms. Headers
are never written. The response is teed while it streams, and a failed write
warns once without failing the request. The relay forwards with undici's own
`fetch` and an `Agent` whose header and body timeouts are 15 minutes
(`PROVIDER_BODY_TIMEOUT_MS`): a reasoning model can send nothing for longer
than undici's default 5. A stream that fails after the headers went out (that
timeout, a dropped connection) cuts the page's response off and logs an
`error`; a page that
closes aborts the upstream request. `server.js` answers 500 to any handler
that throws, so one bad request cannot end the launcher. Neither relay forwards
`x-jscad-chat-id`, and the production relay does not log.

Each turn sends `buildMessages` (`packages/agent-loop/src/context.js`): the
system prompt; prior turns, newest first, as whole user/assistant pairs until
the next would pass `CONTEXT_BUDGET` (24,000 characters); one user message
holding every text file of the current project under `### <path>` in a fenced
block and then the project's last build report, outside the budget and
omitted when both are empty; then the new message. Prior turns carry only the user text and
the assistant's streamed text, so earlier tool calls are not replayed. The
transcript also stores the reply's reasoning, which `forModel` in
`src/aiChat.js` drops before `buildMessages` sees it. The
project files come from the file cache the frame runs (`fileSystem.projectFiles`).
The chat sends its per-project session id as `x-jscad-chat-id` when it goes
through the relay, and not to a custom base URL. The eval builds its messages
with the same function.

Chat settings live in the drawer's gear dialog (`src/aiAccount.js`), in the
order a user fills them: provider, API key and its custody mode, model, effort,
then base URL under Advanced. Saving a key, changing the provider or changing
the base URL GETs `/v1/models` through the relay (or `{baseUrl}/v1/models`) and
fills the model select; the status line under it shows the count or the HTTP
failure, and a custom model id stays available either way. Effort options come
from `src/aiEffort.js`: Anthropic's list carries per-model effort support, the
other kinds get their documented level set, and Meta Muse models drop `none`,
which Meta answers with a 400.

### Chat UI states

While a turn runs, `initChat` (`src/aiChat.js`) turns the Send button into
Stop: its label, its `aria-label` (`Stop the reply`), the `running` class
with a pulse that `prefers-reduced-motion` turns off, and `type="button"`, so
it is no longer the form's default button. A status line above the input
shows the phase `runTurn` reports through `onStatus` and the seconds since the
turn began, redrawn once a second:

| Phase | Status line |
|---|---|
| `thinking` | `Thinking…`, plus `~N tokens` when the provider streams its reasoning (characters / 4) |
| `text` | `Writing…` |
| `tool` | the tool and its path, query or format: `write main.js…`, `docs params…`, `measure…` |
| `retry` | `Provider busy, retrying (2/4)…` |

Only the phase text is `aria-live="polite"`. The seconds and the token count
sit in an `aria-hidden` span, so a screen reader hears each phase change and
not each tick. The line empties when the turn ends.

The input stays editable during a turn. Enter submits the form, which a
running turn ignores, so the next message waits in the input.

The message list shows each kind of row differently, light and dark alike
(`--chat-*` variables on `#ai-chat`, redefined under `.dark`):

| Row | Element | Look |
|---|---|---|
| User message | `.chat-msg.user` | right-aligned bubble tinted from the drawer's blue toggle |
| Reply text | `.chat-msg.assistant` | plain text on the panel |
| Reasoning | `<details class="chat-reasoning">` | smaller muted text behind a thin left rule, collapsed |
| Tool call | `<details class="chat-tool">` | one monospace row: tool, its path, query or format (`toolDetail` from agent-loop), and `…`, `ok` or `failed`; opening it shows the input and the result |
| Error | `.chat-msg.error` | red-tinted block with a red left rule |
| Stopped | `.chat-msg.stopped` | small muted italic `Stopped`, not an error |

A tool row is `failed` (red rule and text) when the tool threw or answered
`{ ok: false }`, as an object or as JSON text.

Reasoning arrives through `runTurn`'s `onReasoning`. The first delta of a
model step opens a reasoning block above that step's text, its summary
`Thinking… Ns` counting from that delta on the status line's ticker; the
text streams into it, visible when opened. The block ends, and its summary
becomes `Thought for Ns` (at least 1), when the step's text or tool call
starts, the next request starts, or the turn ends, fails or is stopped.
Each step gets its own block. The summary is a native `<summary>`, so it
takes focus and opens with Enter or Space; the block is not `aria-live`, only
the status phase is. The reply is stored as `{ role: 'assistant', content,
reasoning: [{ text, seconds }] }` (with `stopped: true` for a stopped one;
no `reasoning` key when there was none), so a resumed conversation shows
each step's block, closed, above the reply text. Tool rows are not stored,
so after a reload the blocks of a turn sit together above its text.

Stop aborts the turn's `AbortController`, and `runTurn` rejects with
`AbortError` at once, whether it was waiting on the provider or on a tool. The
chat keeps the streamed text, adds a `Stopped` marker, and stores the reply as
`{ role: 'assistant', content, stopped: true }` (plus its `reasoning`), so a resumed conversation
shows the marker too. The next turn sends it to the model as its text followed
by `[stopped by the user]`, or the note alone when nothing was said, since
providers refuse an empty assistant message. `endTurn` still runs, so the
writes the turn made get their version. A tool call already running is not
cancelled: its line fills in when it answers, and a write it stores after the
snapshot is versioned with the next turn.

### API style

The chat teaches one modeling API: `fluent` (`@jbroll/jscad-fluent`, the
default) or `modeling` (`@jscad/modeling`), with `@jscadui/jscad-text` in
both. Teaching one keeps a model from calling fluent methods on plain
modeling geometry, which the two-API prompt invited. `getChatApi()` in
`src/aiAccount.js` reads it per turn from the selection's `api`, falling back
to `DEFAULT_API`; a settings radio button will write it there. From there it
flows two ways in `main.js`: `initChat({ getApi })` builds the turn's system
prompt with `buildSystemPrompt(api)` and passes `api` to `runTurn`, which
sends `buildTools(api)`; and the `docs` dependency (`createDocs` in
`src/apiIndex.js`) calls `docsTool(index, query, { api })`, which answers only from that API's
index entries and jscad-text's, and points a query for the other API at its
equivalent or says it is not available. The runtime does not change: model
code may still require either package. Warnings and error hints name only the
chosen API's form: every load, the editor's and the chat's builds alike, and
the chat's `run` send it with the files (`jscadSetFiles({ files, api })`), so
the mirrored and replayed `jscadSetFiles` always carries the current style,
and the frame worker passes it to the run's warning collector (`setApi`).
`createProjectBuilds` and `createProjectTools` take it too, for the error
hints agent-loop's `reportError` adds. The
eval sets the same value with `EVAL_API` and hands it to
`createEvalBackend({ api })`, where the docs answer and the warnings for a run
are built (`packages/agent-loop/docs/user-manual.md`). A shared case table,
`packages/agent-loop/test/warningCases.js`, runs through the eval backend and
through the app's `run` and build report over the frame's option-checked
modules, so the two give the model the same warnings and hints.

Tools and where they run:

| Tool | Runs |
|---|---|
| `list`, `read` | page: the project's file cache, through agent-loop's `listFiles` and `readFile` |
| `write`, `edit` | page: the file cache and the editor (`applyWrite`, `applyEdit`), then a build of the project in the compute frame; answers the build report |
| `run` | compute frame: a scratch run beside the project's files that leaves the project, its build and the drawn model alone |
| `measure`, `check`, `export` | compute frame, on the current build |
| `docs` | page: `docsTool` over `@jscadui/agent-loop/api/index.json` for the chat's API style, no frame round trip |

The index (about 260 KB) is not in the app entry: `build.js` bundles it as
`build/bundle.api-index.js` (content-hashed like the other leaf bundles), and
`src/apiIndex.js` imports it on the first `docs` call or the first model error
that needs a hint, then keeps it. A failed load is retried on the next call;
an error goes out without its hint meanwhile.

The agent works on the open project's files: the file cache every run sends
the frame (`fileSystem.projectFiles`), which `switchProject` refills and the
editor's own run of a project file writes to. `src/aiDeps.js`
(`createProjectTools`) reads it at each call, so it follows project switches
and the user's edits, and answers through the helpers the eval's backend
uses, so a tool answers the same way in both.

A `write` or `edit` is a save. It puts the file in the cache, clears the
frame's copy of that module, shows the file in the editor, then builds the
project and answers the build report. The build is `buildProject` in
`main.js`: the entry, resolved by `projectEntry` (`src/projectBuild.js`), runs
through `jscadScript`, the load path the editor and a project switch take, so
a chat build draws, builds the params UI and shows its error like any other
load. `projectEntry` is agent-loop's `resolveEntry` (package.json `main`, else
`index.js`, else `main.js`), falling back to the entry the project declares
when none of those exist: a dropped folder's `fileToRun` or a stored
project's `entry`, both named by the drop rules (`index.ts`, `<folder>.js`).
The editor's run and a project switch also name the file they open (the
edited file, or the stored `entry`). That file runs instead when it is a
model of its own: it exports a `main`, and the entry neither requires nor
imports it, directly or through other files. A stored project can hold such
models beside `main.js`: a folder dropped on its row, or a second model the
chat wrote. An editor run of one records it as the project's `entry`, so the
project reopens on it. The chat's builds name no file and always run the
Node entry, the one the prompt teaches. A project with no entry shows
`NoEntryError` in the error bar and reports `ok: true, entry: null` with
`note: "no entry yet (…)"` to the chat (`noEntryReport`), since a helper
written before its entry is no failure. A chat write answers the report
headed by `saved` (`writeReport`). Files the chat writes into an empty cache are the open
project from then on.

`createProjectBuilds` (`src/projectBuild.js`) keeps the report of the last
build, whichever of those started it: `jscadScript` records each load's
outcome, and a load of anything else (an example, a remote model) drops it,
since the frame no longer holds the project's model. The report is built
only when asked for, with `jscadMeasure` and `jscadCheck` for its geometry, so
the editor's own runs cost no measure or check unless the chat reads them. A
write's build asks at once; the chat asks at the start of each turn and sends
the report after the project files (`buildMessages({ build })`). A failed
load's error carries the run's console and warnings (`output`, see
`docs/WORKER_PROTOCOL.md`), and agent-loop's `reportError`, the eval's too,
drops the worker's
`jscadMain failed: ` prefix, adds the hint for the chat's API, and finds the
file, line and column in the stack or, for a syntax error, in Babel's message.
agent-loop's `assembleReport`, which the eval's builds go through too, puts
the report together from that error or from `jscadMeasure` and `jscadCheck`.

`measure`, `check` and `export` run only on a build that succeeded. Before
any build, or after a failed one, they answer agent-loop's `noGeometryError`,
which names the failed build's error, as the eval does. `measure` and `check`
results carry `ok: true` and `units: "mm"` (`withUnits`).

A failed build keeps the last good render on screen: a load draws only what
it returns, so a failure leaves the viewer as it was and shows the error bar.

`run` sends its source as `__run__.js` (agent-loop's `RUN_FILE`) beside the project's files, with
`scratch: true` on its `jscadScript`. The worker runs it and its `main`
(a project file's `main(values)` the snippet calls gets a build's params
proxy with those values set), and answers the console, the warnings, an error, and `summarizeRun`'s `geometry`
or `returned` preview, then puts the loaded model back: its module, `main`,
solids, parameter state, cached project modules and jscad-text state. Every
load, a build or a run, starts with jscad-text reset and then initialised
with the engine's `@jscad/modeling` (`modelIsolation.js`'s `setUp`, through
the worker's `setModelIsolation`; the first require of it is set up the same
way), so `text2d` needs no `init`, and whatever a run did to it never reaches
a later build. The frame and the app's replay keep the model's
script and file map for a restarted or promoted worker
(`docs/WORKER_PROTOCOL.md`), a scratch run the frame killed included. A
scratch `jscadScript` gets 30 s of the model budget (`workerSlot.js`, agent-loop's
`RUN_TOOL_TIMEOUT_MS`); past it the frame kills the worker as for any
timeout, and `aiDeps.js` answers the `TimeoutError` with agent-loop's
`runTimeoutError()`, the eval's words. Nothing is drawn or saved. The editor's own runs
do not set `scratch`, so a user's script with no `main` shows `no main
function exported`.

Storage gets one version per chat turn, not one per write. Each write is
stored at once, in the project it was made in, with no version row
(`writeThrough` with `version: false`), before its build: a reload mid-turn
loses nothing, and a load's rowboat merge finds the stored copy current. When
the turn ends, however it ends, `initChat`'s `endTurn` snapshots each project
the turn wrote to (`snapshot`, a version row of what the backend holds). The
snapshot reads storage, not the turn's writes, so a user's editor edit made
during the turn, stored after the chat's write, is what the version keeps.

With no service worker the file cache is an in-memory map in
`src/fileSystem.js` (`projectFiles`), so a project switch, an editor run and
the chat's builds still run.

`view` (page, from the live canvas) is not offered to the model: its PNG data
URL gets JSON-encoded into a text tool result that no provider adapter turns
back into an image block, so the model never sees a picture, only hundreds of
KB of base64 text. The handler stays for other callers.

`export` answers `{ ok, format, size }` (`src/aiExport.js`): the model learns
the export worked and how big it is, and the bytes stay out of its context.
The tool's `stl` asks the frame for binary STL (`stlb`), and a format with no
serializer is refused before the frame is asked, with agent-loop's
`exportConfig`, the check the eval makes.

The eval's backend answers every tool as the app does. Both route calls
through `dispatchTool`, assemble reports with `assembleReport`, format model
errors with `reportError`, load project files with `createReadFile` under
`PROJECT_BASE`, and transform by the worker's `shouldTransform`, one copy of
each in `packages/agent-loop` (the last in `packages/worker/src`). They differ
only in how the model runs: the frame worker here, `@jscadui/require` in a
Node process there. The `ai-chat` e2e runs
one set of calls through the app, on the jscad engine, and through
`createEvalBackend`, and compares the results. The worker's no-main error
(`NoMainError`) and format-jscad's `invalid jscad geometry, not an object` are
reported with the eval's wording (`noMainError`, `notGeometryError`) in
`createProjectBuilds`.

### Unknown-option warnings

A modeling function ignores an option it does not know, so
`roundedCuboid({ radius: 2 })` keeps the 0.2 default without a word. Model
code gets a copy of `@jscad/modeling` and `@jbroll/jscad-fluent` in which
every function that takes an options object first
(`packages/agent-loop/api/optionTable.js`, generated with the API index)
reports each unknown key as `{ fn, option, suggestions }` and then calls the
real function with the same arguments. `@jscadui/require` hands the copy out
(`setUserModuleWrapper`), and the frame worker registers it through
`src_frame/optionWarnings.js`. The require cache holds one exports object per
bundle URL, shared by the fluent, model-tools and anchors bundles and the
OpenSCAD runtime, so only a caller whose URL is a project file under `root`,
and not a `.scad` file, gets the copy; the libraries' internal calls would
otherwise warn about options the user never wrote. The worker's collector is
cleared at the start of each `jscadScript`, since top-level model code runs
during the require, keeps each `fn`+`option` once, holds at most 20, and
`jscadMain` returns them as `warnings`.

A grid run's answer merges every member's warnings the same way. The chat's
build report and `run` result pass them on as `warnings`; the editor shows
none of them.

The same wrappers check more than option names (`packages/agent-loop/docs/user-manual.md`
has the rules): a number option given an array or the reverse, a rotate angle
over 2π, and an unknown option another function takes, each reported with a
`hint`. A few slips with one sensible reading are fixed before the call, with
a warning: a `roundRadius` past its limit is lowered to fit, and a number
`cylinderElliptic` radius becomes a pair. The collector writes the hint for
the chat's API style, and when the wrapped call throws, the hints of that
call, plus the cause of a NaN or object size, are added to the error's
message. `reportError` adds a
hint to a "X is not a function" error on the page (`withErrorHint`), since
that error comes from model code, not a wrapped call.

Model code's `console.log/info/warn/error/debug` calls during that run are
captured the same way (`src_frame/consoleCapture.js`, always forwarding to
the real console too, so devtools still shows everything), reset before the
require and read back on `jscadMain`'s result as `console`. A re-run on a
parameter change resets it again before `main`, so its result carries only
that run's lines. A grid run's
answer concatenates every member's console lines in member order (no
dedupe), capped at 50 lines and 4,000 characters total with a trailing
`… (N more lines)` note. The chat's build report and `run` result carry it
as `console`, a failed build's too.

Fluent class methods that take an options object (`.extrudeLinear({...})`,
`.center`, `.mirror`, `.expand`, `.offset`, `.extrudeRotate`) are checked
too, because the fluent prompt teaches chaining. Fluent exports no classes, so
`wrapFluentMethods` finds each prototype from an object a factory makes and
wraps the methods the option table lists (`methods`, `methodTypes`,
`methodAngles`) in place, once,
the first time a project file requires fluent. The prototypes outlive any
one copy of `optionChecks.js` (another bundle, a test's fresh import), so a
wrapped method carries the mark `Symbol.for('jscadui.optionChecks.wrapped')`,
which stops a second copy from wrapping it again, and reports to the warn
target on `globalThis[Symbol.for('jscadui.optionChecks.methodWarn')]`, which
each `wrapFluentMethods` call sets through `setMethodWarn` to its own
collector. A warning names the class,
`FluentGeom2.extrudeLinear`, and goes to the run's collector. Unlike the
exports copy, this reaches every caller in the worker, fluent's own code
included. That is safe because fluent never calls its own option-taking
methods and passes modeling only valid options;
`packages/agent-loop/eval/fluent-guard.test.js` runs every fluent example with
the wraps on and fails on any warning. `subtract`, `attachTo` and `alignTo`
take options too, but not as the first argument (`subtract`'s trails a
variadic list of operands, `attachTo`/`alignTo`'s follows an anchor), so the
first-argument check does not cover them (see backlog).

The probe that finds fluent's prototypes calls its real factories
(`circle()`, `cube()`, ...), and a manifold-backed factory throws until the
modeling bundle's WASM finishes loading. `src_frame/optionWarnings.js` waits
on that bundle's own `ready` promise, already in the require cache since
fluent requires modeling before this wrapper runs, and wraps once it
resolves — strictly before `jscadScript`'s own `await modelingModule.ready`
resumes, since both are `.then` continuations on the same promise in
attachment order. The plain jscad engine has no such promise, so the wrap
runs synchronously instead.

### Chat feedback loop

The prompt improves from real sessions. The launcher relay logs each
conversation (above), and `packages/agent-loop/log/read-log.js` rebuilds the
log into turns, each tool call with its result and the source of any failed
one. It parses responses with the adapters' own stream parsers, so each
protocol has one SSE parser. Logs and eval result files live in the private
`jscad-chat-evals` repo (`~/src/jscad-chat-evals`, or `$JSCAD_CHAT_DATA`), not
in jscadui; `evalResultsDir` (same module) resolves the eval's write target
and `run-eval` refuses to run without one. The `chat-review` project skill
(`.claude/skills/chat-review/`) groups the stumbles by cause, reproduces each
group as an eval fixture, and decides whether to keep, revert or revise a
prompt or example change in step 6 of `.claude/skills/chat-review/SKILL.md`,
from a per-fixture comparison of result files of one API style and the
transcripts behind each change.

The eval never runs model code in `run-eval`'s own process. Each
conversation gets an executor process under `crt run`, with no network, no
home, a clean environment and a read-only root filesystem, and Node's
permission model inside that; the conversation and its provider key stay in
`run-eval` and send tool calls to the executor over a socket
(`packages/agent-loop/docs/architecture.md`). The executor runs model code
through `@jscadui/require` with the frame's
transform rule (`shouldTransform`) and URL scheme, mapping `https://cdn.jsdelivr.net/npm/<pkg>` to
local `node_modules`, so a bad import fails with the same `failed to load
module` / `file not found` text the model gets in the app. It imports the
prebuilt `esm/` bundles of `@jscadui/require` and `@jscadui/transform-babel`,
because their `src/` entries do not load in plain Node.

Its CDN stub returns the option-checked copy of `@jscad/modeling` and
`@jbroll/jscad-fluent` itself rather than through `setUserModuleWrapper`,
because the eval loads the prebuilt `esm/` build and Node's module object is
shared with fluent's and model-tools' own requires. It wraps the fluent
methods on Node's fluent prototypes with the same `wrapFluentMethods` the
frame uses.

`prompt.md` holds the prompt prose both API styles share, and
`prompt/fluent.md` and `prompt/modeling.md` fill its imports and style slots;
examples are separate files in `prompt/examples/fluent/` and
`prompt/examples/modeling/`, the same requests in each, listed in
`prompt/index.js`. They are imported as `?raw` text, which Vitest reads
natively, jscad-web's build reads through `src_build/rawImport.js`, and Node
reads through `text-loader.js`.

Logging stays in the local launcher. The production relay forwards by
allowlist, so it drops the chat id header and records nothing.

## Key custody

The provider key is the user's, in one of three modes (`packages/key-store`):
in memory for the session, in `localStorage` on this origin, or as AES-GCM
ciphertext under a PBKDF2 passphrase that never leaves the browser. The key
rides the relay request to the provider and is never stored server-side, never
logged, and never sent into the frame.

## Storage

Local-first with per-project version history (`src/storage/`). Every editor
compile records a version row and file hashes, and so does each chat turn
that wrote files, once, with the turn's final state.
Backends: the service-worker FS and file handles (`local`, the default and the
only mode for anonymous users) and rowboat blobs and tables (`rowboat`, after
sign-in, synced with a 15-minute JWT from `GET /api/sync-token`). Under the
local launcher a third, `disk`
(`src/storage/disk.js`), holds one project, id `disk`: the model directory,
read and written over the launcher's `/api/fs` and followed through its
`/api/fs/events` stream. It keeps no versions; the directory's git does. A GitHub App backend that read and committed
through the server is parked on the `park/github-app-storage` branch.

A mixed project merges at load: each manifest path names exactly one backend,
and an unlisted sibling resolves local-first then rowboat.
`src/storage/manifest.js` is generated from `schema.js` by
`node scripts/gen-manifest.js`, and a parity test fails on drift. `main.js`
never imports `schema.js`, whose zod types the root TS 4.9 gate cannot parse.

No storage access crosses into the frame: no session, no directory handle, no
repository token. A project's file contents do cross, because a model's
`require` of a sibling has to resolve inside the frame.

## Local launcher

`scripts/jscad.mjs` builds into `build_local/` with the frame origins baked in
for the ports it serves (`scripts/local/build.js`). The marker
`build_local/.jscad-local.json` records those origins and a source stamp: the
git HEAD, plus a hash of `git diff HEAD` and the untracked file names when the
tree is dirty. The launcher reuses the build only when all three match, so a
checkout, pull or edit rebuilds on the next launch. Outside git the stamp is
null and only the ports count.

That build sets `JSCAD_LOCAL_FS=1`, which `build.js` stamps as
`__LOCAL_FS__`; only then does `main.js` load the disk store. The server's
`/api/fs` (`scripts/local/fsApi.js`) lists, reads and writes the model
directory and streams change events, and answers only the app page on a
`localhost` or `127.0.0.1` host: the frame origin and any other page get 403.
A `#/models/<entry>` hash then opens the directory through the same project
switch a stored project uses (`src/diskProject.js`, `createProjectSwitch` in
`src/projectFiles.js`), so the file cache holds the whole directory, binary
files as bytes. Every agent tool, the per-turn project context and a model's
`require` of a sibling read that cache, as for any project; chat writes and
editor runs reach disk through the session's write-through, Ctrl+S through the
store, and `export` writes `<entry base name>.<format>` at the root. The store
does not report its own writes back. Other changes update the cache, clear the
frame's copy, refresh the editor's file list, reload the open file when its
buffer matches the cache (an editor run writes the buffer to the cache, so a
buffer that differs holds unsaved edits and stays), and rebuild. The deployed
build stamps `false` and opens a `#/models/` hash as a plain script, as before.

A checkout with a `.jscad-track` file at its root (`origin/main`) follows that
branch (`scripts/local/track.js`). Before anything else the launcher fetches
it, and when HEAD is behind the tip and no tracked file is modified,
fast-forwards to the tip detached and runs the tip's `ci/lib/bootstrap.sh`
with `sources`, `ci` when a `package.json` or the lockfile changed, `deps`,
`grids`, `examples` and `openscad`. The moved checkout's own `jscad.mjs` then runs in a new process, with
`JSCAD_TRACKED=1` so it does not track again, because the running one loaded
the old code. A failed fetch, a dirty tree, or a HEAD with commits the tip
lacks prints why and launches the current HEAD, so a checkout seeded from an
unmerged branch waits until the branch lands. A checkout without the file is never moved.

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
`deploy-full.sh` regenerates the `ALL.js` example grids first (`fetch-deps
--if-missing`, then `generate-all-files.js --no-rename`): most grids are
gitignored build artifacts, so a fresh checkout has the corpus but no grids.
It then builds the workspace once, deploys the run host and confirms
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

### Local servers and remote scripts

Apache serves production. Locally, `serve.js` serves `build/` for
`npm run serve` and runs the frame host (`serveFrame`) for `npm run dev`,
`npm run serve` and the launcher. `npm run dev` serves the app host with
live-server, and the launcher serves it with `scripts/local/server.js`. The
Node servers take content types from one table and confine paths with one
`safeJoin`, both in `scripts/static.js`. The launcher's `/api/fs`
(`scripts/local/fsApi.js`) shares the table but keeps its own stricter path
rules: no dot segments, no `node_modules`, and a realpath check against the
model directory.

A `#https://…` hash loads the script with a direct browser fetch
(`src/remote.js`), so the script's host must send CORS. No server proxies the
fetch. Apache's SPA fallback answers an unknown path such as `/remote` with
`index.html` and a 200, and the launcher has no such route, so a proxy would
work only under `npm run serve`. `isValidRemoteUrl` rejects non-http(s)
schemes and loopback, private and link-local hosts, IPv6 included, so a shared
link cannot point the viewer's browser at their own network.

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
