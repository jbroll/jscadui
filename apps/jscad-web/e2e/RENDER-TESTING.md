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

## Baseline

`e2e/render-baseline.json` records the known sweep state: the CI job it was
captured from, per-library ok/fail counts, and the failing example paths. Diff
future runs against `failures`, not against zero.

It records no commit. `sci` rsyncs the working tree onto a base worktree, so the
commit the CI run reports is that worktree's HEAD, not the code measured — a
field nobody can trust is worse than none.

The current baseline is **623 ok of 789**, CI job `cdc20a40944c1fc3`, run from
the `fix/example-model-failures` working tree. It replaced a 596/788 baseline
after three fixes: `main()` no longer returns the `NO_CHILD` sentinel (88
failures), `offset(delta=…)` names JSCAD's sharp-corner mode `edge` rather than
`sharp` (22), and `$preview` became a run-time variable that the app sets true
while displaying (which is what makes NopSCADlib's tests draw at all). The
extra file is `examples/openscad/01-basics/preview-gate.scad`.

The largest remaining cluster is 60 models failing with `Cannot read properties
of undefined`, 46 of them NopSCADlib tests that only now run their preview
geometry, plus 26 with `Cannot set properties of undefined (setting 'color')`
and 18 timeouts. Both clusters throw inside `@jscad/modeling`, which the STL
comparison suite never runs: the app defaults to the `jscad` engine and that
suite uses `manifold`. Pass `--engine manifold` to sweep the other one.

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
