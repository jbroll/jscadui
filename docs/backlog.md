# Backlog

Outstanding work, roughly in the order it should land. Delete an item in the
commit that completes it.

## Deploy

jscad.rkroll.com runs `dev` with the AI chat folded in (2026-09-17): the
frontend is jscad-web hybrid plus the app API (`apps/jscad-web/server`) on
:3006, with the compute frame served from the same deploy at `/frame/`.
2026-09-18: deployed from `main` with local-first
rowboat storage (versioned projects, per-project chat persistence, table sync
on sign-in via `/api/sync-token`), then the project UI batch (side drawer
with stacked tabs, project list/switch/rename, append-only version restore,
local/rowboat toggle, drop branching). Smoke: site 200, `/api/health` 200,
`/api/sync-token` 401 anonymous, relay 403 on fake origin. The old `main` export breakage (worker requesting
`bundle.jscad_io` with no `/build/` prefix) is fixed on this branch by
requiring the registered `@jscad/io` alias instead. Merged to `main`
2026-09-20 as `feat/fluent-worker-bundle`: fluent worker bundle in both
apps plus four backlog fixes (WASM clone ownership, build clean, alias
cache, export identity). Render gate 2026-09-20: 764/788, 24 failures
triaged as pre-existing openscad-corpus issues; baseline recorded in
`apps/jscad-web/e2e/render-baseline.json` (job 07ff0ae0ffbdb0f2). 2026-09-20:
jscad-studio and jscad-studio-run folded into jscad-web and removed; the old
`run.*` vhosts retired with the next deploy. 2026-09-21: the compute frame
moved to its own host, `jscad-run.rkroll.com`, deployed via
`deploy-run.conf`; `jscad.rkroll.com` still serves the app and proxies
`/api`. Both hosts are live. 2026-09-23: deployed `f402d41c` (the review
fixes, GitHub App storage removed); the smoke gate now checks that each host
serves the build just made. Later on 2026-09-23: deployed `4c0bd32e`, the
review follow-ups, then `91d6402f`, the render-engine redraw guard.
2026-09-24: deployed `3543a03e`, the include-chain cache check and the grid
memory fixes. Later on 2026-09-24: deployed `715e4509`, streamed grids, then
`cf7e8dc1`, the preview optimizations (indexed meshes, streamed parts, mesh
reuse, spare worker), then `c848f0ba`, the grid failure marker drawn from
`skull.svg`, then `66ee38c7`, the demo menu without pass-through levels and
with NopSCADlib's tests in six categories, then `746a96f7`, the grid worker
pool (a grid's leaves spread over the frame's workers by claim), then
`3cae6ef5`, workers recycled past a 1 GiB WASM heap and a default pool of two.
2026-09-27: deployed `152cb36b`, the chat settings fix. Before it the host had
no `/etc/jscad-relay/providers.json`, so every relayed request, chat turns
included, returned 500; the relay now falls back to the built-in provider
table. A same-origin models GET now reaches the provider (`meta` answers 401
without a key) instead of a 403. Later on 2026-09-27: deployed `cb504202`,
the build-stamped relay origin, so the `jscad-chat` launcher uses its own
relay instead of production's, which never trusted its origin. Then
`d1f328ea`, geom2 booleans on clipper-lib (modeling `ff759668`); smoke passed
(app build `d651ba36`, frame `63973ab6`). 2026-10-01: deployed `5b75dae1`, the
chat's project-switch guard; smoke passed (app build `e3b23e20`, frame
`da49cf0a`).
See `apps/jscad-web/docs/architecture.md` for the
deploy order and headers.

## Security

From the 2026-10-01 code review, each item checked against `main`
(`2ec5b5a8`) by reading the code. None was tried in a browser. Paths are
under `apps/jscad-web` unless given in full.

- **A `#` hash naming an app path runs as model code with the user's
  cookie.** `src/remote.js:53` and `:187` treat `/…`, `//host/…` and anything
  without `://` as relative, so they skip the trust dialog and
  `isValidRemoteUrl`. `:193` fetches with default credentials, and
  `main.js:865-870` sends the text to the frame. An attacker page opens the
  app with a `#data:` model that replaces `globalThis.eval` in the reused
  worker (next item), then renavigates the window to
  `#/api/auth/get-session`. The session JSON carries `session.token`, which
  better-auth's `bearer()` accepts unsigned since `requireSignature` is off;
  it reaches the poisoned worker, which sends it out over the frame's
  `connect-src https:`. `#/api/sync-token` yields a rowboat JWT the same way.
  The app sends no COOP, so the opener keeps its window handle. Fix: accept
  only relative paths under `/examples/`, fetch with `credentials: 'omit'`,
  and treat a leading `//` as remote. Unverified: that a cross-origin
  opener's fragment-only navigation fires `hashchange` without a reload.
- **Model code stays in the frame worker across projects.** Every load goes
  to the same `state.active` slot (`src_frame/frameHost.js:315-336`,
  `workerPool.js:151-155`). A worker is replaced only on a WASM trap, an
  abandoned superseded run or a timeout. Model code shares the realm
  (`packages/require/src/require.js:44`), and `self.__PROJECT_FILES__`
  (`bundle.frame-worker.js:80-84`) is a plain configurable property, so a
  shared model opened once sees every later project's files and scripts in
  that tab. Fix: retire the worker when a load's source changes (another
  project, or a hash, gist or remote script).
- **The relay rate limit keys on a spoofable address and never evicts.**
  `server/src/index.ts:69` sets `trust proxy` to `true`, so `req.ip` is the
  leftmost `X-Forwarded-For` entry, which the Apache proxy block (deploy.sh
  `modules/apache/build.sh:116-124`) passes through from the client. The
  limiter (`relay/routes.ts:58-59`) runs before the unknown-kind 404, and
  `createLimiter` (`relay/policy.js:251-268`) never drops a bucket. A curl
  client with a forged `Origin` bypasses the 60/min limit and can grow the
  map until the API process runs out of memory. Fix: `trust proxy`
  `'loopback'` or key on `X-Real-IP`, evict idle buckets, and point
  better-auth's IP header at the same value.
