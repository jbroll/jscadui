# Backlog

Outstanding work, roughly in the order it should land. Delete an item in the
commit that completes it.

## Finding IDs

Stable IDs for the open review findings below; the prose bullet each ID points
at is the requirement text. Reserved for new findings: `SEC3+`, `PRJ6+`,
`UI7+`, `API17+`, `REF19+`, `TRN3+`, `LIB2+`, `FMT2+`.

| ID | Section | Sev | Primary files |
|---|---|---|---|
| API4 | Chat API help | Low | `.deps-cache/jscad-fluent` (external) |
| PRJ5 | Projects and storage | Low | `apps/jscad-web/scripts/local/fsApi.js` |
| REF1 | Refactoring | High | breaking, out of scope |
| REF3 | Refactoring | Med | out of scope (`packages/worker`) |
| REF4 | Refactoring | Low | out of scope (`packages/require`) |
| REF5 | Refactoring | Low | out of scope (`params-core`) |
| REF7 | Refactoring | Med | out of scope (`main.js`, `paramsUI.js`) |
| REF9 | Refactoring | Med | out of scope (`src_frame`, `frameSetup.js`) |
| REF10 | Refactoring | Med | out of scope (model runners) |
| REF21 | Refactoring | Low | `packages/demo-utils/src/jscad/`, `apps/jscad-web/src/` |

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
`da49cf0a`). 2026-10-11: deployed `5b2b059d`, the project and storage
residuals batch (boot opens the most recent project; per-path dirty buffer
with a discard confirm; an in-flight chat turn persists under its own project;
conversations route by the project's mode with a New-chat reset; project
delete; mode-flip moves the project; sign-out tears down sync) plus the earlier
parts-group1 hardening; smoke passed (app build `f54c2112`, frame `0dceb65c`).
See `apps/jscad-web/docs/architecture.md` for the
deploy order and headers.

## Security

From the 2026-10-01 code review, each item checked against `main`
(`2ec5b5a8`) by reading the code. None was tried in a browser. Paths are
under `apps/jscad-web` unless given in full.

- **The relay rate limit keys on a spoofable address.** `server/src/index.ts:69`
  sets `trust proxy` to `true`, so `req.ip` is the leftmost `X-Forwarded-For`
  entry, which the Apache proxy block (deploy.sh `modules/apache/build.sh:116-124`)
  passes through from the client. A curl client with a forged `Origin` bypasses
  the 60/min limit. Landed: `trust proxy` `'loopback'` plus idle-bucket
  eviction (`createLimiter`, `relay/policy.js`), so the relay keys on the
  address Apache appended and the map no longer grows without bound.
  Remaining: point better-auth's IP header at the same value.
  A deploy decision — `deploy.sh` is not in this repo.
- **No CSP or COOP on the app origin.** The deploy's header block (deploy.sh
  `modules/apache/build.sh:229-248`) sets neither, and `static/index.html`
  has no CSP meta. Device-mode API keys sit in `localStorage` as plain JSON
  (`packages/key-store/src/keys.js:60`), so any future script injection on
  the app origin reads them. Add `Cross-Origin-Opener-Policy: same-origin`
  and a CSP: `script-src 'self'`, `frame-src` the run host, `connect-src`
  self, rowboat and the provider hosts. A deploy decision — `deploy.sh` is not
  in this repo.

## Free jscad-web models follow-ups

Deferred from the jscad-web inference reframe reviews (`feat/jscad-inference-relay`,
2026-10-16). Paths under `apps/jscad-web` unless given in full. Live since
2026-10-16 with `deepseek-flash` + `muse` in `/etc/jscad-relay/jscad-inference.json`.

- **e2e parity test is `fixme`d.** `e2e/ai-chat.spec.js` `answers each tool
  call as the eval backend does` fails on `main` too: `PARITY_ROUNDS` (36)
  exceeds the loop's `DEFAULT_MAX_ROUNDS` (32), and the app's default project
  adds a file the eval backend lacks. Follow-up owns the coverage decision
  (trim `PARITY_ROUNDS`, raise the cap, or seed the eval project).
