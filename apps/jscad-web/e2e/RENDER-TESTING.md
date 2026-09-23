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
`ok` / `error` / `timeout` per file. A page that settles `ok` with no vertices
drawn (`html[data-vertices="0"]`) scores `empty` instead, which counts as a
failure. Honors each library's `skip.txt`, not `compare-skip.txt`: a model the
STL comparison cannot grade still renders here. Writes `e2e/render-report.json`.

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
Every `ci/render*` job and `ci/web` serve on port 5120 of the same host, so run
them one at a time: `ci/render` exits 2 if the port is already taken rather
than sweep a server that disappears when its own job ends.
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
captured from, per-library ok/fail counts, and each failure as `{ rel, status }`,
plus `cells` (a grid's dead cells) and `why` (the error text) where there are
any. `"flaky": true` on an entry accepts either `ok` or its status, for a model
that sits on its time limit.

`--baseline <file>` makes the sweep compare itself with one: it prints each
fixed model and each regression, and exits 1 only on a regression, which is a
new failure, a changed status (`error` to `timeout`, `ok` to `empty`) or a new
dead cell in a grid. Cells compare by URL, not message. Every `ci/render*` job
passes its own baseline, so the job's exit status is the regression signal. To
refresh a baseline, copy `ok`, `failed`, `byLib` and `failures` from the
sweep's report, whose `failures` array is already in baseline form.

It records no commit. `sci` rsyncs the working tree onto a base worktree, so the
commit the CI run reports is that worktree's HEAD, not the code measured — a
field nobody can trust is worse than none.

`e2e/render-grids-baseline.json` is the same thing for the grid sweep: **35 of
44** on manifold, CI job `737437e4401ff051`. Each failure carries its `status`,
the cells that drew a marker, and why the grid itself died. `docs/backlog.md`
groups them by cause. In that run the three NopSCADlib grids no longer trap in
`PSUs.scad` and time out at the 320s guard instead.

The current baseline is **761 ok of 807** on manifold, CI job
`b758af600414f82f`. It grew by the 22 models that moved to `compare-skip.txt`,
all of which render, and it counts 45 models as `empty` now that an empty
result is no longer an `ok`: echo- and assert-only library doc examples
(`021-math-sum.scad`, `157-utility-assert_equal.scad`) and files that only
define modules (`hollow_out_square.scad`, `dragon_claw.scad`). Those are
correct as empty, so the baseline records them. Before that it was 784 of 785
(job `815f87b0abe7ee68`), which replaced a 596/788 baseline recorded before the
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
jscadui/render-jscad` does at CI scale: **719 of 807**, CI job
`66c6287cbb317a60`, recorded in `e2e/render-jscad-baseline.json`. 59 of its 88
failures are `empty`, and 25 of the 28 errors extrude a geom2 whose sides do
not close, which is where that engine's remaining work is; `random_city.scad`
and `random_city_taiwan.scad` joined that group once they stopped being
skipped. `offset.scad` now reports `model exceeded 290000 ms` rather than a
bare `Error:`. See `docs/backlog.md`. That sweep measures
whatever `@jscad/modeling` the CI host's sibling `OpenJSCAD.org` checkout is
on, which is not tied to the jscadui commit — the baseline records which
modeling commit it measured.
