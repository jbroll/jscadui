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

`e2e/render-baseline.json` records the known sweep state: the commit and CI job
it was captured from, per-library ok/fail counts, and the failing example
paths. Diff future runs against `failures`, not against zero.

The current baseline is **596 ok of 788**, from commit `c3ee198`, CI job
`491f86f1330fbdf2`. That is the honest number. The previous baseline claimed 764
ok, but it was recorded by a harness that waited for `#progress` to become
hidden while `static/main.css` already sets that element `display: none` — the
wait resolved before the model ran, so most of its "passes" never rendered. The
old file was replaced, not amended; the two are not comparable.

88 of the 192 failures are a pre-existing browser-only geometry gap that fails
on `main` as well, not a regression.

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
