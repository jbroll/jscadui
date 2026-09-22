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
cells. **35 of 44 render** (`sci push jscadui/render-grids`, job
`53ddb53720d2395b`, 600s per grid); `apps/jscad-web/e2e/render-grids-baseline.json`
holds the per-grid state. The vertex-cap removal is what changed
`dotscad/examples/spiral/ALL.js` from failing to rendering; nothing else moved.
Every one of the remaining failures dies outside the per-cell catch:

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

The app defaults to manifold; the other engine renders **743/785** (CI job
`cbc23bc6fdd1a0ed`, `sci push jscadui/render-jscad`), with
`apps/jscad-web/e2e/render-jscad-baseline.json` holding the per-model state.
The STL comparison suite only runs manifold, so that sweep is the only thing
covering this engine. Run one model with `display-check.js --engine jscad`.

- **23 models extrude a geom2 whose sides do not close.** Was 24. One of them,
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

  The other 23 are a different bug, and it is in the BSP rather than anywhere
  downstream of it. `unionGeom2` and friends extrude both operands into
  `to3DWalls` prisms, run the 3D boolean and read the sides back; for these
  models the wall set the 3D boolean returns does not form closed loops before
  any snapping happens. On `wire.scad` a `subtract` takes 119 input walls,
  returns 89, rejects none of them in `fromFakePolygons`, and the raw
  coordinates already leave 11 vertices unmatched, some by two sides.

  Ruled out, each by measurement:

  - **Not snapping.** The raw BSP output is open at full float precision.
  - **Not the missing caps.** `to3DWalls` builds side walls only, so the BSP
    classifies inside/outside on a solid that is not closed. Capping the
    prisms with earcut triangles changes nothing: same 89 walls, same 11
    unmatched.
  - **Not `EPS` alone.** `splitPolygonByPlane` uses an absolute `EPS` of 1e-5
    (`src/maths/constants.js`) while `horiholes.scad` has walls 7.5e-6 apart,
    below it. Dropping `EPS` to 1e-9 takes that model from 76 unmatched to 40
    and leaves `wire.scad` untouched, so it contributes without being the
    cause.

  Repairing this downstream is not available. Surveying all 23 with
  `geom2-trace.js --preview`, the distance from an unmatched vertex to the
  partner a repair would join it to runs from 1.6 epsilon
  (`horiholes.scad`) through 10.5 (`fidget_boo.scad`) to 37 and beyond for the
  other 20, topping out at 35,665 (`walk_torus83_fort.scad`);
  `blowers.scad` has no opposite-sign partner at all. Whole sides are gone, so
  closing them means inventing geometry. Fixing it means the BSP's coplanar
  and boundary handling, or doing 2D booleans in 2D instead of through a 3D
  BSP. Both engines are affected: the manifold runtime routes geom2-sourced
  booleans through the same code (`packages/manifold/src/booleans/index.js`).
- **A tail of small clusters**: 5 unions across mixed 2D/3D types, 4 planes
  that an origin and normal do not define, 2 minkowski, 2 subtract across
  mixed types, 2 stack overflows, 3 models past the 270s budget.
- **It is roughly 10x slower than manifold.** `nuts.scad` takes 37s against
  3.6s, and the profile is entirely BSP: splitByPlane 11.6s, GC 11.3s, clipTo
  7.3s, with nothing in our own code. The one avoidable part is upstream now
  (`perf(modeling): group geometries by bounds before unioning them`), worth
  about 20% on a scene of separable parts.