- **Retention filename coupling is untested.** `server/src/relay/routes.ts`
  hard-codes `/^\d{4}-\d{2}-\d{2}\.jsonl$/` while the writer's convention
  lives in `server/src/relay/chatLog.js`; if the layout ever changes,
  pruning silently stops matching. Add a cross test or share a
  `logFileName(ts)` helper.
- **Clamp `CHAT_LOG_RETAIN_DAYS`.** A negative value prunes everything
  including today; a huge value throws `RangeError` at boot
  (`server/src/relay/routes.ts`).
- **Client abort during connect logs a misleading 502.** A free close
  before the fetch settles is recorded as `upstream unreachable` with no
  `error` field; distinguish `client closed` for the `chat-review` loop.
- **Drain-wait hang (pre-existing).** If the client closes exactly when
  `res.write` returned false, `forward` never returns and the turn escapes
  logging (`server/src/relay/routes.ts`).
- **Free drawer summary shows the raw option id** until the gear dialog is
  opened (the inference catalog is fetched only on open). Fetch at init or persist
  the label (`src/aiAccount.js`).
- **Weak inference-option validation.** Filter on more than `id` + `model` so a
  label-less option cannot render a bare model id
  (`src/aiAccount.js`).
- **Meter hardening.** Reject non-numeric `ipSpend` values on state load
  (a string bucket never trips); pin the non-2xx estimate-charge path with
  a test; handle hex-form IPv4-mapped addresses in `ipGroup`
  (`server/src/relay/meter.ts`).
- **Corrupt spend file stops the whole server**, including auth/sync.
  Consider failing closed on the free hook only
  (`server/src/relay/routes.ts`).
- **No global in-flight cap on the free hook**; a client holding several
  IPv6 /64s multiplies the overshoot bound. Operator-visible ceiling only.
- **`available` reflects the month budget only**; daily-capped users learn
  on POST. UX polish.
- **Unknown model ids fall through to `v1/chat/completions`**; a typo'd
  responses model 4xxs and burns estimate. Note in `server/RELAY.md`.
- **Pre-upstream failures (allowlist/dns) write no log record** on the
  free hook; add `tee.finish` with `costUsd: 0` if the loop should see
  them.

## Chat tools follow-ups (2026-10-17 e2e)

Found by `e2e/ai-chat-tools.spec.js` (plan `docs/superpowers/plans/2026-10-17-chat-tools-e2e.md`); tests pin current behavior, fixes owned here.

- **Session-custody Tavily key never reaches the search handler.**
  `main.js:991` builds a second `createSearchStores` instance while
  `aiAccount.js:61` owns the dialog's; `session` custody lives in per-instance
  memory (`packages/key-store/src/keys.js`), so a session-mode Tavily key is
  invisible to `aiSearch.js:91`'s relay fallback and the fallback is silently
  unreachable. The e2e test uses `device` custody. Decide: share one store
  instance or document that Tavily needs device/synced custody.
- **The loop's 120 s tool timeout caps an unanswered `question`.**
  `runTurnLocal` passes no `toolTimeoutMs` (`src/aiChat.js`), so a user
  thinking for over two minutes gets a `ToolTimeoutError` that ends the turn;
  a late answer resolves into an abandoned promise. Either pass a longer
  timeout for question-bearing turns or document the cap.

## Chat review follow-ups (2026-10-19)

From reviewing the 09-30 local and 10-19 production logs (chats bb17e98f,
037181f1). The execute, view part-reference and negative-angle stumbles are
fixed; these remain.

- **Agent writes can destroy the user's model.** In bb17e98f about eight
  experiment writes replaced a 70-part Jeep in `main.js` with text tests, and
  the next turn's request carried only the clobbered snapshot, so the agent
  could not restore it. Needs undo or history for agent writes in the app, and
  `view` of a scratch model so experiments need no save.
- **A stray scratch rejection clears the loaded model.** The worker's
  `unhandledrejection` handler calls `workerState.clearGeometry()`
  (`packages/worker/worker.js`), so an un-awaited rejected Promise in an
  `execute` snippet can wipe the build's solids. Async work a snippet does not
  await also runs after its build context closes.
- **Build and scratch contexts can restore out of order.** `jscadMain` and a
  scratch run that interleave across awaits each restore
  `globalThis.__jscadBuild` from what they saw on entry.
- **`measure*` at a build's top level rejects in the app.** Only `main()` runs
  inside the build context; a scratch run now covers its top level too.
