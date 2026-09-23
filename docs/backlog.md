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

## Review of 2026-09-19 to 2026-09-22

Found by reviewing those commits. Items say "unverified" where the defect was
read from the code but not reproduced.

### Security

- **The relay forwards the user's session cookie to LLM providers.**
  `pickHeaders` in `apps/jscad-web/server/src/relay/routes.ts` drops only
  hop-by-hop headers, so `cookie`, `origin`, `referer` and `x-forwarded-for`
  go upstream. The app and relay share an origin, so every chat turn sends the
  better-auth session cookie to opencode.ai, OpenAI or Anthropic. Forward an
  allowlist (auth, content-type, `anthropic-version`, `x-opencode-session`).
- **Any signed-in user can claim another account's GitHub installation.**
  `POST /api/git/installations` in `server/src/git/routes.ts` only checks that
  `mintInstallationToken(installationId)` succeeds, which it does for every
  installation of the App. Installation ids are small integers; once saved, the
  caller reads and commits through `/files`, `/write` and `/versions`. Tie the
  installation to the caller's GitHub identity, and check the requested
  owner/repo against the saved record.
- **Model code can cancel its own watchdog.** `src_frame/frameHost.js` settles
  a request's timer on any `__RESPONSE__` the worker posts, and request ids are
  sequential. A model posts a fake empty result for the next id, then loops:
  the app shows nothing and a core spins until the next request. A forged
  `frameWorkerTerminated` in a loop drives `initFrame` repeatedly. Only accept
  responses the frame itself generated, or key them with an unguessable id.

### OpenSCAD runtime and transpiler

- **2D minkowski hulls a multi-part operand into one blob** (`_minkowski2D`,
  `openscad-runtime/src/primitives.js`). It checks convexity of one ring and
  hulls all of `b`. `minkowski(){ square(10,center=true); union(){ circle(1);
  translate([20,0]) circle(1); } }` gives one 32x12 slab (area 383) instead of
  two rounded squares (about 286). Holes and extra islands in either operand
  are also lost.
- **Statement calls with named arguments** (b1318ae2,
  `transpiler/statements.ts`). `function f() = 1; f($fn=8);` throws
  `f_$f$obj is not defined`, since no `$obj` entry point is emitted for a
  zero-parameter function and `declareMissingSymbols` does not stub it.
  Separately, `g(a=1, $fn=8);` as a statement never scopes `$fn`: `g_$f$obj`
  drops it, while the expression form wraps the call in `j$.withScope`.
- **`rotate_extrude` of a collapsed profile** only returns nothing when the
  point is at the origin (`extrusions.js`). A profile collapsed to (5,5) still
  throws "slices with one or more edges"; one collapsed to a line off the axis
  returns 76 zero-volume polygons where OpenSCAD returns nothing.
- **`mirror([1])` still throws**; only two-component normals are padded
  (`transforms.js`).
- **The async branch of `_safeUnion` skips `withoutDegeneratePolygons`**, so a
  union containing `text()` can still throw in `plane.fromPoints`. Unverified.
- **`_sameDimensionAsFirst` converts every manifold 2D operand.** `is2D` reads
  `sides`/`outlines`, which on `ManifoldGeom2` are getters running
  `crossSectionToGeom2`, at every level of a 2D CSG tree. Correct but slow;
  key on an own property as the minkowski path does. Unverified cost.

### Compute frame

- **A frame reload leaves in-flight requests pending.** The second-load branch
  in `src/frameSetup.js` re-inits but never rejects the proxy's `reqMap`, so a
  `jscadScript` waits out the 5-minute RPC timeout with the progress bar up and
  `paramsUI.setWorking` held.
- **A restarted worker has no state.** After a timeout kill, `onTerminated`
  only sends `jscadInit`: no `jscadSetFiles`, script or aliases. A parameter
  change or Export then runs against an empty worker, likely exporting an empty
  file with no error. Unverified end to end.
- **`failureCache` in `bundle.frame-worker.js` is never cleared.** A failed
  include stays failed for 60s after the file is added or the project changes.
- **Overlapping runs are not ordered.** `jscadSetFiles` sets one global map in
  its own message after several awaits, and nothing tags a result with its run,
  so a project switch mid-run can pair B's entry with A's files, and the last
  answer drawn wins. Unverified.
- **`scadResolve.js` resolves nested includes against the entry's origin.**
  `fromFile` arrives as a bare pathname, so an include on another origin looks
  up its own includes on the project origin; `transpiledCache` keys drop the
  origin too.
- **A `createWorker()` throw is never answered** (`frameHost.js`), so the
  caller waits the 5-minute default.
- **`render-all.mjs --timeout` above 330s** outlives the RPC timeout: the app
  reports "RPC timeout" while the worker keeps running.

### Agent and providers

- **Qwen and MiniMax on opencode-go send `role: 'system'` inside `messages`**
  (1450a9b9). `toAnthropicMessage` in `agent-loop/src/providers.js` and
  `server/src/providers/anthropic.ts` passes the role through, and `aiChat.js`
  always prepends a system message. Move it to the top-level `system` field.
  The request shape is confirmed; the 400 is not.
- **The Responses adapter ignores `response.failed`, `response.incomplete` and
  `error`** (`agent-loop/src/responses.js`, `server/src/providers/responses.ts`)
  and still yields `done` with `completed`, so a mid-stream failure shows an
  empty turn.
