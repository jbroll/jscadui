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


## Render sweep

Baseline 784/785 on manifold (CI job `815f87b0abe7ee68`), up from 596/788. The
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
about 36 per BOSL2 part. Grids nest, so a nested grid is one cell of its
parent.

A cell whose model throws no longer takes the grid with it: it draws a
skull-and-crossbones and the sweep scores that grid `partial`, naming the dead
cells. **34 of 44 render** (`sci push jscadui/render-grids`, job
`c47078d389ff9071`, 600s per grid); `apps/jscad-web/e2e/render-grids-baseline.json`
holds the per-grid state. That baseline predates the vertex-cap removal
(`dotscad/examples/spiral/ALL.js` now renders) and has not been re-run. Every
one of the remaining failures dies outside the per-cell catch:

- **manifold wasm stops working mid-grid** — 4 of them. `PSUs.scad` raises
  `function signature mismatch` inside `manifold.wasm`, and every cell after it
  raises the same thing, so all three NopSCADlib grids and the top-level
  `openscad/ALL.js` end up dead whatever the per-cell catch does. Recovering
  means reinitialising the wasm module, which the worker has no path for today.
  `openscad/ALL.js` also loses `fractal_tree.scad` to `table index is out of
  bounds` in manifold's `getMesh` — the error the BOSL2 grids give on
  `orientations.scad`, and likely the same bug. `run-jscad` reproduces both,
  while the browser bundle has more headroom than manifold-3d 3.3.2 in
  `node_modules`.
- **The aggregate-of-aggregate grids exceed 600s** — top-level `ALL.js`,
  `openscad/bosl2/ALL.js`, `dotscad/ALL.js` and `dotscad/examples/ALL.js`. Each
  loads several whole grids in one worker on one core.
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
