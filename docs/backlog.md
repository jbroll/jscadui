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