- **The launcher's `/models/` serves dotfiles to any page.**
  `scripts/local/server.js:22-29` serves the model directory through
  `safeJoin`, which is lexical only, so symlinks are followed. There is no
  dotfile filter and no Host or Origin check, and every response carries
  `Access-Control-Allow-Origin: *`, on 127.0.0.1:7377 by default. While
  `jscad ~/repo` runs, any site can read `.env` or `.git/config`. `fsApi.js`
  already has the hidden-segment, realpath and Host/Origin checks
  (`:13-39`, `:89-99`). Unverified: whether Chrome's Local Network Access
  prompt blocks the cross-site fetch.
- **The auth secret falls back to a public string.**
  `server/src/config.ts:68` defaults `BETTER_AUTH_SECRET` to
  `dev-secret-change-me` in production. It applies only when `secrets.env`
  exists without the variable (a missing file aborts boot on
  `ROWBOAT_DATABASE_ID`), but then anyone can forge the cookie-cache session,
  which better-auth trusts without a database lookup. Fix: refuse to boot in
  production without it.
- **No CSP or COOP on the app origin.** The deploy's header block (deploy.sh
  `modules/apache/build.sh:229-248`) sets neither, and `static/index.html`
  has no CSP meta. Device-mode API keys sit in `localStorage` as plain JSON
  (`packages/key-store/src/keys.js:60`), so any future script injection on
  the app origin reads them. Add `Cross-Origin-Opener-Policy: same-origin`
  and a CSP: `script-src 'self'`, `frame-src` the run host, `connect-src`
  self, rowboat and the provider hosts.
- **Smaller hardening.**
  - `config.ts:69-73` trusts `http://localhost:5120` and
    `https://appleid.apple.com` for credentialed CORS and the relay gate in
    production. `SameSite=Lax` keeps the session cookie off, but a local
    page can use the relay. Add the dev origin only outside production.
  - `relay/routes.ts:69` returns allowlist read and parse errors, file paths
    included, in a 500. Log them and return a fixed message.
  - `src/remote.js:180-183` gunzips a `#data:` link on the main thread with
    no output cap, so a link can hang the tab.
  - `packages/params-form/src/params.js:114` writes `type="${inputType}"`
    unescaped. Only cardboard-cutter uses params-form.

## Projects and storage

From the same review, with the same path convention.

- **A failed project read during a save deletes the rest of the project.**
  `src/storage/session.js:18-22` catches any `readProject` error and writes
  back only the edited file. Rowboat's `readProject` throws when any blob
  fetch fails (`rowboat.js:46-51`, `:70-75`), and its `writeFiles` replaces
  the file set, deleting earlier rows (`:114-115`). One offline or 403 blob
  fetch during an editor run or chat write leaves a one-file project. Fall
  back to `{}` only on a typed not-found error. Rowboat also re-uploads every
  file on every save (`:109-113`); rowboat-client's `blobs.upload` does not
  dedupe.
- **The local backend keeps nothing across a reload.**
  `src/storage/local.js:4-6` holds projects, versions and conversations in
  `Map`s, while `README.md:156-170` and `docs/architecture.md:1111-1116`
  describe it as persistent. Anonymous work is lost on reload and on "Sign
  in to Sync", whose full-page redirect (`src/aiAccount.js:130-139`) also
  drops the hash, since `callbackURL` is the bare origin. Back it with
  IndexedDB. Until then, warn before the redirect and on unload.
- **Runs are recorded into the wrong project.** `main.js:369` starts
  `currentProjectId` at the literal `'default'`, but the default project is
  created under a UUID (`main.js:984-986`), so the first editor run or chat
  write (`main.js:935-938`) creates a second "Untitled" project. A demo
  opened from the browser while a project is open is stored into that
  project with its URL as the path (`main.js:809-815`); `recordEdit` guards
  only the disk project (`:365`). Use the id `createProject` returns, and
  skip recording for URL paths.
- **Editor edits are dropped without warning.** The file list reads `File`
  snapshots taken when the project opened (`src/projectFiles.js:46-49`,
  `src/editor.js:207-211`), so switching to another file and back shows the
  pre-edit code, and the next run stores it. Project switch
  (`projectFiles.js:69-70`), version restore (`src/projects.js:39`,
  `main.js:997`), demo load (`main.js:112`) and chat writes
  (`main.js:923-926`) replace the buffer with no confirm. `setSource`
  (`editor.js:156-159`) never updates `#editor-file`, so after a project
  switch the label names the previous file. Keep a per-path dirty buffer
  and confirm before replacing one.
- **The Projects panel acts on the wrong project.** `src/projects.js:109-111`
  selects the first row on first render only. Row clicks (`:90`) call
  `onSwitch`, and `select` is never called, so the version list and Restore
  belong to whichever project was listed first, and Restore then switches to
  it. The open row has no highlight, versions refresh only on rename, New,
  drop or flip, New (`:117-121`) does not open what it creates, and there is
  no delete.
- **Chat history does not follow a project switch.** `src/aiChat.js:142-153`
  reads the transcript once at init, `:301` sends it as `prior`, and
  `:107-114` saves it under the current project, so project A's conversation
  is sent with, and saved over, project B's. Conversations go to
  `getActiveStore` (`main.js:958-961`), rowboat whenever signed in, rather
  than the project's own mode. There is no New chat control.
- **A folder dropped on a project row creates a new project.** The body
  `dragover` (`src/fileSystem.js:291-294`) shows `#dropModal`, fixed
  full-screen at z-index 5000 (`static/main.css:67-78`), which takes the
  drop, so the row handlers never run. `e2e/project-ui.spec.js:24-31`
  dispatches the drop on the row directly and misses this. `main.js:464-465`
  also calls `extractEntries` a second time after awaits, when by the HTML
  spec a real `DataTransfer` is empty, so `createFromDrop` may never run for
  a real folder drop (not tried in a browser).
