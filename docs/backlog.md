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
`/api`. Both hosts are live. See `apps/jscad-web/docs/architecture.md` for the
deploy order and headers.



## Compute frame

Left over from `feat/frame-single-engine`. None of these break the boundary the
branch built; they are the gaps it did not close.

- **The frame accepts a message from any window on the app origin.** It checks
  `event.origin` but not `event.source !== parent`, so another same-origin
  window can drive it. It gets no answers back, since replies go to `parent`.
- **`packages/postmessage` has no unit test for per-endpoint `reqMap`
  isolation.** That isolation is the whole reason the change exists.
- **Two malformed requests burn the frame timeout instead of answering.**
  `jscadInit` with `params: [null]`, and an unknown relayed method. Both should
  reject at once.
- **`engine` latches across `jscadInit` calls that omit it,** and nothing says
  so. The alias path (`onAliasFound`) relies on it. Document or make it
  explicit.
- **`frameApi`'s `entities` and `onProgress` handlers are dead code.** Either
  wire them or drop them.
- **`framePort` could treat a second iframe `load` event as fatal.** A second
  load means the frame navigated, which the app should not survive silently.
- **An un-awaited `addToCache` races the file map for `.jscad` shims.**
- **`require('./part.stl')` from a project is untested,** and now arrives as an
  ArrayBuffer rather than the binary string callers used to get.
- **No test for a nested `fromFile` inside a project subdirectory.**
- **A filename containing `../` can walk the library-root candidate outside its
  library.** Pre-existing, not introduced by the frame work.
- **`deploy-full.sh`'s frame check greps curl's status output** instead of using
  its exit code, after a fixed `sleep 3` and with no retry.
- **`src_frame/frame.js`'s `armTimeout` keeps a single `pendingId`.** A second
  request clears the first's timer, so an earlier request can never time out.
- **`src_frame/frame.js`'s `attach()` sets no `onerror`/`onmessageerror`.** A
  blob worker that fails to load its bundles surfaces as "model exceeded N ms"
  instead of the load error.
- **Every compile sends the whole service-worker cache to the frame.**
  `main.js` and `src/projectFiles.js` send all of it, and `switchProject` does
  not clear it first, so the frame receives the union of every project opened
  this session.
- **`packages/require`'s `.scad` library-root fallback cannot work in the
  frame.** It resolves against `self.location.origin`, which is the string
  `'null'` in the frame's blob worker. It is a third copy of the logic
  `src_frame/scadResolve.js` centralised; delete it or route it through that.
- **The app build still produces the whole model engine into `build/`** —
  `bundle.jscad_modeling.js`, `bundle.manifold_modeling.js`, `manifold.wasm`,
  `bundle.openscad.js` and the rest — although only the frame executes models.
  `test/fluent-worker.test.js` loads the app-side copy, so removing them means
  repointing that test.

## Render sweep

Baseline 784/786 on manifold (CI job `da5e9a52bfbf0b66`), up from 596/788. The
per-file cap is 300s and is a hang guard, not a performance budget. See
`apps/jscad-web/e2e/RENDER-TESTING.md` and `render-baseline.json`.

- **Four examples are skipped as broken at their source** — see the
  library `skip.txt` files. Three include files upstream does not ship:
  refresh the vendored dotSCAD and snippet copies if it ever ships
  `util/rands_disk.scad`, `maze/mz_wang_tiles.scad` and the 11 missing
  `Asset_SCAD/` parts. The fourth, `voronoi_melon.scad`, OpenSCAD cannot
  render either: dotSCAD's `_delaunayBoundaries` recurses without end on its
  point set.

## Combined ALL.js grids

A grid loads every model in one worker as one job, under one model budget
(120s, `main.js`), and holds all their geometry at once so it can place them.
44 grids; the largest are NopSCADlib's 145 tests, dotSCAD's 62 examples and
about 36 per BOSL2 part. Measured against production 2026-09-22, after the
missing-symbol scan went linear: each BOSL2 part grid renders inside the
budget, and only the top-level `bosl2/ALL.js`, which loads all five, does not.

- **A big grid dies in manifold, not on time.** `bosl2/ALL.js` aborts on
  `orientations.scad` with `table index is out of bounds` inside manifold's
  `getMesh`; the browser and `run-jscad` give the same message. It is not the
  model count: of `05-part5`'s 34 models the first 17 render and the second 17
  do not, and `orientations.scad` renders alone (250,290 vertices). That grid
  does render in the browser but not in Node, so the browser bundle and
  manifold-3d 3.3.2 in `node_modules` do not have the same headroom. Find
  whether the limit is total live geometry before choosing a fix.
- **One model that throws kills the whole grid.** The generated `ALL.js`
  rethrows from its per-item `catch` (`bin/generate-all-files.js`). A skipped
  cell with a marker would leave the rest of the grid standing.
- **Nothing splits a grid across workers.** The frame runs one worker, one
  request at a time (`src_frame/frame.js`), so a grid cannot use more than one
  core and cannot give each cell its own budget. A pool would need the app to
  send each cell separately and place results as they arrive; each worker then
  transpiles the shared library again unless the transpile cache moves out of
  the worker to the frame's main thread (the frame's opaque origin rules out
  SharedArrayBuffer and IndexedDB). Weigh that against a warm transpile now
  costing about 40ms.

## Library bugs found by the sweep

- **dotSCAD's `r_union3` fails on the manifold engine** with
  `null is not a valid Manifold` inside an intersection, when given a scaled
  sphere and a hull (the pair `voronoi_melon.scad` uses). A `dilate` minkowski
  is the likely source of the null. Not covered by any example that is not
  already skipped.

## The jscad engine

The app defaults to manifold; the other engine renders **738/789** (CI job
`d4f77513990d2eed`, `--engine jscad`). The STL comparison suite only runs
manifold, so nothing covers it. Sweep with `--engine jscad`, or run one model
with `display-check.js --engine jscad`.

- **24 models extrude a geom2 whose sides do not close**, so earcut throws
  inside `extrudeFromSlices`. Not a tolerance problem: in
  `hypnotic_squares.scad` the closest distinct endpoints of the 187-side
  profile are 0.4997 apart, so the profile is genuinely open. Find the
  operation that builds it before reaching for a weld.
- **A tail of small clusters**: 5 unions across mixed 2D/3D types, 4 planes
  that an origin and normal do not define, 2 minkowski, 2 subtract across
  mixed types, 2 stack overflows, 3 models past the 270s budget.
- **It is roughly 10x slower than manifold.** `nuts.scad` takes 37s against
  3.6s, and the profile is entirely BSP: splitByPlane 11.6s, GC 11.3s, clipTo
  7.3s, with nothing in our own code. The one avoidable part is upstream now
  (`perf(modeling): group geometries by bounds before unioning them`), worth
  about 20% on a scene of separable parts.