- **`measure` accepts a reversed range.** `parts: "3-1"` selects nothing and
  returns a zero box; `view` refuses it. Reject it with the forms error.
- **Upstream angle checks (`@jscad/modeling`).** `star` says "startAngle must
  be greater than zero" and arc, ellipse, torus and cylinderElliptic say "must
  be positive", but all accept zero and take the angle mod TAU. Drop the
  `isGTE(…, 0)` checks and wrap instead; `optionChecks.js` wraps on our side
  meanwhile.
- **`read-log` loses review evidence.** `view` images (sent as a following
  user message) are kept only as camera JSON; Responses-API `refusal` content
  decodes blank; the app's "Maximum steps reached" message counts as a user
  turn; records without a chat id each become a conversation; and a session's
  last tool result never appears, since results arrive in the next request.
- **Prompt and fixture work for chat-review.** "10:1 scale model" read as an
  enlargement (037181f1 built a 35 m Jeep without asking), and text on a
  vertical face came out mirrored and inside-out after ten rounds (bb17e98f).
  Neither has a fixture; `nameplate` and `luggage-tag` cover flat text only.

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
capped at 4 GB and 20,000 entities per grid
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

V1 `.jscad` cells (classic CSG from the app's CSG-compat shim) used to vanish
silently: modeling's measure reports a zero box for them and modeling's
transforms leave them untouched, so `normalizeAndPlace` returned `[]` with no
failure logged (gilboonet polyhedra 12 items → 0 geoms). The grid now measures
V1 with `getBounds` and places it with its own `translate`/`scale`; nested
contexts apply as scale+translate, which is all `subGridContext` builds.
`jscad-hardware` has no grid: its `src/` files are ES-module libraries with no
`main` (excluded from grids and the demo browser) and its `examples/`+`v1/`
models need a V1-compat harness (see its `skip.txt`).

## Library bugs found by the sweep

- **`!` root modifier is ignored.** OpenSCAD renders only the `!` subtree;
  we render the whole model. Needs `main()` to return that subtree with its
  ancestors' transforms, which the `%`/`#` overlay channel does not provide.
- **`use <font.ttf>` gaps.** A font `use` inside an included file does
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

- Runs started from a Claude session are still reaped under memory pressure.
- Eval grades can be forged by model code during its own grade, since
  `measure` and `check` run in the executor beside it. Measuring serialized
  geometry in a second process would close it; left as is because the model
  gains only a false score for its own run, and a fresh executor per grade
  already stops one run affecting another.
- Stack-gated fluent method checks, if `eval/fluent-guard.test.js` ever finds
  a false warning from fluent's internals. The method checks wrap the shared
  prototypes, so they see fluent's own calls as well as the model's; a
  fluent release that calls its own option-taking methods with options the
  table lacks would need the check to warn only when the caller is project
  code.
- `jf.polygon` in jscad-fluent should list a single flat outline
  counter-clockwise itself. The chat's option checks reverse clockwise points
  before the call (`src/optionChecks.js`), but a fluent user outside the chat
  still gets an inside-out extrusion from clockwise points. A list of paths
  must stay as given, since a clockwise path there may be a hole.
- jscad-fluent gaps against `@jscad/modeling`, answered "not available" by the
  fluent `docs`: compact binary, `poly2`/`poly3`, the `geometries` functions
  with no same-named fluent method, and the internal `utils` helpers
  (`areAllShapesTheSameType`, `fnNumberSort`, `insertSorted`).
- CI eval run for the project environment (agent-loop). The file tools
  (`write`, `edit`, `run`) have passed the unit and e2e suites but no live
  run: run the 18-fixture suite on CI and compare with the regraded baseline.
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
## Parts catalog

The catalog covers 37 families (`packages/parts/README.md`): fasteners,
bearings, linear motion, extrusions, fans, switches, connectors, passives and
motors. A survey of the corpus on 2026-10-01 found the
candidates below; the NopSCADlib hardware that fits the record format as it
stands was added on `parts-group1`, through the switch, connector and motor
batch (toggle, rocker, d_plug/d_socket, gear_motor).

- **More NopSCADlib hardware.** Admitted on `parts-group1`: `comp_spring`
  (`springs`, 3), `shaft_coupling` (2), `internal_circlip` (DIN 472, 6),
  `square_button` (6x6/12x12 tact, 4), `led` (3–10 mm, list `LEDs`), `battery`
  (AA..18650..4680, 10), `tubing` (PTFE 2x4 Bowden, 16), `ziptie` (3),
  `green_terminal` (`insertArgs: [2]` for the required `ways`),
  `potentiometer`, `toggle` (`insertArgs: [3]` for the panel thickness),
  `rocker` (`insertArgs: ["red"]` for the colour; `names`, since
  `neon_indicator` is an indicator, not a switch), `d_plug` and `d_socket` in
  `d_connector.scad` (booleans via `options`), `gear_motor` (`core.scad` +
  screws prelude). Deferred:
  `pcb` (per-product entries, no canonical size list, largest include web),
  `display` (vendor assemblies, includes all of `pcbs.scad`), `belt` (needs a
  per-model pulley path no fixed `insertArgs` can express), `geared_stepper`
  (blocked on the leading-digit size names below).
- **Size names that are not JS identifiers.** NopSCADlib names such as
  `28BYJ_48`, `2p54header`, `9DOF_stick` and the `7_segments` entries start
  with a digit, so the require line cannot destructure them. They need a
  mangled export name or a record form that passes the value without naming
  it.
- **Standard features you cut or print, not buy.** BOSL2 `screw_hole`
  (clearance, counterbore, countersink or tapped, by `"M3,10"` and tolerance;
  check against ISO 273 clearance, M3 normal = 3.4), `nut_trap_side` and
  `nut_trap_inline`, `nema_mount_mask` (11–34), involute `spur_gear`, `rack`
  and `ring_gear` (check `outer_radius` = m(z+2)/2), `pco1881_neck`/`_cap`,
  `pco1810_*`, `sp_neck`/`sp_cap` (SPI 400/410/415), `npt_threaded_rod` and
  `bspp_threaded_rod`, `trapezoidal_threaded_rod`/`_nut` (Tr8x8),
  `snap_pin`/`snap_pin_socket`, `knuckle_hinge`, `modular_hose` (Loc-Line),
  `manfrotto_rc2_plate`; and `lmXuu_bearing` and `shoulder_screw` as BSD
  alternatives to NopSCADlib hardware. The record format needs a way to place
  the size after other arguments (`nut_trap_side(trap_width, spec)`) or pass
  an option set (`spur_gear({mod, teeth, thickness})`), and the catalog a
  "feature" kind whose check measures the cut, not a bought part. Gears,
  worms and long threaded rods are slow to build.
- **Libraries not yet under `/libs/`.** Each needs a `scripts/deps/manifest.json`
  mapping into `apps/jscad-web/libs/` with its license file.
  - threads-scad (CC0): printable ISO metric `MetricBolt`, `MetricNut`,
    `MetricWasher` (numeric size, length as an argument). Its `ScrewHole`,
    `ClearanceHole` and countersunk variants subtract from `children()`, so
    they need a wrapper. The file calls `Demo()` at top level, so `use` it.
  - gridfinity-rebuilt (MIT): bins and baseplates on the 42 mm grid. A bin is
    built with `new_bin(...)` and drawn with `bin_render(bin)`, so it needs a
    wrapper module keyed by `[gx, gy]` and height units.
  - threadlib (BSD-3): about 950 designators (ISO metric, UNC/UNF/UNEF, G
    pipe, PCO-1810/1881, RMS) through `bolt`, `nut`, `tap`. It depends on
    IoP-satellite `thread_profile.scad` and list-comprehension-demos
    `skin.scad`, neither with a stated license; settle that first. Slow.
  - MCAD: per-file licenses are mixed (LGPL-2.1, GPL-3/LGPL dual,
    CC-BY-SA-3.0+LGPL, CC-BY-3.0, public domain). Useful: `bearing` (608..63xx,
    MR series; the model is the third parameter and an unknown model silently
    draws a 608), LEGO-compatible `block` (public domain), servos SG90/S3003/
    DS420, `stepper_motor_mount`. `nuts_and_bolts.scad` misses a comma after
    the M20 entries of two tables, so M20 and up read wrong values.
  - Not suitable: yapp-box (global-variable driven), constructive (framework
    bound), snippet (unitless props), the utility libraries (round-anything,
    obiscad, relativity, closepoints, dotscad), gears (CC-BY-NC).

- **A unified facade over preferred entries.** Each family's `preferred`
  record uses its own library's call and size scheme (`nut(M3_nut)` vs.
  `nut("M3")`); a facade that gives every family one call shape, built over
  the preferred entries, is out of scope for now.