- **Storage mode and sync state.** Flipping a project's mode copies it
  (`src/storage/projects.js:122-131`) and `listAll` does not dedupe, so it is
  listed twice. Sign-out (`aiAccount.js:141-144`) leaves the sync loop
  (`main.js:442-454`) and the rowboat store running. Sync errors reach only
  `console.warn` (`main.js:449`). Labels show `local` and `rowboat`
  (`projects.js:16`, `:61-64`, `:88`) rather than what they mean.

## Render sweep

Baseline 1226/1420 on manifold (CI job `94f275be0655e54b`), plus 75
text-only models that run clean and only echo or draw text. The 194 recorded
failures are
the 25 pre-existing ones plus suites the 09-23 baseline never swept:
echo-only, 2D-only and assert/error negative tests, include/use wiring and
helper modules, empty-by-construction models (now including `issue1672.scad`,
a cube scaled to zero), `$t` animations, and unfixable
content (removed `assign()`, a Windows include path, missing upstream files).
20 BOSL2 doc examples that call a function as a statement, or do not parse,
went from text-only to empty once `std.scad` stopped echoing include warnings.
The step from 1223 is 4 models the `%`/`#` viewport ghosts fixed (dotSCAD
rubber_duck_debugging, NopSCADlib annotation, openscad-tests issue1005 and
issue1833). The sweep exits nonzero only on a regression against
`render-baseline.json`.
See `apps/jscad-web/e2e/RENDER-TESTING.md`.

- **Four examples are skipped as broken at their source** — see the
  library `skip.txt` files. Three include files upstream does not ship:
  refresh the vendored dotSCAD and snippet copies if it ever ships
  `util/rands_disk.scad`, `maze/mz_wang_tiles.scad` and the 11 missing
  `Asset_SCAD/` parts. The fourth, `voronoi_melon.scad`, OpenSCAD cannot
  render either: dotSCAD's `_delaunayBoundaries` recurses without end on its
  point set.

## Combined ALL.js grids

A grid's leaves, nested sub-grids included, are spread over the frame's
worker pool: each worker claims leaves by key and streams each placed cell to
the app as it finishes, so no worker holds the whole grid's geometry. The
model budget (120s, `main.js`; 290s in the sweep) restarts on each cell, so it
bounds one leaf rather than the grid. The app draws cells as they arrive,
capped at 1.5 GB and 20,000 entities per grid
(`apps/jscad-web/docs/architecture.md`, Streamed runs). 46 grids; the largest
are dotSCAD's 64-cell examples grid, about 36 per BOSL2 part and NopSCADlib's
32-cell electronics grid, one of six category grids that replaced its
147-cell tests grid. A sub-grid is scaled into its parent's cell and streams
its own leaves. The generator writes no grid whose only item is one sub-grid,
and the sweep runs the six aggregates (every item a sub-grid) after the rest,
one at a time.