- **`x-opencode-session` changes every message**: `aiChat.js` calls
  `createProvider` per submit, and the id defaults to a fresh UUID there.

### Manifold

- **`retessellate` shares the input's WASM handle**
  (`packages/manifold/src/modifiers/index.js`); disposing either wrapper breaks
  the other, and the FinalizationRegistry holds the handle twice. Missed by the
  clone-ownership fix. The single-input `translate([0,0,0])` copies in `union`
  and `intersect` also leak a temporary manifold for a plain geom3 input.

### Tests and CI

- **`e2e/frame.spec.js` never runs in CI.** `ci/render` runs it only when
  `render-all.mjs` exits 0, which no baseline allows; `ci/web` does not list
  it. The hostile-bundle assertion has never executed.
- **Render sweeps cannot signal a regression by exit status.** Every job ends
  FAILED against a nonzero baseline; the only diff is the hand-run snippet in
  `RENDER-TESTING.md`, which ignores status changes such as error to timeout.
  Have the sweep compare against its baseline and exit on new failures.
- **The deploy smoke gate passes a grid of dead cells.** `smoke-deploy.mjs`
  checks only `data-render` and `#error-bar`, and since the per-cell catch a
  fully failing `01-basics/ALL.js` renders 20 skulls. Read the `ALL: FAILED`
  lines.
- **The grid baseline lost its cells.** 0f740d6c dropped `cells` and `why`
  from `render-grids-baseline.json`, so a new cell failure in an already
  partial grid diffs clean. `RENDER-TESTING.md` still says 34/44 and that each
  failure carries its cells.
- **Browser sweeps honour comparison-only skips.** `render-all.mjs` applies
  every `skip.txt` (35 entries), most of which only say the STL comparison
  cannot grade the model (unseeded `rands()`, bad reference STL, fonts).
  `random_city.scad` and `voronoi_vase.scad` are never rendered in the browser.
  Split render skips from comparison skips.
- **OpenSCAD reference failures vanish from the count**
  (`openscad/bin/test-harness.js`). Any failure, including a 60s timeout under
  load, is subtracted from `tested` and cached as a permanent `.failed`
  sentinel keyed on the library hash, not the OpenSCAD version. Unverified
  that CI's cache persists.
- **An empty result scores as a render.** `render-all.mjs` treats no error bar
  as `ok`, and `display-check.js` exits 0 on "no geometry returned".
- **Cells after a wasm trap are still scored.** The per-cell catch keeps using
  a manifold instance that raised a `WebAssembly.RuntimeError`, so later `ok`
  cells may not be trustworthy.

### Deploy and storage

- **An exported `REMOTE_HOST` makes `deploy-full.sh` a silent no-op** that
  still passes `wait_for_ok` and `smoke-deploy.mjs`, since neither compares a
  build id. `unset REMOTE_HOST` in the script, and check the served build hash.
- **`frame-ancestors` is hardcoded** to `https://jscad.rkroll.com` in
  `deploy/hooks/apache.configure.post.sh`, while `build.js` accepts
  `FRAME_APP_ORIGIN`.
- **Folder and git storage export `.jscad-studio.json` metadata**; `zip.js`
  expects `.jscad-web.json`, so their zips do not import elsewhere. Neither
  mode is wired into `main.js` yet.

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

The app defaults to manifold; the other engine renders **758/785** (CI job
`8738629ba8767389`, `sci push jscadui/render-jscad`), with
`apps/jscad-web/e2e/render-jscad-baseline.json` holding the per-model state.
The STL comparison suite only runs manifold, so that sweep is the only thing
covering this engine. Run one model with `display-check.js --engine jscad`.

- **23 models extrude a geom2 whose sides do not close.** One of them,
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
- **2D minkowski is implemented** (2026-09-22): the convex operand swept along
  every side of the other, hulled at each end and unioned, recentred on its
  centroid so the union with the operand itself is valid. Not the union of
  copies at the convex shape's vertices that the manifold engine uses — that
  leaves gaps wherever the first operand is thinner than the second's edges.
  A Manifold geometry exposes `sides` as a prototype getter, so the jscad path
  keys on an own property and that engine keeps its own implementation.
- **The last four are one-offs.** `maze3d_mickey.scad` overflows the stack and
  is an accepted failure (see `RENDER-TESTING.md`). `Spawing_Cube.scad` is
  empty in OpenSCAD too. `offset.scad` runs past 600s without erroring, and
  the sweep records a bare `Error:` for it. `packing_circles.scad` sits on the
  600s guard and has gone both ways across runs.

  Cleared 2026-09-22, all with unit tests: 2D minkowski; mixed 2D/3D children in union,
  subtract and intersect now take the group's dimension from its first child
  and ignore the rest, as OpenSCAD does; a 2D `mirror` normal is padded to
  three components; a twisted profile's subdivision reuses the original
  endpoints instead of interpolating them one ulp off; `rotate_extrude` of a
  collapsed profile returns nothing; and `offset` drops an outline it cannot
  make a region from (modeling fork, `c2676bd1`).
- **It is roughly 10x slower than manifold.** `nuts.scad` takes 37s against
  3.6s, and the profile is entirely BSP: splitByPlane 11.6s, GC 11.3s, clipTo
  7.3s, with nothing in our own code. The one avoidable part is upstream now
  (`perf(modeling): group geometries by bounds before unioning them`), worth
  about 20% on a scene of separable parts.
