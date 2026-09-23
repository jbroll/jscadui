# Browser render testing

The example libraries are exercised two ways:

| Path | What it runs | Catches |
|------|--------------|---------|
| `packages/openscad` STL comparison | transpiler in **Node**, compares STL vs OpenSCAD | transpiler/geometry correctness |
| `e2e/render-all.mjs` (this dir) | the **real browser** pipeline: compute frame → worker transpile → manifold → three.js/WebGL | browser-only failures: worker bundling, dynamic imports, fetch/URL resolution, `j$` wiring, WebGL |

The Node path passes the OpenSCAD runtime (`j$`) into each transpiled module as a
`new Function(..., 'j$', code)` parameter. The **browser** path runs modules via
`@jscadui/require`'s `runModule` (`eval(source)` in global scope), so `j$` must be
a worker global — initialised in `src_frame/bundle.frame-worker.js` `getOpenscad()`
(`j$.init(jscad)` + `self.j$ = …`). A regression there fails *every* `.scad` file
with `ReferenceError: j$ is not defined`, while the Node suite stays green — which
is exactly why this browser harness exists.

## render-all.mjs

Loads each example by hash-navigating the dev server
(`/#/examples/openscad/.../foo.scad`), waits for the app to move
`html[data-render]` from `running` to `ok` or `error`, and reports
`ok` / `error` / `timeout` per file. Honors each library's `skip.txt`. Writes
`e2e/render-report.json`.

`--timeout` (default 300s) is a hang guard, not a performance budget: a model
that renders slowly still renders, and the jscad engine needs 37s for a
NopSCADlib test that manifold does in 3.6s. The harness sets the app's own
model budget 30s below its own cap, so a model that really does run away is
killed by the frame and reported as `model exceeded N ms` rather than as an
anonymous timeout. `--model-timeout` sets that budget directly. Either way the
budget stops at 290s: the app's RPC to the frame gives up at 300s
(`@jscadui/postmessage`), and past that the page reports "RPC timeout" while
the worker keeps running. The harness warns and clamps a larger value.

### Grids and the `partial` status

With `--grids` the sweep loads each `ALL.js` instead of the individual models.
A cell whose model throws does not abort the grid: the generated `ALL.js`
catches it, draws a red skull-and-crossbones in that cell, and logs
`ALL: FAILED <url>: <message>` plus an `ALL: N/M models failed:` summary. The
sweep reads those lines off the page console into `cellFailures` and scores the
grid `partial`, which counts as a failure and prints each dead cell under `☠`.
A cell that raises a `WebAssembly.RuntimeError` leaves the wasm instance
broken, so every cell after it in that worker, nested grids included, fails as
`not run: wasm trapped in <url>` rather than being scored on a broken instance.

It must not wait on `#progress`: `static/main.css` sets that element
`display: none`, so a "wait until hidden" resolves immediately and every file
scores `ok` without rendering.

```bash
cd apps/jscad-web
npm run dev                                   # in another shell (or rely on it running)
node e2e/render-all.mjs --dir openscad/01-basics      # one library, quick
node e2e/render-all.mjs --dir openscad --concurrency 6 # everything
node e2e/render-all.mjs --help
```

### WebGL note (important)

WebGL only works on Playwright's **bundled** chromium (ships swiftshader). The
system chromium on the dev box cannot create a headless WebGL context, so the app
aborts at init. `render-all.mjs` and `playwright.config.js` use the bundled browser
with `--use-gl=angle`. Do **not** point `executablePath` at the system chromium.

## Running the full sweep on CI (recommended)

The full sweep is memory/CPU heavy — run it on the GPU CI host via simple-ci
instead of locally:

```bash
cd <repo-root>
JOB=$(../simple-ci/sci push jscadui/render)   # runs ci/render on gpu
../simple-ci/sci wait "$JOB"
```

`ci/render` builds the workspace, starts the dev server, and runs `render-all.mjs`.
Edit `RENDER_ARGS` in `ci/render` to change scope/concurrency.

`sci push jscadui/render-grids` runs the same setup over the 44 `ALL.js` grids
instead (`--dir . --grids`, 320s hang guard, concurrency 4, writing
`e2e/render-grids-report.json`). A grid holds every cell's geometry at once, so
it is much heavier than one model. `sci` takes the script name as the job name,
which is why this is a separate file rather than a flag on `ci/render`.