A cell whose model throws no longer takes the grid with it: it draws a
skull-and-crossbones and the sweep scores that grid `partial`, naming the dead
cells. **42 of 46 render** (`sci push jscadui/render-grids`, job
`81535cace82fc6ea`, 320s hang guard restarting on each streamed cell, 290s
model budget per cell), and none crashes the renderer;
`apps/jscad-web/e2e/render-grids-baseline.json` holds the per-grid state and
each partial grid's dead cells. A worker whose WASM traps draws the trapped
leaf's marker, stops claiming, and is replaced, so the other leaves still run.
A run without claims (export's re-run) still fails every cell after the first
`WebAssembly.RuntimeError` as `not run: wasm trapped in <url>`.

Manifold frees a WASM handle only from a `FinalizationRegistry` callback, which
cannot run inside a synchronous `main`, so the OpenSCAD runtime disposes each
op's inputs once it has consumed them (`openscad-runtime/src/consume.js`) and
the manifold transforms free what they build from a plain jscad input. Node
measurements of the WASM heap peak: `fractal_tree.scad` 2352 → 207 MB,
NopSCADlib `extrusion_brackets.scad` 3087 → 963 MB, `openscad/bosl2/ALL.js`
3425 → 358 MB, same triangle counts and volumes. A grid's `main` also yields
after each cell, which by itself changed no Node peak, and `normalizeAndPlace`
disposes its two intermediate transforms per geometry.

- **`part()` boundaries for JSCAD and SCAD parts.** A single model's parts
  could spread across the frame's pool the way a grid's leaves do now, using
  the same claim mechanism: `jscadClaim`, a key per part, fan-out on the first
  claim.

## Library bugs found by the sweep

- **`!` root modifier is ignored.** OpenSCAD renders only the `!` subtree;
  we render the whole model. Needs `main()` to return that subtree with its
  ancestors' transforms, which the `%`/`#` overlay channel does not provide.
- **`use <font.ttf>` gaps.** A missing font file fails the model in the
  browser (`scadHandler` treats `FILE_NOT_FOUND` as fatal) where OpenSCAD and
  `run-jscad.js` warn and fall back. A font `use` inside an included file does
  not reach the including file. A project font arrives as a new `ArrayBuffer`
  each run, so its model re-transpiles every time. `textmetrics()` and
  `fontmetrics()` are not implemented.
- **Ghosts are not drawn in ALL.js grid cells.** Cells drop `previewOnly`
  items before `normalizeAndPlace`; drawing them needs placement and the
  streaming claims to carry them.

## Transpiler performance

From the 2026-10-01 review, measured in Node; browser numbers are not taken.
A cold transpile is 0.5–0.9 s for a BOSL2 example and 0.6–1.85 s for
NopSCADlib `libtest.scad`, with parsing about 40% of it. Bare `.ts` names
are under `packages/openscad/src/transpiler/` (`dependencies/` for
`dependencyProcessor.ts`), and `src_frame/` is in `apps/jscad-web`.

- **A project edit throws away every transpiled project file.** The editor
  save and chat write (`apps/jscad-web/main.js:802`, `:921`) send
  `jscadClearFileCache`, and `forgetFiles`
  (`src_frame/scadHandler.js:215-228`) drops every project-origin entry from
  both caches. A project switch or reload (`src/projectFiles.js:67`,
  `main.js:348`) runs `clearTranspiled` (`scadHandler.js:202-208`), which
  also drops the app's library caches. A project cannot include the app's
  `/examples/openscad/<lib>` (`scadResolve.js:13-16`, `:26-51`), so a
  project that carries BOSL2 or NopSCADlib transpiles cold on every edit.
  Fix: drop only the changed files and their includers, and keep app-origin
  entries in `clearTranspiled`. The fix must also handle sibling includers:
  when `a` and `b` both include a changed `c`, resolving `a` refreshes
  `readContent(c)` (`scadHandler.js:157`), so `b`'s `chainUnchanged` check
  (`:154`) passes and stale `b` stays cached. Reproduced in Node. It cannot
  bite today only because every edit wipes the project.
- **Each file is read 3–5 times per cold transpile.** `transpile.ts:985` and
  `dependencyProcessor.ts:67` resolve a file before checking the cache
  (`:1003`, `:82`), and the frame resolver (`scadHandler.js:146-164`) keeps
  no per-run memo. App-origin reads are sync XHRs with no cache
  (`src_frame/fileMap.js:11-28`). `libtest.scad` makes 1,623 reads over 325
  files. The read-before-check is how `scadHandler.js:151-154` notices a
  changed file, so a per-run content memo has to keep that validation.
- **`sphere()` and `polyhedron()` on manifold go through jscad polygons.**
  The runtime's `_sphere` (`packages/openscad-runtime/src/primitives.js:68-107`)
  calls manifold's `polyhedron` (`manifold/src/primitives/index.js:347-374`),
  which builds a jscad geometry and converts it with `geom3ToManifold`
  (`conversions/index.js:189-241`), keying every face vertex with three
  `toFixed(9)` strings. That costs 6.6 ms per sphere at `$fn=30` against
  0.7 ms for an indexed mesh straight to `Manifold.ofMesh`, and `_sphere`
  is 43% of `packing_circles.scad`'s `main`. Add an indexed-mesh path that
  keeps OpenSCAD's tessellation; `Manifold.sphere` does not match it.
- **Customizer extraction re-lexes every dependency.** `transpile.ts:324`,
  `:449-454` and `packages/openscad/src/customizer/extract.ts:108-109` run
  on each file, since `processDependency` passes the entry's options down
  (`dependencyProcessor.ts:173-174`, `context.ts:82-86`). Turning it off cuts
  a cold transpile 25% for BOSL2 and 13% for `libtest`. Extract only for the
  entry file, and rebuild a cached file when it is later opened as an entry.
- **Parsed files are not kept across runs.** The frame calls `transpile`
  without its fourth `sharedParsedFiles` argument (`scadHandler.js:167-173`),
  so after a cache wipe every unchanged library file is parsed again (363 of
  901 ms for BOSL2 cold). Within a run, `dependencyProcessor.ts:110-122`
  parses without storing into `ctx.parsedFiles`, so the cycle path
  (`:88-89`) re-parses: 4 extra parses in `libtest`. A cross-run AST cache
  needs content validation.
- **Output is built and regex-scanned for every file.**
  `transpile.ts:909-910` runs `buildOutputCode` and `declareMissingSymbols`
  (five `matchAll` passes, `:818-866`) on each dependency, whether or not its
  code is ever required: 16% of a BOSL2 cold transpile and 20% of
  `libtest`'s. On a warm BOSL2 edit the passes take about 29 of 35 ms,
  scanning the entry's 2.1 MiB output with the library inlined. Build `code`
  on first use and have each inlined part carry its own declared and
  referenced names.
- **Tail calls copy the whole scope stack on every bounce.**
  `tailCall.ts:160` emits `scope: j$.scopeSnapshot()`, which copies every
  frame (`openscad-runtime/src/index.js:377`), while `withScopeFrom`
  (`:379-384`) uses only the frames from the loop's depth up. 200,000
  bounces take 84 ms at scope depth 1 and 236 ms at depth 12, against 2.8 ms
  for a plain loop. Snapshot only the frames above the entry depth, and skip
  the snapshot when none were pushed.
- **Each dependency copies the parent's symbol table.**
  `dependencyProcessor.ts:139-155` rebuilds the module and function
  parameter maps per dependency, `context.ts:231-245` registers them again in
  the child, and `transpile.ts:926-935` stores `getAllWithParams` for every
  file. About 7% of a `libtest` cold transpile and 4% of BOSL2's. Pass a
  shared read-only parent table.
- **Vector `+`, `-` and `/` allocate through `Array.from`.**
  `openscad-runtime/src/vector.js:31`, `:46`, `:140` are 6–9x slower than a
  preallocated loop, but only about 31 ms of `packing_circles.scad`. Low
  priority.

## OpenSCAD comparison red on a clean tree (pre-existing, not PR112)

`ci/gpu-test` on a fresh worktree fails bosl, bosl2, dotscad, mcad and one
nopscadlib model (`box.scad`) against gpu openscad 2026.03.17.fp (flatpak).
This predates the customizer work:

- Transpiled output is byte-identical between `main` (`7516264f`) and the PR
  across all 671 committed example files, and example inputs are unchanged,
  so the same JS would fail the same way on `main`. The customizer option is
  opt-in and the comparison suite never enables it (`customizer: true`
  appears only in the survey tool and unit tests).
- No `jscadui/test` job has passed on any path since 2026-09-21 15:11 UTC;
  dev-laptop pushes fail with the same signature as queue runs, so this is
  not a queue-vs-rsync difference.
- The host openscad beta flatpak redeployed 2026-09-21 11:08, the morning
  the suite went red — correlation only: a mirror ground-truth render
  (`mirror([1,0,0]) translate([10,0,0]) cube(1)` spans x in [-11,-10])
  proves the reference side handles at least that class correctly.
- `main` cannot run the comparison through the queue at all: it has no
  `ci/gpu-test`, and its `fetch-deps` dies on a fresh clone (stale dotscad
  patches dirty tracked files, then `_mz_theta_cells.scad` fails).
- The reference STL cache is content-keyed (sha256 + openscad version), so
  stale references are ruled out. Failing classes: `color`/`ghost`/`hsl` and
  distributors return no geometry; transforms mirrors mismatch near 0.5;
  near-miss scores (0.83–0.99) elsewhere.

Next step is transpiler-owner triage per model (`run-jscad.js` +
`compare-stl.js`), not more CI work. The gpu-poll infra merges on truthful
reporting, not on this going green.

## The jscad engine

The app defaults to manifold; the other engine renders **1206/1420** (CI job
`49223beac13db19b`, `sci push jscadui/render-jscad`), plus 76 text-only, with
`apps/jscad-web/e2e/render-jscad-baseline.json` holding the per-model state.
191 of its 214 failures fail on manifold too; most of the other 23 are empty
results from BOSL threaded nuts, MCAD bearings and snippet models. The STL comparison suite only
runs manifold, so that sweep is the only thing covering this engine. Run one
model with `display-check.js --engine jscad`.

- **One-offs.** `maze3d_mickey.scad` overflows the stack and is an accepted
  failure (see `RENDER-TESTING.md`). `packing_circles.scad` and
  `heart_chain.scad` sit on the 290s model budget and are marked flaky;
  `heart_chain` spends 200s of its time in a 1,000-way 3D union.
  NopSCADlib `PCB.scad` sits at the memory limit: in Node its preview run
  exhausts a 4 GB heap on some runs and finishes with 3M vertices on others,
  and the browser sweep crashed on it, so it is marked flaky too.
- **It is roughly 10x slower than manifold.** `nuts.scad` takes 37s against
  3.6s, and the profile is entirely BSP: splitByPlane 11.6s, GC 11.3s, clipTo
  7.3s, with nothing in our own code. The one avoidable part is upstream now
  (`perf(modeling): group geometries by bounds before unioning them`), worth
  about 20% on a scene of separable parts. NopSCADlib `PCB.scad` now gets past
  its 2D booleans (1,319 calls, 1.4s in all) and spends 227s in 853 3D unions,
  two of them merging 154k and 175k polygons in 50s each with the Node heap
  peaking at 2.7 GB; it finishes in 234s against the 290s budget.

## Chat API help

- A refused or failed chat turn stores the user message and no reply, so a
  retry resends every refused message and a safety filter that flagged one
  keeps refusing. Drop or mark refused turns in the transcript sent back.
- Eval model code now runs in a crt container with no network, home, key or
  parent environment (`eval/sandbox.js`, read-only binds of `packages/`,
  `node_modules/` and `.deps-cache/`), but the CDN stub still serves any
  installed package in those binds, not the frame's allowlist. Restrict the
  stub to the frame's allowlist. Runs started from a Claude session are
  still reaped under memory pressure.
- Eval grades can be forged by model code during its own grade, since
  `measure` and `check` run in the executor beside it. Measuring serialized
  geometry in a second process would close it; left as is because the model
  gains only a false score for its own run, and a fresh executor per grade
  already stops one run affecting another.
- crt: give the private `/tmp` and `/dev/shm` tmpfs a `size=`, set
  `memory.swap.max` with `memory.max` (on a host with swap the eval's limit
  now bounds only resident memory), fail a run whose requested limit cannot
  be applied instead of warning, and have the eval pass a `cpus` limit. The permission model already denies writes there,
  and cgroup v2 charges tmpfs pages to the executor's memory limit, so this is
  a second layer only; not verified on a host with a delegated cgroup.
- Stack-gated fluent method checks, if `eval/fluent-guard.test.js` ever finds
  a false warning from fluent's internals. The method checks wrap the shared
  prototypes, so they see fluent's own calls as well as the model's; a
  fluent release that calls its own option-taking methods with options the
  table lacks would need the check to warn only when the caller is project
  code.
- Option checks for options passed in a non-first position: fluent's
  `subtract` (a variadic operand list), `attachTo` and `alignTo` (options
  follow an anchor argument).
- JSDoc gaps in `@jscad/modeling` are patched in `api/build-index.js`
  (`PASS_THROUGH`, `defaults` keys). A false warning from a real call means
  another entry belongs there, or upstream JSDoc needs the option.
- API style radio button (jscad-web). `getChatApi()` in `src/aiAccount.js`
  reads the selection's `api`; the gear dialog needs the control, and
  `persistSelection` there must carry `api`, since it rewrites the selection
  from its own fields and would drop it.
- Sibling hints pair functions by name only (`cube`/`cuboid`,
  `cylinder`/`cylinderElliptic`), so `square({ size: [x, y] })` does not
  point at `rectangle`, nor `circle` at `ellipse`. A small alias list in
  `src/hints.js` would cover them.
- `jf.polygon` in jscad-fluent should list a single flat outline
  counter-clockwise itself. The chat's option checks reverse clockwise points
  before the call (`src/optionChecks.js`), but a fluent user outside the chat
  still gets an inside-out extrusion from clockwise points. A list of paths
  must stay as given, since a clockwise path there may be a hole.
- jscad-fluent gaps against `@jscad/modeling`, answered "not available" by the
  fluent `docs`: compact binary, `poly2`/`poly3`, the `geometries` functions
  with no same-named fluent method, and the internal `utils` helpers
  (`areAllShapesTheSameType`, `fnNumberSort`, `insertSorted`).
- A `delete` tool for the chat (agent-loop, jscad-web). `write` with empty
  content leaves an empty file, not a deleted one. Add `delete` to both tool
  lists and the eval's backend when a fixture needs a file removed.
- CI eval run for the project environment (agent-loop). The file tools
  (`write`, `edit`, `run`) have passed the unit and e2e suites but no live
  run: run the 18-fixture suite on CI and compare with the regraded baseline.
- Chat writes whose storage write fails (jscad-web). `storeFile` only warns,
  so a failed rowboat write leaves the file in the cache, and the next load's
  rowboat merge can put the older stored copy back. Retry, or report the
  failure in the build report.
- In-app API help page for users (jscad-web). The `docs` tool answers only
  the chat's model; a page or panel over the same `api/index.json` and
  `docsTool` would let a user look up a function, its options and an example
  without asking the chat.
- Conservation no longer separates runs (eval grader): with `maxTurns` 8 and
  free saves, reads and lists, no run passed 12 counted calls, and
  discipline is 2 whenever a clean write verifies. Consider a lower threshold
  or counting wasted rounds.
- Option checks on transpiled OpenSCAD code. A `.scad` file gets the plain
  `@jscad/modeling` exports, not the option-checked copy
  (`apps/jscad-web/docs/architecture.md`, Unknown-option warnings), since the
  transpiler's calls are not the user's. Checking them would need warnings
  mapped back to the `.scad` source, and options the transpiler itself passes
  kept out.
- GPU sharing on the CI host (agent-loop eval). The describer needs about
  11.8 GB of the 12 GB card, so `npm run describe` stops while
  chatterbox-tts, an Ollama model it could not unload, or a CI job holds it.
  A lease the describer, Ollama, chatterbox-tts and CI jobs take turns on
  would let a complex pass describe without a person freeing the card.
- The describer's blind spot for open or missing tops (agent-loop eval).
  Moondream called the caboose with its roofs removed intact
  (`no-roof` in `eval/grader-validation/cases.js`), and asking it about
  missing or floating parts made it call broken models intact. No gate
  catches an open top either; a gate on the top cut, a ring where a closed
  object has a solid, would, for requests whose objects are closed.
- A cap on the `bodies` probe (agent-loop eval, `eval/probe.js`). It lists
  every body with no limit, so a model of about 5,000 bodies pushes the grade
  reply past the executor's 1 MiB cap; the whole grade becomes `NO_GRADE` and
  a complex run fails `builds` with no word on why. A cap that reports the
  count and drops the list past it would keep the grade and name the cause.
  No complex fixture comes near it.
- Calibrate the complex grader (agent-loop eval). Against the 39 reviewed
  runs in the evals repo (`calibration/2026-09-30T230517Z-labels.json`,
  labelled from renders, not yet reviewed by a person) the first grader agreed
  on 17. Palette colours for uncoloured parts, a raised side view, a top view,
  a describer prompt that asks about openings, and a judge that gets the
  measured size, solid and group counts and is told the views were described
  separately brought it to 23 to 25 over four rounds (`ci/regrade-complex`).
  The rest is the describer: Moondream names functional objects by shape
  ("modular furniture" for a cable clip, "two circular cutouts" for a
  toothbrush holder with a paste slot) and misses pawns, so the judge fails
  them fairly. Judge-wording changes now trade one error for another.
  Measured next steps: qwen3.5:9b as describer scored 10 of the 20 hardest
  runs against Moondream's 6 (about 3 s a view, 23 minutes a pass); DeepSeek
  with reasoning on scored 27 of 39 but changed 16 verdicts at about 15
  times the latency. Until agreement is well above this, complex verdicts are
  not a measure.

## UI (jscad-web)

From the 2026-10-01 review. Paths are under `apps/jscad-web` unless given in
full.

- **Long runs cannot be stopped.** The 120 s budget (`main.js:279-287`) is
  the only kill, and progress is an indeterminate bar
  (`src/frameSetup.js:246-263`). Streamed cell counts go only to
  `dataset.cells` for the sweep. The Zoom To Fit and Smooth Render toggles
  (`src/viewState.js:131-145`) re-run the model through `main.js:567`. Add
  Stop and a cell count, and apply zoom in the viewer.
- **Export gives no feedback.** `src/exporter.js:67-71` has no busy state and
  no catch, so a failure is an unhandled rejection. An empty result does
  nothing (`:98-99`). The file is named `jscad.<ext>` unless a folder was
  dropped (`:109-111`), and the name never resets on a project switch.
- **Number params clamp while typing.**
  `packages/params-ui/src/inputs.js:113-131` snaps and clamps on every
  `input` event: with `min: 10`, typing "50" gives "10" after the "5". Each
  keystroke schedules a run. Clamp on `change`.
- **Every code run resets parameters.** `main.js:601-603` resets the params
  controller on each load, and the tree is rebuilt collapsed
  (`packages/params-ui/src/ParamsTree.js:67-70`). Carry values and collapse
  state by param path when the param survives, and add a Reset control.
- **The drawers overlap.** `#ai-drawer` and `#project-drawer` are both fixed
  `right: 0`, 360 px wide, at z-index 40 and 41
  (`static/main.css:858-870`, `:904-916`), so opening chat with Projects open
  shows nothing new. `#model-options` at z-index 2000 (`main.css:476-488`)
  paints over both on phones.
- **Chat input.** The draft is cleared (`src/aiChat.js:364`) before the
  provider check (`:294-297`), so a missing key loses the message. Every
  chunk forces the scroll to the bottom (`:158`, `:170`, `:183`, `:239`,
  `:332`). The input is one line (`:73-74`). The error says "AI settings"
  where the dialog is titled "Chat settings".
- **Ctrl+S in a stored project opens a Save As picker**
  (`src/editor.js:58-61`, `:104-105`, `main.js:817-856`), or an error where
  the File System Access API is missing, though the run already stored the
  edit. The hint is at `static/index.html:89`.
- **Dark mode and the error bar.** `main.css:117-129` styles buttons and
  inputs light with no `.dark` variant, beyond the chat settings dialog in
  Remaining issues, and the project drawer borders (`main.css:957-986`) have none
  either. `#error-message` is `white-space: pre` (`:721-723`) and has no
  dismiss.

## Refactoring

Async module loading is the breaking one. The items after params-core come
from the 2026-10-01 review.

- **Async module loading.** Replace sync XHR in `readFileWeb.js` with
  `fetch()`, make `require()` async, parallelize loads. Breaking: needs a
  worker protocol update and a migration guide. 2–3 weeks.
- **Transpiler extraction.** `buildOutputCode()` out of the output builder
  (~170 lines); the 3 near-identical dedup loops in `processIncludeStatements()`
  into `bundling/deduplicator.ts`; 3 merge functions into
  `bundling/symbolMerger.ts` (~40 lines).
- **Worker extraction.** 220 lines of parameter logic into
  `src/parameters/parameterHandler.ts`; lock/generation code (77 lines) into
  `src/locks/scriptLock.ts`; Manifold eval + format conversion into
  `src/geometry/geometryProcessor.ts`.
- **require.js extraction.** CDN redirect, `.scad` search and `.ts` fallback
  into `loading/errorRecovery.ts`; JSON/custom extensions into
  `loading/formatHandler.ts`.
- **params-core proxy system (low priority).** `proxy/proxyHandlers.ts`,
  `proxy/discoveryTracker.ts`, `proxy/proxyFactory.ts`,
  `legacy/legacyConverter.ts`, `tree/treeBuilder.ts`.
- **Proxy-only params in jscad-web.** `useParamsProxy` is hard-wired `true`
  (`apps/jscad-web/main.js:153`), so the flat-form path (`:685-691`), the
  false arms at `:562` and `:769`, `genParams` and `AnimRunner` are dead
  there, and animation cannot start: `toParamDefinitions`
  (`packages/params-core/src/createParamsProxy.js:536-546`) emits no `fps`
  or `autostart`. `main.js:522` calls `setParamValues(times, true)` against a
  `(name, value)` setter, and `:567` passes the `OrbitControl`'s nonexistent
  `params`. The worker's non-proxy branches stay live for the demo apps.
  Delete the jscad-web path or port animation to the params tree.
- **Module state in `main.js` and `paramsUI.js`.** `apps/jscad-web/main.js`
  is 1,020 lines with 14 module-level `let`s, mixing rowboat setup, script
  loading, editor save, chat setup, the project panel and drop handling.
  `src/paramsUI.js:53-80` keeps a scheduler in 10 module `let`s. Its
  `runParamChange` re-entries (`:255`, `:313`) are not awaited and can reject
  unhandled. `getParamsController`, `getParamsTreeView`,
  `isModelUpdatePending` and `setModelUpdatePending` have no caller.
- **Dead transpiler helpers.**
  `packages/openscad/src/transpiler/helpers/{color,extrusions,imports,transforms,vector}.ts`
  (354 lines) have no caller, and `extrusions.ts:92` emits an unbound
  `_globalFn`. The `used*` sets in `CodeGenState` (about 50 writes, copy and
  merge at `transpile.ts:292-300` and `:750-758`) are read only by them.
- **Worker replay in two places.** `apps/jscad-web/src/frameSetup.js:23-125`
  replays inits, files and script to a replacement worker, and the frame
  does the same (`src_frame/workerPool.js:38-43`, `:177-205`). `NEEDS_MODEL`
  is duplicated (`workerPool.js:6`, `frameSetup.js:100`). After a kill
  `main()` runs twice and the replayed inits are mirrored to every spare.
  Let the frame own replay.
- **Three model runners.** The frame worker,
  `packages/agent-loop/eval/backend.js:56-149` and
  `packages/openscad/bin/run-jscad.js`. The last swallows module eval errors
  (`:554-558`, `:589-590`), reports a `.js` eval error as "Module not found"
  (`:611-616`), hand-lists the manifold API without `curves`, `modifiers`,
  `utils` or the conversions (`createRuntime`, `:198-382`), and never resets
  `setGlobalFn` between in-process runs (`:665`, `:780`).
- **Worker loose ends.** `packages/worker/worker.js:312-316` reads a free
  `importData` (the real one is `workerState.importData`), so a `File` param
  throws `ReferenceError`. `WorkerState.clearParams`, `setScript`,
  `configure`, `_lastProxyState` and `setScriptLockTimeout` are unused, and
  `:78` names a `clearWorkerState` that does not exist.
  `apps/jscad-web/src_frame/bundle.frame-worker.js:52-56` and `:115-130` flip
  `scadPreview` around `await jscadMain` outside the `withSolids` queue.
- **Superseded errors have two shapes.** The frame answers
  `name: 'SupersededError'`, but the worker throws plain `Error`s saying
  "superseded" (`worker.js:283`, `:507`, `:549`, `:574`), and the app checks
  only the name (`main.js:705`, `:775`, `src/paramsUI.js:240`, `:299`).
  `runModelUpdate` and `main.js:776` show worker-abandoned runs as errors.
- **Package boundaries.** `packages/require/src/require.js:13,15` and
  `packages/worker/worker.js:9` import sibling packages by relative path
  without declaring them. There are 25 deep `@jscadui/<pkg>/(src|api|esm)/`
  imports. The app imports frame modules: `src_frame/fileMap.js`
  (`main.js:65`, `src/error.js:1`) and `src_frame/frameHost.js`
  (`src/paramsUI.js:8`). The legacy `requireCache` getters `module` and
  `moduleAccessOrder` (`packages/require/src/caching/cacheManager.ts:409-426`)
  have no callers.
- **Silent catches on the model path.** `worker.js:291` and `:567` (the
  modeling bundle require), `apps/jscad-web/main.js:613`,
  `src_frame/optionWarnings.js:19-21` and `:33`, and
  `packages/agent-loop/eval/backend.js:298-300`. Each hides the cause behind
  a later, different error.
- **Leftovers.** 161 review-tracker labels ("C6 fix", "M11 fix") across 49
  files. From jscad-studio: `apps/jscad-web/src/studioBridge.js`
  (`globalThis.jscadStudio`, read only by its test), the `StudioServer` name
  (`server/src/index.ts:37`, `:47`, `:72`), `package-lock.json` entries for
  the removed apps, and the frame title "jscad studio compute frame"
  (`static/frame/index.html:15`).
- **Demo apps.** `observeResize.js` has 4 identical copies and `testThree.js`
  3, `esbuildUtil.js` has 4 drifted ones, `apps/vue3-jscad/src/jscad/` holds
  12 older copies of jscad-web modules, and `apps/linearcs/build_dev/` (784
  KB of build output) is tracked.
- **`params-ui` size.** `createParamsTree`
  (`packages/params-ui/src/ParamsTree.js:30-618`) is one closure of about
  590 lines. `createClassInput` (`:338-545`) and `inputs.js` (996 lines) are
  the seams.

## Remaining issues

- **`npm install` inside a workspace crashes on the CI host.** npm 11.16.0
  (node 24.18) fails in `packages/openscad` with `TypeError: Cannot read
  properties of null (reading 'package')` in arborist's `set root`, on main
  and on consolidate alike since 2026-09-29; the root install succeeds.
  `ci/test` no longer runs the redundant member install. Not caused by the
  lockfile or agent-loop's new devDependencies (both ruled out on a CI
  scratch tree); the `@jscad/modeling` and `@jscad/modeling-for-manifold`
  links share one realpath, which is where arborist's link lookup runs.
