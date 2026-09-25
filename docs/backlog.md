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
See `apps/jscad-web/docs/architecture.md` for the
deploy order and headers.

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

- **Model code can keep its own run alive.** It can post its own `jscadCells`
  during a load or parameter run, and each relayed message restarts the frame's
  kill timer, so a model that keeps posting is never killed. Claims restart the
  kill timers too, so model code can post `jscadClaim` with a guessable
  `runId` to the same end. The damage stays in the user's own session.
- **Serialize the export, measure and check re-runs.** After a streamed grid
  they re-run main in the frame's worker without waiting for other runs, so two
  can interleave and share `__jscadProgress`, `releaseSolids` and
  `currentParams()`.
- **Re-run a grid for export without converting it.** The re-run goes through
  `jscadMain`, which converts every cell to meshes it then discards. Calling
  main without that conversion would cut the time and the peak memory.
- **`part()` boundaries for JSCAD and SCAD parts.** A single model's parts
  could spread across the frame's pool the way a grid's leaves do now, using
  the same claim mechanism: `jscadClaim`, a key per part, fan-out on the first
  claim.
- **Merge a pooled run's params in grid order.** `mergeProxyStates` follows
  the order members answered, not grid order, so the params UI can reorder
  between pooled runs. A timed-out member's params are missing from the merge.
- **Revoke the frame's worker blob URLs.** `frame.js` makes a blob URL per
  worker and never revokes it, and the pool starts more workers than before.

## Worker

- **The whole result transfers a `ManifoldGeom3`'s own arrays.** Its
  `vertices`, `indices` and `normals` getters return the solid's cached mesh
  arrays, and `jscadMain`'s whole-result path transfers them. The solid stays in
  `workerState.solids`, so a later export, measure or check that reconverts the
  kept solids can read detached arrays. Streamed batches already send copies
  (`packages/worker/src/stream.js`).

## Worker pool and supersede

See `apps/jscad-web/docs/architecture.md`, Protocol and Streamed runs, for how
the frame keeps a pool of workers, spreads a grid's leaves across it by
claims, and abandons stale runs.

- **A promoted worker's export reload has no progress beats.** Before an
  export, measure or check, the frame replays a grid's last `jscadMain` with
  `stream: false`, or reloads the script with `runMain: true`, as one frame
  request. Neither relays cells or progress, so the kill timer covers the whole
  grid, and a large grid export after a promotion can time out.
- **A superseding load or parameter change aborts a pending export.** The
  retire answers the export `AbortError`.
- **Move `ABANDON_AFTER_MS` to a leaf constants module.** It lives in
  `src_frame/gridRun.js`, re-exported from `frameHost.js`, and the app imports
  it from there.
- **The app sends a superseding `jscadMain` every 500 ms while a load is
  pending.** The frame never abandons a pending script, so each one queues on
  the worker and runs in full. Queue them behind the load instead and supersede
  the queued ones, as the frame already does behind a reload.
- **The frame's `jscadInit` mirror entries grow with every kill's replay.**
  Only a new file map trims the mirror list, and it keeps every init.
- **`retire()` can leave no active worker.** If `createWorker` throws, the
  active slot is empty, and the next cold start sends no bundles.
- **A reload step that fails with `RuntimeError` leaves the trapped worker
  active.** The queued request gets the error and the requests behind it run on
  that worker, until an app answer traps and retires it.
- **An export after a failed run uses the last successful params.** The frame
  records `lastMain` only when a `jscadMain` succeeds, so after one fails with
  `RuntimeError` a promoted worker replays the previous params, not the ones the
  user last set.
- **The frame's replay steps carry the app's `held`.** The worker hashes every
  mesh for an answer the frame drops. Strip `held` and `runId` from the replay.

## Mesh reuse

- **Agent evaluate or an animation frame can `remember` while a run with older
  `held` is in flight.** Its refs then name hashes the map no longer holds and
  fail. Those runs send no `held`, so their meshes carry no hash and `remember`
  empties the map: every ref in the in-flight run fails. Fix by falling back to
  the previous map in `resolve`.
- **The same held entity twice in one scene rebuilds an extra three.js object
  on each streamed redraw.**
- **A part whose conversion throws mid-stream clears the solids** after earlier
  parts were already posted.

## Tests to add

- Instance-path shading in `format-threejs`.
- A late message from a retired worker is dropped.
- An app script that rejects on a promoted worker, then a model request that
  reloads `lastScript`.
- `paramChangeCallback`'s work token.
- `paramChangeCallback` and `runModelUpdate` stranding each other's pending
  update.

## Library bugs found by the sweep

- **dotSCAD's `r_union3` fails on the manifold engine** with
  `null is not a valid Manifold` inside an intersection, when given a scaled
  sphere and a hull (the pair `voronoi_melon.scad` uses). A `dilate` minkowski
  is the likely source of the null. Not covered by any example that is not
  already skipped.

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