- **A second sweep axis.** The size sweep builds every listed size with the
  same fixed arguments after it (`insertArgs`), so a length never varies:
  BOSL2 `screw` sweeps `"M2,10"` .. `"M8,10"` and NopSCADlib `screw` sweeps
  its seven cap screws, all at 10 mm. A record-level way to sweep a second
  axis (length, say) would catch a bug that only shows at a different
  length.
- **The parts eval fixtures' probes are bounding-box relative.**
  `nema17-mount` checks for a centre hole at least 22 mm wide, not that it
  sits centred among the four screw holes.

## Refactoring

Async module loading is the breaking one. The items after params-core come
from the 2026-10-01 review.

- **Async module loading.** Replace sync XHR in `readFileWeb.js` with
  `fetch()`, make `require()` async, parallelize loads. Breaking: needs a
  worker protocol update and a migration guide. 2–3 weeks.
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
- **Module state in `main.js` and `paramsUI.js`.** `apps/jscad-web/main.js`
  is 1,020 lines with 14 module-level `let`s, mixing rowboat setup, script
  loading, editor save, chat setup, the project panel and drop handling.
  `src/paramsUI.js:53-80` keeps a scheduler in 10 module `let`s. Its
  `runParamChange` re-entries (`:255`, `:313`) are not awaited and can reject
  unhandled. `getParamsController`, `getParamsTreeView`,
  `isModelUpdatePending` and `setModelUpdatePending` have no caller.
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
- **Leftovers.** Review-tracker labels ("C6 fix", "M11 fix") remain in
  source files; remove them as each file is touched.