- **jscad-fluent 0.7.0 not yet published.** `extrudeLinear`/`extrudeRotate`/`offset`
  on a `FluentGeom2` used to crash under the manifold engine (`Object.assign`
  copying dropped `ManifoldGeom2`/`ManifoldGeom3`'s prototype getters). Fixed
  by pinning jscad-fluent through `scripts/deps/sources.json`
  (`.deps-cache/jscad-fluent`, built by `fetch-sources.js`) instead of the npm
  0.6.1 release; the pin is now 90bd6e7 on `main`, which also rejects raw
  `{ points, faces }` data in constructors and booleans, and adds
  the `@jscad/modeling` parity surface. Remaining work: publish jscad-fluent
  0.7.0 from jscad-fluent's `main` to npm, then point `apps/jscad-web/package.json` and
  `packages/agent-loop/package.json` back at the npm version and remove the
  `sources.json` entry (also its `jscad-anchors` entry, if fluent no longer
  needs it). Until then, the eval resolves fluent's `@jbroll/jscad-anchors`
  to the pinned sibling checkout (ba632c6, unreleased manifold anchor fixes)
  while the frame loads CDN `@jbroll/jscad-anchors@0.1` (`frameHost.js:18`),
  so eval results for anchor models may differ from the app.
- **Editor lint, autocomplete and hover from the API index (jscad-web,
  agent-loop).** Next spec after the docs tool. CodeMirror 6 plugins on the
  Lezer tree `lang-javascript` already builds (no TypeScript, too heavy):
  lint calls to known functions whose first argument is an object literal
  for unknown option keys and unknown function names, plus Lezer's syntax
  errors; autocomplete function and option names with defaults; hover shows
  the `docs` entry. The lint rules are a pure function over a Lezer tree, so
  `write`, `edit` and `run` run the same check on the source and return
  static warnings beside the runtime ones. Static checks see only inline
  literals; the runtime wrapper still covers built or spread options.
  (`apps/jscad-web/src/editor.js`, `packages/agent-loop/api/index.json`)
- **Trim project files in chat context (agent-loop).** `buildMessages` sends
  every text file of the project outside the 24,000-character budget. Large
  projects need trimming, most recently mentioned files first.
  (`packages/agent-loop/src/context.js`)
- **Production relay chat logging (jscad-web server).** Only the launcher
  relay logs conversations. Logging in `server/src/relay` needs the user's
  opt-in before anything is written.
- **Eval cannot load `@jbroll/jscad-anchors` (agent-loop).** It is not
  installed, so model code requiring it fails in `eval/backend.js` while the
  frame serves it from the CDN.
- **Image tool results for `view` (agent-loop).** Send the screenshot as an
  image block (Anthropic `tool_result` image content, Responses `input_image`;
  chat completions cannot carry images in tool results) and offer `view`
  again only where supported. Add it when an eval fixture fails in a way only
  a picture would catch, and measure it with the eval. Cost: each image is
  roughly width×height/750 tokens on Anthropic and is resent on every later
  round of a turn.

- **Chat settings follow-ups (jscad-web).** `e2e/ai-chat.spec.js` was
  updated for the gear dialog but not yet run through simple-ci. The model
  list has not been seen with a real Meta key. Form controls stay light in
  dark mode, and the drawer header wraps the gear onto its own line when the
  sign-in copy is long.

- **Accessibility.** Input-level ARIA exists; still missing are tree and
  toolbar roles, keyboard navigation for the param and file trees, modal
  focus trap and `aria-expanded` on collapsibles.
  (`packages/params-ui`, `apps/jscad-web`)
- **Adopt org-hooks `sci-tiered` for the commit gate.** org-hooks has the
  monorepo scan-root and coverage knobs (2026-09-27); jscadui still runs
  `.git-hooks/pre-commit`. Remaining: `lefthook.yml` from the org-hooks stub
  on `profiles/sci-tiered.yml`; biome, knip and dpdm scoped to own-origin
  packages (demo apps and `file-format/*` exempt, still tested); a
  `ci/before-test-push` that lists `apps/` and `file-format/` changes; lcov
  from `ci/test`; a `ci/e2e` shim running the full render sweep; a Playwright
  json reporter; then seed the coverage baseline and retire `.git-hooks/`.
  The render sweep emits no lcov, so the tier-2 coverage ratchet needs e2e
  V8 coverage or an upstream knob for a regression-only e2e.
- **3MF export workspace.** Nothing in this repo imports
  `file-format/3mf-export`; the only consumer is the `manifold-3d` npm
  package (`lib/export-3mf.js`), whose `@jscadui/3mf-export ^0.5.0`
  dependency the workspace satisfies. The workspace is not the published
  0.5.0: it carries the unpublished fast-xml-parser rewrite (#131), XML
  escaping and input validation under the same version number. Its
  `matrix2str` turns non-number entries into `0`, and manifold passes
  transforms as `toFixed` strings, so under the workspace copy manifold's
  component transforms serialize as all zeros; the registry 0.5.0 passes
  them through. Publish the rewrite as 0.6.0 (with string transforms kept)
  or drop the workspace and resolve 0.5.0 from the registry.
- **Params memory follow-up.** Child-proxy eviction recreates the child with
  fresh per-proxy defaults; only matters if 500 distinct properties are
  probed on one proxy between a set and a read of the same child.