## The modeling code a sweep actually measures

`@jscad/modeling` and `@jscad/modeling-for-manifold` are `file:` deps on a
**sibling** checkout, resolved through a relative symlink, so they point at a
different repository on each machine: `~/src/OpenJSCAD.org` here,
`/data/john/ci-worktrees/OpenJSCAD.org` (owned by `s-ci`) on the CI host. `sci`
rsyncs only this repo, so a change to the modeling fork does not reach CI.
Push the fork and update CI's checkout, or the sweep measures something else:

```bash
cd ~/src/OpenJSCAD.org && git push origin fork-main
ssh gpu 'cd /data/john/ci-worktrees/OpenJSCAD.org && sudo -n -u s-ci \
  git -c safe.directory=$PWD checkout -f -B fork-main origin/fork-main'
```

Both engines depend on it — the manifold runtime resolves
`@jscad/modeling-for-manifold` to the same checkout — so this is not only a
jscad-engine concern.

## Baseline

`e2e/render-baseline.json` records the known sweep state: the CI job it was
captured from, per-library ok/fail counts, and the failing example paths. Diff
future runs against `failures`, not against zero.

It records no commit. `sci` rsyncs the working tree onto a base worktree, so the
commit the CI run reports is that worktree's HEAD, not the code measured — a
field nobody can trust is worse than none.

`e2e/render-grids-baseline.json` is the same thing for the grid sweep: **34 of
44** on manifold, CI job `c47078d389ff9071`. Each failure carries its `status`,
the cells that drew a marker, and why the grid itself died. `docs/backlog.md`
groups them by cause. The file predates the vertex-cap removal, which fixes
`dotscad/examples/spiral/ALL.js`; re-run the sweep to record it.

The current baseline is **784 ok of 785** on manifold, CI job
`815f87b0abe7ee68`. It replaced a 596/788 baseline recorded before the
example-failure work. The largest single move was the engine default: the app
used to default to `jscad`, which rendered 623 where manifold rendered 762 on
the same tree. The rest came from transpiler and runtime fixes, two
example-generator fixes, a 300s hang guard in place of a 30s one, a vertex cap
raised above the largest real example, and compiling a `let()` function body
to statements so recursion costs half the stack.

Four examples are skipped because they are broken at their source: dotSCAD's
`forest.scad` and `maze_city_taiwan.scad` include files upstream dotSCAD does
not ship at the pinned commit, snippet's `Import_Library.scad` needs 11 assets
the upstream collection lacks, and `voronoi_melon.scad` fails in OpenSCAD too
(`Recursion detected calling function '_delaunayBoundaries'`). The one that
still fails, `maze3d_mickey.scad`, recurses about 3,000 levels deep and
exceeds a browser worker's stack. It is an accepted failure: even at one frame
a level it needs about 850 KB against a worker's ~530 KB, so no transpiler
change fits it. `docs/design/mutual-tail-calls-trial.md` has the measurements.

Sweeping the other engine takes `--engine jscad`, which `sci push
jscadui/render-jscad` does at CI scale: **758 of 785**, CI job
`8738629ba8767389`, recorded in `e2e/render-jscad-baseline.json`. 23 of its 27
failures extrude a geom2 whose sides do not close, which is where that
engine's remaining work is. See `docs/backlog.md`. That sweep measures
whatever `@jscad/modeling` the CI host's sibling `OpenJSCAD.org` checkout is
on, which is not tied to the jscadui commit — the baseline records which
modeling commit it measured.

From `apps/jscad-web`, after a sweep writes a fresh `e2e/render-report.json`:

```bash
node -e "
const base = require('./e2e/render-baseline.json');
const fresh = require('./e2e/render-report.json');
const known = new Set(base.failures.map((f) => f.rel));
const byRel = new Map(fresh.results.map((r) => [r.rel, r.status]));
console.log('new failures:', [...byRel].filter(([rel, s]) => s !== 'ok' && !known.has(rel)).map(([rel]) => rel));
console.log('fixed:', [...known].filter((rel) => byRel.get(rel) === 'ok'));
"
```