- **Demo helpers still split from `jscad-web`.** The demo-helper move put the
  vue3-jscad nine modules (`drawer`, `editor`, `engine`, `examples`, `exporter`, `menu`,
  `remote`, `themes`, `viewState`) into `packages/demo-utils/src/jscad/`, but
  `apps/jscad-web/src/` keeps its own diverged copies of the same modules,
  both with live consumers. The move could not merge them because
  `apps/jscad-web/src` was outside its file set; a real merge needs those
  sources and a per-module behaviour review.

## Remaining issues

- **Intermittent phantom `Syntax error` in `editor-api.test.js` under parallel
  turbo load (open, backlogged 2026-10-16).** `apps/jscad-web/test/editor-api.test.js
  > flags an unknown option` twice returned a single
  `{severity: 'error', message: 'Syntax error', from: 58, to: 59}` diagnostic
  for valid JavaScript instead of the expected unknown-option warning. The lint
  path (`apiDiagnostics` → `lintTree` over the static `api/index.json`) is pure
  with no shared state across vitest workers, so a wrong tree points at
  load-induced corruption, not logic: both reds came from full parallel turbo
  runs (`npm run test:unit`, 55 tasks), against ~15 green isolated runs, plain
  full-suite runs, and repeat `test:unit` runs. When it recurs, log
  `state.doc.toString()` and the lezer tree shape on mismatch instead of
  re-running blind; do not "fix" with a retry, which would mask real lint
  regressions.

- **The CI host has no `rowboat` sibling beside a job worktree, so
  `ci/web` and `ci/render` fail at setup.** `apps/jscad-web/package.json` and
  its `server/` link rowboat through `file:../../../rowboat/...` (three levels
  up from `apps/jscad-web`), which resolves to a sibling of the repo root. The
  simple-ci job worktree nests the repo one level deeper
  (`/data/john/ci-worktrees/jscadui-<id>/jscadui/apps/jscad-web`), so
  `../../../rowboat` lands at `jscadui-<id>/rowboat`, not the `/data/john/ci-worktrees/rowboat`
  mirror. npm install silently omits the rowboat packages, then
  `apps/jscad-web/build.js:30` fails reading the source path, the workspace
  build falls back to "continuing", and every bundle-dependent and
  rowboat-importing suite fails (`storage-rowboat`,
  `storage-manifest`, `fluent-worker`). Fix on the host: give each job a
  `rowboat` sibling (or have simple-ci place the worktree where the relative
  link resolves). Observed 2026-10-11 on jobs `08550e54` (web) and `866480ec`
  (render).
