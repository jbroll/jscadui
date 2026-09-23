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
review follow-ups. See `apps/jscad-web/docs/architecture.md` for the
deploy order and headers.

## Follow-ups from the 2026-09-19..22 review

- **An unsaved edit two includes down can leak into a cached includer** when
  no project is loaded. The source check in `scadHandler.js` compares each
  file only against its own source.

## Render sweep

Baseline 761/807 on manifold (CI job `b758af600414f82f`). The 22 models
skipped only for the STL comparison now render, and 45 models score `empty`:
echo- or assert-only doc examples and files that only define modules.
`maze3d_mickey.scad` is the one error. The model budget is 290s, under the
300s RPC timeout, and is a hang guard, not a performance budget. The sweep
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

A grid loads every model in one worker as one job, under one model budget
(120s, `main.js`; 290s in the sweep), and holds all their geometry at once so it can place them.
44 grids; the largest are NopSCADlib's 145 tests, dotSCAD's 62 examples and
about 36 per BOSL2 part. Grids nest, so a nested grid is one cell of its
parent.

A cell whose model throws no longer takes the grid with it: it draws a
skull-and-crossbones and the sweep scores that grid `partial`, naming the dead
cells. **35 of 44 render** (`sci push jscadui/render-grids`, job
`50a257d37f27c7f3`, 320s hang guard per grid);
`apps/jscad-web/e2e/render-grids-baseline.json` holds the per-grid state and
each partial grid's dead cells. After the first `WebAssembly.RuntimeError` a
grid fails every later cell as `not run: wasm trapped in <url>`.

- **Six grids crash the renderer**, the three NopSCADlib ones, top-level
  `ALL.js`, `dotscad/ALL.js` and `dotscad/examples/ALL.js`, before the frame's
  290s kill can fire. The sweep runs four grids at once on the CI host, so
  memory is the likely cause; not yet measured. The NopSCADlib grids used to
  die at `PSUs.scad`'s `function signature mismatch` inside `manifold.wasm`
  and no longer trap there. Recovering from a trap means reinitialising the
  wasm module, which the worker has no path for today.
- **`openscad/ALL.js` traps at `fractal_tree.scad`** with `table index is out
  of bounds` in manifold's `getMesh`, the error the BOSL2 grids give on
  `orientations.scad` and likely the same bug. `run-jscad` reproduces it,
  while the browser bundle has more headroom than manifold-3d 3.3.2 in
  `node_modules`.
- **The aggregate-of-aggregate grids are too big for one worker.**
  `openscad/bosl2/ALL.js` hits the 290s kill; the top-level and dotSCAD
  aggregates crash first (above). Each loads several whole grids in one worker
  on one core.
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

The app defaults to manifold; the other engine renders **719/807** (CI job
`66c6287cbb317a60`, `sci push jscadui/render-jscad`); 59 of the rest are
`empty`, with
`apps/jscad-web/e2e/render-jscad-baseline.json` holding the per-model state.
The STL comparison suite only runs manifold, so that sweep is the only thing
covering this engine. Run one model with `display-check.js --engine jscad`.

- **25 models extrude a geom2 whose sides do not close.** `random_city.scad`
  and `random_city_taiwan.scad` joined once comparison-only skips stopped
  applying to the browser sweep. One of them,
  `hypnotic_squares.scad`, was an epsilon-grid split: `fromFakePolygons`
  rounded each point onto the grid on its own, so the two copies a 3D boolean
  returns for a shared corner could land in different cells and the outline
  never closed. Fixed on the modeling fork (`jbroll/OpenJSCAD.org`, branch
  `fix/geom2-snap-weld`, `bf7d77f2`) by repairing only the vertices left with
  an unequal number of sides arriving and leaving, which also closes upstream
  #907's BSP gap. Do not weld during snapping instead: each boolean's output
  is the next one's input, so moving points that already balance perturbs
  geometry that was fine and a later BSP returns something broken in its own
  right. `gears.scad` is the model that catches it.

  `blowers.scad` left the group for an unrelated reason: a twisted extrusion
  subdivided its profile and computed the shared corner one ulp off, so the
  loop never chained. See the subdivision fix in `openscad-runtime`.

  `text_box.scad` joined the group once 2D minkowski stopped throwing ahead
  of it: it now reaches a later `subtract` whose unmatched vertices sit 1,700
  to 4,000 epsilon apart.

  The rest are a different bug, and it is upstream of anything
  `fromFakePolygons` does. `unionGeom2` and friends extrude both operands into
  `to3DWalls` prisms, run the 3D boolean and read the sides back; for these
  models the wall set the 3D boolean returns does not form closed loops before
  any snapping happens. On `wire.scad` a `subtract` takes 119 input walls,
  returns 89, rejects none of them in `fromFakePolygons`, and the raw
  coordinates already leave 11 vertices unmatched, some by two sides.

  The 3D BSP itself is sound. Across 360 booleans on clean primitives
  (cuboid, sphere, cylinder at assorted sizes and segment counts) 359 came
  back closed, the one exception off by 1.69e-7. What breaks it is what the 2D
  path hands it. `to3DWalls` builds side walls only, so the operands are open
  prisms, and their vertical faces can be closer together than the BSP can
  resolve: `splitPolygonByPlane` works to an absolute `EPS` of 1e-5
  (`src/maths/constants.js`) regardless of the geometry's scale.

  In the smallest `horiholes.scad` case — two of the 24 operands — exactly one
  pair of parallel wall planes falls below that, 7.531e-6 apart, and the two
  walls that vanish from the union are precisely that pair. The shapes do
  overlap across that band, so the correct union needs connector faces 7.5e-6
  tall to stitch the boundary, which the BSP cannot represent. Dropping `EPS`
  to 1e-9 takes that case from 6 unmatched vertices to 4 and the full 24-way
  union from 76 to 40, so the tolerance is a contributor and not the whole
  story.

  Also ruled out by measurement: it is not snapping, since the raw BSP output
  is open at full float precision; and it is not the missing caps, since
  capping the prisms with earcut triangles leaves the same 89 walls and the
  same 11 unmatched vertices.

  Repairing downstream is not available either. Surveying all 23 with
  `geom2-trace.js --preview`, the distance from an unmatched vertex to the
  partner a repair would join it to runs from 1.6 epsilon (`horiholes.scad`)
  through 10.5 (`fidget_boo.scad`) to 37 and beyond for the other 20, topping
  out at 35,665 (`walk_torus83_fort.scad`); `blowers.scad` has no
  opposite-sign partner at all. Whole sides are gone, so closing them means
  inventing geometry.

  What is left is to stop routing 2D booleans through a 3D BSP. A sweep-line
  clipper with exact predicates decides these cases correctly instead of
  against a fixed tolerance. Both engines would get it: the manifold runtime
  routes geom2-sourced booleans through the same code
  (`packages/manifold/src/booleans/index.js`).
- **The last four are one-offs.** `maze3d_mickey.scad` overflows the stack and
  is an accepted failure (see `RENDER-TESTING.md`). `Spawing_Cube.scad` errors
  here and renders on manifold. `offset.scad` exceeds the 290s model budget.
  `packing_circles.scad` sits on the budget and is marked flaky in the
  baseline.
- **It is roughly 10x slower than manifold.** `nuts.scad` takes 37s against
  3.6s, and the profile is entirely BSP: splitByPlane 11.6s, GC 11.3s, clipTo
  7.3s, with nothing in our own code. The one avoidable part is upstream now
  (`perf(modeling): group geometries by bounds before unioning them`), worth
  about 20% on a scene of separable parts.
