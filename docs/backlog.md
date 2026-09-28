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
(app build `d651ba36`, frame `63973ab6`).
See `apps/jscad-web/docs/architecture.md` for the
deploy order and headers.

## Render sweep

Baseline 1223/1420 on manifold (CI job `4fa53806f2e17742`), plus 74
text-only models that run clean and only echo. The 197 recorded failures are
the 25 pre-existing ones plus suites the 09-23 baseline never swept:
echo-only, 2D-only and assert/error negative tests, include/use wiring and
helper modules, empty-by-construction models, `%`/`#` display modifiers (the
viewport drops them), `$t` animations, and unfixable content (removed
`assign()`, a Windows include path, missing upstream files). 20 BOSL2 doc
examples that call a function as a statement, or do not parse, went from
text-only to empty once `std.scad` stopped echoing include warnings. The sweep
exits nonzero only on a regression against `render-baseline.json`. See
`apps/jscad-web/e2e/RENDER-TESTING.md`.

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

- **`%` background (and `#` highlight) modifiers draw nothing**: the
  transpiler emits `undefined` for `%child` (`statements.ts`), so with the
  viewport's `$preview=true` the branch vanishes instead of ghosting (e.g.
  `rubber_duck_debugging.scad`, `issue1005.scad`). Comparison grades these
  with `$preview=false` and passes. Recorded as render empties.
  Tried 2026-09-27 and reverted: emitting the child behind a
  `$preview` conditional renders it solid at preview=true, but reference
  OpenSCAD excludes `%` from STL exports even at preview=true (verified
  against the flatpak) while nopscadlib must grade at preview=true for its
  `if($preview)` gates, so 9 nopscadlib models regressed (137/146 vs a
  146/146 clean-tree baseline on the same host). Ghosting needs tagged
  geometry the STL path strips, not a transpiler conditional.

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

The app defaults to manifold; the other engine renders **1175/1420** (CI job
`c2e8a724e49b25ae`, `sci push jscadui/render-jscad`), plus 75 text-only, with
`apps/jscad-web/e2e/render-jscad-baseline.json` holding the per-model state.
195 of its 245 failures fail on manifold too. The STL comparison suite only
runs manifold, so that sweep is the only thing covering this engine. Run one
model with `display-check.js --engine jscad`.

- **`scale()` with a zero or negative factor throws.** 22 models fail with
  `factors must be positive` from the modeling `scale`: all 16 yapp-box
  examples, `threads.scad` and five openscad-tests. OpenSCAD accepts these
  (a negative factor mirrors, zero flattens); manifold renders them.
- **Circles with fewer than three segments throw.** `circle-tests.scad`,
  `cylinder-tests.scad` and `rotate_extrude-tests.scad` fail with `segments
  must be three or more`, where OpenSCAD clamps.
- **One-offs.** `maze3d_mickey.scad` overflows the stack and is an accepted
  failure (see `RENDER-TESTING.md`). `packing_circles.scad` and
  `heart_chain.scad` sit on the 290s model budget and are marked flaky;
  `heart_chain` spends 200s of its time in a 1,000-way 3D union.
  `radials.scad` crashes the renderer in its 3D unions.
- **It is roughly 10x slower than manifold.** `nuts.scad` takes 37s against
  3.6s, and the profile is entirely BSP: splitByPlane 11.6s, GC 11.3s, clipTo
  7.3s, with nothing in our own code. The one avoidable part is upstream now
  (`perf(modeling): group geometries by bounds before unioning them`), worth
  about 20% on a scene of separable parts. NopSCADlib `PCB.scad` now gets past
  its 2D booleans (1,319 calls, 1.4s in all) and spends 227s in 853 3D unions,
  two of them merging 154k and 175k polygons in 50s each with the Node heap
  peaking at 2.7 GB; it finishes in 234s against the 290s budget.

## Code review follow-ups

Status re-checked against current code 2026-09-27. Dropped as already fixed:
URL entry validation, decode iteration cap, OrbitControl pointer tracking,
ParamsTree cleanup handling, three.js disposal timing, regl render queue,
FileWatcher cleanup, babel error context, DXF/X3D menu gaps and the 3mf
README claim.

- **Parameter updates keep the latest (jscad-web).** Decided 2026-09-27:
  no queue; rapid changes coalesce to the latest and `noteParams` still
  records every change. (`apps/jscad-web/src/paramsUI.js`, `runParamChange`)
- **Save fallback feedback (jscad-web).** Done 2026-09-27: a missing file
  handle reports through `setError` instead of failing silently.
  (`apps/jscad-web/main.js`, `src/saveFile.js`)
- **Params validation (params-ui, params-controller).** Done 2026-09-27:
  paths and class names are validated, numeric strings coerce when the
  stored value is a number, free-typed values snap to the step grid,
  `setClass` documents non-reentrancy with a guard, `extractPartValues`
  validates its inputs.
- **Rate-limit CDN requests (require).** Done 2026-09-27 as a burst guard
  (200/s, fail fast); real throttling with queuing/backoff still needs
  async `fetch()` first; see the async module loading refactor below.
  (`packages/require/src/readFileWeb.js`)

## Refactoring

Async module loading is the breaking one; the rest are extractions.

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

## Remaining issues

- **Trim project files in chat context (agent-loop).** `buildMessages` sends
  every text file of the project outside the 24,000-character budget. Large
  projects need trimming, most recently mentioned files first.
  (`packages/agent-loop/src/context.js`)
- **Production relay chat logging (jscad-web server).** Only the launcher
  relay logs conversations. Logging in `server/src/relay` needs the user's
  opt-in before anything is written.
- **Eval cannot load ESM-only or CDN-only packages (agent-loop).**
  `@jscadui/jscad-text` (its `exports` has only an `import` condition) and
  `@jbroll/jscad-anchors` (not installed) fail in `eval/backend.js` while the
  frame serves them.
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

- **Missing files read as network errors in the frame.** The local server
  (`apps/jscad-web/scripts/local/server.js`) and `serve.js` send
  `Access-Control-Allow-Origin` only on a 200, so a 404 or 403 for a file the
  frame asked for is blocked by CORS and reaches the worker as `NetworkError`
  instead of `file not found`. Send the header on error responses too.

- **Accessibility.** Input-level ARIA exists; still missing are tree and
  toolbar roles, keyboard navigation for the param and file trees, modal
  focus trap and `aria-expanded` on collapsibles.
  (`packages/params-ui`, `apps/jscad-web`)
- **Params memory follow-up.** Child-proxy eviction recreates the child with
  fresh per-proxy defaults; only matters if 500 distinct properties are
  probed on one proxy between a set and a read of the same child.
