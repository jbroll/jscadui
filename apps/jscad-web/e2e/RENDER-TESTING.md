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
anonymous timeout. `--model-timeout` sets that budget directly.

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

The current baseline is **782 ok of 789** on manifold, CI job
`34cc8ef47df70c74`. It replaced a 596/788 baseline recorded before the
example-failure work. The largest single move was the engine default: the app
used to default to `jscad`, which rendered 623 where manifold rendered 762 on
the same tree. The rest came from six transpiler and runtime fixes, two
example-generator fixes, and a 300s hang guard in place of a 30s one.

All seven that remain have a named cause: `util/rands_disk.scad`,
`maze/mz_wang_tiles.scad` and 11 of `Import_Library.scad`'s assets are absent
from the vendored sources; `packing_circles.scad` exceeds the 5M vertex cap;
two maze models exceed the call stack; and `voronoi_melon.scad` really does run
past 270s.

Sweeping the other engine takes `--engine jscad`: **738 of 789**, CI job
`d4f77513990d2eed`. 24 of its 51 failures extrude a geom2 whose sides do not
close, which is where that engine's remaining work is. See `docs/backlog.md`.

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