- **`npm install` inside a workspace crashes on the CI host.** Observed with
  npm 11.16.0 (node 24.18) failing in `packages/openscad` with `TypeError:
  Cannot read properties of null (reading 'package')` in arborist's `set root`,
  on main and on consolidate alike since 2026-09-29; the root install succeeds.
  The host's npm was upgraded to 12.2.0 (2026-10-11), so this needs re-checking
  under that version. `ci/test` no longer runs the redundant member install.
  Not caused by the lockfile or agent-loop's new devDependencies (both ruled
  out on a CI scratch tree); the `@jscad/modeling` and
  `@jscad/modeling-for-manifold` links share one realpath, which is where
  arborist's link lookup runs.
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
  to the pinned sibling checkout (a2c4b6c, tree-node support plus the earlier
  unreleased manifold anchor fixes) while the frame serves the local
  `bundle.jscad-anchors.js` build of the same checkout (`frameHost.js:18`),
  so eval results for anchor models may differ from the app.
- **Eval cannot load `@jbroll/jscad-anchors` (agent-loop).** It is not
  installed, so model code requiring it fails in `eval/backend.js` while the
  frame serves its local `bundle.jscad-anchors.js` build.
- **Simulated-user dialogue suite (agent-loop eval).** A run sends the prompt
  and scripted `followUps` only (`runConversation`, `eval/run-eval.js`), so
  the eval cannot tell a needed question from a wasted one and scores any
  question as a failure. An opt-in `dialogue` group would give a fixture a
  `persona` and a hidden `intent`, one entry per fact, each marked whether a
  wrong guess wastes the build; a pinned cheap model at temperature 0, with no
  tools and no executor, answers the agent from it. Acceptance comes from the
  fixture's checks, never the user model, which an agent reply could talk
  into accepting. Later turns go through `buildMessages` as in the app, so
  tool results do not carry across user turns. Score acceptance, user turns
  before it, necessary, unnecessary and missed questions, the share of guessed
  defaults the agent stated, and turns that asked without building. Gate: two
  runs on one prompt agree within 1.0 per fixture on a 0 to 8 total. Waits on
  Calibrate the complex grader (Chat API help) reaching usable agreement,
  since the user model is a second unvalidated model in grading.
- **`assembly` fixture group (agent-loop eval).** Fixtures whose parts fit
  together: an enclosure with a lid and board posts, two shelf brackets with
  a cleat, a drawer in a frame. Checks test fit, not process (the lid covers
  the opening, the drawer clears the frame, the posts sit inside the walls),
  so a single-file answer that fits passes. `gradeProject`
  (`eval/backend.js`) measures only the whole, so the grade needs each
  part's measure, or a probe, first. Baseline the group on the current
  prompt before plan-then-build is measured on it, by rounds and `checkRate`.
  Gate: `--regrade` of the existing baselines moves no other fixture's total.

- **Chat settings follow-ups (jscad-web).** The model list has not been seen
  with a real Meta key. Form controls stay light in dark mode, and the drawer
  header wraps the gear onto its own line when the sign-in copy is long.

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
- **Params memory follow-up.** Child-proxy eviction recreates the child with
  fresh per-proxy defaults; only matters if 500 distinct properties are
  probed on one proxy between a set and a read of the same child.
- **Token-aware context budgets (agent-loop).** Budgets are characters
  (`CONTEXT_BUDGET`, per-result and per-turn caps); usage tokens stream in
  but never feed eviction. Count provider tokens toward `partitionTranscript`
  and prune against them.
- **Subagent/task delegation (agent-loop).** Single flat agent only; opencode,
  pi-class harnesses and Claude Code fan read-only research into a child loop
  whose summary alone returns to the parent. Needs the permission narrowing
  and budget accounting those designs pair with it.
- **Persisted tool trail (jscad-web chat).** The transcript stores user and
  assistant text plus mentions and reasoning; tool calls and results live
  only in the turn. A resumed conversation never shows what the tools did.
