# Streamed ALL.js Grids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw an `ALL.js` grid cell by cell as the worker finishes each one, with the model budget applying per cell, the worker freeing each cell once sent, and a skull in every failed cell.

**Architecture:** The worker puts a stream hook on `globalThis.__jscadStream` for the length of one `jscadMain`. The outermost generated grid emits each placed cell through it; the worker converts and posts it as a `jscadCells` notification. The frame relays those while a model-running request is pending and restarts its kill timer on each; the app restarts its RPC timers, checks caps per batch and per run, accumulates the batches, and redraws at most every 250 ms. three.js keeps built objects across `setScene` calls so each redraw builds only the new cells.

**Tech Stack:** Plain ES2022 JS, vitest, Playwright sweep harness, simple-ci (`sci`) on the GPU host.

**Spec:** `docs/superpowers/specs/2026-09-24-streamed-grids-design.md`

## Global Constraints

- Targets modern browsers only. ES2022+, no polyfills or compat shims.
- Per-batch caps stay 256 MB and 2,000 entities (`DEFAULT_CAPS`). Streamed-run totals: 1.5 GB (`1.5 * 1024 * 1024 * 1024` bytes) and 20,000 entities.
- Redraws coalesce to at most one per 250 ms.
- Message names are exactly `jscadCells` (params `[{ entities }]`) and `jscadProgress` (params `[]`).
- Globals are exactly `globalThis.__jscadStream` (`{ emit(geoms), progress() }`) and `globalThis.__jscadProgress` (a function).
- Comments: default to none; one or two lines saying why, never what. Match surrounding code style (no semicolons, 2-space indent, single quotes).
- Do not run the OpenSCAD comparison suite or the render sweeps locally. Unit tests (`npx vitest run` in a package) are fine locally.
- Docs change in the same commit as the code they describe.
- Commit after each task with a message ending in:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Never open a pull request.

## Deviations from the spec, decided here

1. **Loads stream too.** The app loads a model with `jscadScript`, which runs `jscadMain` inside the worker. The frame therefore relays `jscadCells` while a `jscadScript` *or* `jscadMain` request is pending, and a load is a streaming run in the app. Without this the first render of a grid would draw nothing.
2. **three.js reuses objects by entity object identity, not entity id.** `JscadToCommon` ids repeat within a run (a colored or transformed copy shares its mesh's id) and `clearCache()` resets the sequence after an error. The app accumulates batch entity objects into one array, so the same object reaches each `setScene` and identity is exact.
3. **The prebuilt skull is a plain `geom3` (`{ polygons, transforms, color }`) on both paths.** `JscadToCommon.prepare` converts it with no WASM, so the streaming path passes it to `emit` like any cell. Only triangle vertices are stored; `JscadToCommon` computes normals from each polygon's plane.

## File map

| File | Change |
|---|---|
| `packages/postmessage/index.js` | `resetTimeouts()` on `initMessaging` and the proxy |
| `apps/jscad-web/examples/lib/build-skull-mesh.mjs` | new: writes `skull-mesh.js` from `failureMarker()` |
| `apps/jscad-web/examples/lib/skull-mesh.js` | new, generated: flat triangle vertex array |
| `apps/jscad-web/examples/lib/grid-utils.js` | `prebuiltSkull(gx, gy, cellSize)` |
| `packages/openscad/bin/generate-all-files.js` | new grid template; all `ALL.js` regenerated |
| `packages/worker/src/stream.js` | new: `createStreamHook`, `withStreamHook` |
| `packages/worker/worker.js` | `jscadMain` streams; `lastRunStreamed`, `postProgress`, `releaseSolids` |
| `packages/worker/src/state/workerState.js` | `lastRunStreamed` field |
| `apps/jscad-web/src_frame/frameHost.js` | relay `jscadCells` / `jscadProgress`, restart timers |
| `apps/jscad-web/src_frame/bundle.frame-worker.js` | export/measure/check re-run a streamed grid |
| `packages/render-threejs/objectCache.js` | new: reuse built objects across scenes |
| `packages/render-threejs/index.js` | `setScene` uses the cache |
| `apps/jscad-web/src/caps.js` | `STREAM_CAPS`, `geometryBytes`, `checkLimits` |
| `apps/jscad-web/src/streamRuns.js` | new: accept, cap, coalesce, finish a streamed run |
| `apps/jscad-web/src/frameSetup.js` | `jscadCells` / `jscadProgress` notifications, `onCells` |
| `apps/jscad-web/src/paramsUI.js` | `runModelUpdate` calls `beginRun` / `endRun` deps |
| `apps/jscad-web/main.js` | wire streaming runs |
| `apps/jscad-web/e2e/render-all.mjs` | guard restarts when `data-cells` changes |
| `apps/jscad-web/e2e/RENDER-TESTING.md`, `ci/render-grids` | per-cell budgets |

---

### Task 1: `resetTimeouts()` in `@jscadui/postmessage`

**Files:**
- Modify: `packages/postmessage/index.js` (`sendCmd` ~line 96, `rejectPending` ~181, return object ~195, `messageProxy` ~215)
- Test: `packages/postmessage/index.test.js`

**Model:** `haiku` — one file, complete code below.

**Interfaces:**
- Produces: `initMessaging(...).resetTimeouts(): void` and `messageProxy(...).resetTimeouts(): void`. Each pending request's timer restarts with the duration it started with.

- [ ] **Step 1: Write the failing test.** Append to `packages/postmessage/index.test.js` (read the top of the file first and reuse its existing fake-port helper if there is one; the shape below uses a minimal fake):

```js
describe('resetTimeouts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const fakePort = () => ({ postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })

  it('restarts each pending timer with its original duration', async () => {
    const { sendCmd, resetTimeouts } = initMessaging(fakePort(), {})
    const result = sendCmd('slow', [], [], 1000)
    const settled = vi.fn()
    result.catch(settled)
    vi.advanceTimersByTime(900)
    resetTimeouts()
    vi.advanceTimersByTime(900)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(101)
    await expect(result).rejects.toThrow('RPC timeout for slow after 1000ms')
  })

  it('is exposed on the proxy', () => {
    const proxy = messageProxy(fakePort(), {})
    expect(typeof proxy.resetTimeouts).toBe('function')
  })
})
```

Make sure `vi`, `beforeEach`, `afterEach`, `initMessaging`, `messageProxy` are imported at the top of the file.

- [ ] **Step 2: Run to verify failure.** `cd packages/postmessage && npx vitest run index.test.js` — expect FAIL, `resetTimeouts is not a function`.

- [ ] **Step 3: Implement.** In `sendCmd`, replace the body of the `new Promise` executor with:

```js
      const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT
      const arm = () => setTimeout(() => {
        if (reqMap.has(id)) {
          reqMap.delete(id)
          onJobCount?.(reqMap.size)
          reject(new Error(`RPC timeout for ${method} after ${effectiveTimeout}ms`))
        }
      }, effectiveTimeout)
      reqMap.set(id, [resolve, reject, arm(), arm])
      onJobCount?.(reqMap.size)
```

Keep the existing H11/H2 comments only if they still describe the code. After `rejectPending`, add:

```js
  /** Restart every pending timer, for when the other end shows it is still working. */
  const resetTimeouts = () => {
    for (const entry of reqMap.values()) {
      clearTimeout(entry[2])
      entry[2] = entry[3]()
    }
  }
```

Add `resetTimeouts` to the object `initMessaging` returns. In `messageProxy`, destructure `resetTimeouts` from `initMessaging(...)` and add it to the proxy target: `{ getRpcJobCount, onmessage: listener, destroy, rejectPending, resetTimeouts }`.

Check `packages/postmessage/test/reqmap.test.js` and any other test that reads `reqMap` entries by index; entries now have a fourth element.

- [ ] **Step 4: Run tests.** `cd packages/postmessage && npx vitest run` — all PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/postmessage/index.js packages/postmessage/index.test.js
git commit -m "feat(postmessage): resetTimeouts restarts pending request timers"
```

---

### Task 2: Prebuilt skull in `grid-utils.js`

**Files:**
- Create: `apps/jscad-web/examples/lib/build-skull-mesh.mjs`
- Create (generated): `apps/jscad-web/examples/lib/skull-mesh.js`
- Modify: `apps/jscad-web/examples/lib/grid-utils.js`
- Test: `apps/jscad-web/test/grid-utils.test.js`

**Model:** `sonnet` — a generator script plus a data file plus a CJS helper; needs care about how the file is loaded.

**Interfaces:**
- Produces: `prebuiltSkull(gx: number, gy: number, cellSize: number) => { polygons: Array<{vertices: number[][]}>, transforms: number[16], color: [0.85, 0.1, 0.1, 1] }`, exported from `grid-utils.js`. Its bounding box is centred on `(gx, gy, 0)` with longest side `cellSize`, like `normalizeAndPlace(failureMarker(), gx, gy, cellSize)`.
- `skull-mesh.js`: `module.exports = [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...]`, 9 numbers per triangle, centred on the origin, longest side 1, rounded to 4 decimals.

- [ ] **Step 1: Write the failing test.** Read `apps/jscad-web/test/grid-utils.test.js` to see how it loads `grid-utils.js`. `grid-utils.js` will `require('./skull-mesh.js')` relative to itself, so it must be loaded with a require rooted at its own path: `createRequire(join(examplesDir, 'lib', 'grid-utils.js'))`. If the test loads it with a require rooted elsewhere, change that. Add:

```js
describe('prebuiltSkull', () => {
  it('fills the cell like the built marker, without any boolean', () => {
    const { prebuiltSkull } = gridUtils
    const skull = prebuiltSkull(90, -30, 51)
    expect(skull.color).toEqual([0.85, 0.1, 0.1, 1])
    const [[x0, y0, z0], [x1, y1, z1]] = measureBoundingBox(skull)
    expect(Math.max(x1 - x0, y1 - y0, z1 - z0)).toBeCloseTo(51, 1)
    expect((x0 + x1) / 2).toBeCloseTo(90, 1)
    expect((y0 + y1) / 2).toBeCloseTo(-30, 1)
    expect((z0 + z1) / 2).toBeCloseTo(0, 1)
  })

  it('builds fresh polygons each call', () => {
    const { prebuiltSkull } = gridUtils
    expect(prebuiltSkull(0, 0, 1).polygons).not.toBe(prebuiltSkull(0, 0, 1).polygons)
  })
})
```

`measureBoundingBox` is `require('@jscad/modeling').measurements.measureBoundingBox`; `gridUtils` is whatever the file already names the loaded module.

- [ ] **Step 2: Run to verify failure.** `cd apps/jscad-web && npx vitest run test/grid-utils.test.js` — FAIL, `prebuiltSkull is not a function`.

- [ ] **Step 3: Write the generator** `apps/jscad-web/examples/lib/build-skull-mesh.mjs`:

```js
#!/usr/bin/env node
// Writes skull-mesh.js: failureMarker() as triangles, so a grid can draw a
// skull after a wasm trap without running any boolean.
// Run: node apps/jscad-web/examples/lib/build-skull-mesh.mjs
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, 'grid-utils.js'))
const { geom3 } = require('@jscad/modeling').geometries
const { failureMarker } = require('./grid-utils.js')

const triangles = []
for (const g of failureMarker()) {
  for (const { vertices } of geom3.toPolygons(g)) {
    for (let i = 1; i < vertices.length - 1; i++) triangles.push(vertices[0], vertices[i], vertices[i + 1])
  }
}
const min = [Infinity, Infinity, Infinity]
const max = [-Infinity, -Infinity, -Infinity]
for (const v of triangles) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]) }
const size = Math.max(...max.map((m, k) => m - min[k]))
const centre = max.map((m, k) => (m + min[k]) / 2)
const flat = triangles.flatMap(v => v.map((c, k) => Math.round(((c - centre[k]) / size) * 1e4) / 1e4))

writeFileSync(join(here, 'skull-mesh.js'),
  '// Generated by build-skull-mesh.mjs from failureMarker(). Do not edit.\n' +
  `module.exports = ${JSON.stringify(flat)}\n`)
console.log(`skull-mesh.js: ${flat.length / 9} triangles`)
```

Run it: `node apps/jscad-web/examples/lib/build-skull-mesh.mjs`. If the file is over ~400 KB, lower `segments` in `failureMarker()` is not an option (it changes the built marker); instead round to 3 decimals and say so in the report.

- [ ] **Step 4: Add `prebuiltSkull` to `grid-utils.js`**, after `failureMarker`:

```js
/**
 * The failure marker as stored triangles, for a cell that fails once the
 * wasm has trapped: building it needs no boolean and no wasm.
 *
 * @returns {object} a plain geom3 placed at (gx, gy) with longest side cellSize
 */
function prebuiltSkull(gx, gy, cellSize) {
  const data = require('./skull-mesh.js')
  const polygons = []
  for (let i = 0; i < data.length; i += 9) {
    polygons.push({ vertices: [data.slice(i, i + 3), data.slice(i + 3, i + 6), data.slice(i + 6, i + 9)] })
  }
  const s = cellSize
  return { polygons, transforms: [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, gx, gy, 0, 1], color: [0.85, 0.1, 0.1, 1] }
}
```

Add `prebuiltSkull` to `module.exports`. The require stays inside the function so grids that never fail never load the data.

- [ ] **Step 5: Run tests.** `cd apps/jscad-web && npx vitest run test/grid-utils.test.js` — PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/jscad-web/examples/lib/build-skull-mesh.mjs apps/jscad-web/examples/lib/skull-mesh.js apps/jscad-web/examples/lib/grid-utils.js apps/jscad-web/test/grid-utils.test.js
git commit -m "feat(examples): prebuilt skull marker that needs no wasm"
```

---

### Task 3: Streaming grid template

**Files:**
- Modify: `packages/openscad/bin/generate-all-files.js:180-258` (the `content` template)
- Regenerate: every `ALL.js` under `apps/jscad-web/examples/` (23 tracked, more gitignored)
- Test: `apps/jscad-web/test/all-grid.test.js`

**Model:** `sonnet` — template-in-template escaping and a test harness rework.

**Interfaces:**
- Consumes: `prebuiltSkull(gx, gy, cellSize)` from Task 2.
- Produces: a generated `main(params)` that, with `globalThis.__jscadStream = { emit, progress }` set, calls `emit(placedGeoms)` once per cell in order, disposes each placed geometry that has `dispose()`, returns `[]`, and leaves the global as it found it; with no hook but `globalThis.__jscadProgress` set, calls it once per cell and returns geometry; with neither, behaves as today except that cells failing after a trap get `prebuiltSkull`.

- [ ] **Step 1: Write failing tests.** In `apps/jscad-web/test/all-grid.test.js`:

1. Change `runGrid` so `grid-utils.js` is loaded with a require rooted at its own path (it now requires `./skull-mesh.js`), and so a test can replace grid-utils exports:

```js
const gridUtilsPath = join(examplesDir, 'lib', 'grid-utils.js')

const runGrid = (broken = [], { trap = [], models = {}, utils = {} } = {}) => {
  const req = (name) => {
    if (name.endsWith('grid-utils.js')) {
      return { ...loadCjs(gridUtilsPath, createRequire(gridUtilsPath)), ...utils }
    }
    if (broken.includes(name)) throw new Error(`boom in ${name}`)
    if (trap.includes(name)) throw new WebAssembly.RuntimeError('function signature mismatch')
    return { main: models[name] ?? (() => cube({ size: 10 })) }
  }
  return loadCjs(gridPath, req).main({})
}
```

2. Add `delete globalThis.__jscadStream` and `delete globalThis.__jscadProgress` to the `afterEach`.

3. Add a `describe('streaming', ...)` block:

```js
describe('streaming', () => {
  const hook = () => {
    const batches = []
    return { batches, emit: vi.fn(geoms => batches.push(geoms)), progress: vi.fn() }
  }

  it('emits each cell in order and returns nothing', async () => {
    const stream = globalThis.__jscadStream = hook()
    const geoms = await runGrid()
    expect(geoms).toEqual([])
    expect(stream.batches).toHaveLength(11)
    const centres = stream.batches.map(b => measureAggregateBoundingBox(...b)).map(([[x0], [x1]]) => (x0 + x1) / 2)
    expect(centres[0]).toBeCloseTo(-90, 5)
    expect(centres[1]).toBeCloseTo(-30, 5)
  })

  it('disposes each placed geometry after it is sent', async () => {
    const placed = []
    const normalizeAndPlace = () => { const g = { dispose: vi.fn() }; placed.push(g); return [g] }
    globalThis.__jscadStream = hook()
    await runGrid([], { utils: { normalizeAndPlace } })
    expect(placed).toHaveLength(11)
    for (const g of placed) expect(g.dispose).toHaveBeenCalledOnce()
  })

  it('hides the hook from a nested grid, which returns its geometry', async () => {
    const stream = globalThis.__jscadStream = hook()
    let seen = 'unset'
    const nested = async () => { seen = globalThis.__jscadStream; return cube({ size: 10 }) }
    await runGrid([], { models: { './text-fonts.scad': nested } })
    expect(seen).toBeNull()
    expect(globalThis.__jscadStream).toBe(stream)
  })

  it('emits the prebuilt skull for every cell after a trap', async () => {
    const stream = globalThis.__jscadStream = hook()
    await failureLines(() => runGrid([], { trap: ['./text-fonts.scad'] }))
    const trapped = items.indexOf('./text-fonts.scad')
    for (const batch of stream.batches.slice(trapped)) {
      expect(batch).toHaveLength(1)
      expect(batch[0].transforms).toHaveLength(16)
      expect(batch[0].color).toEqual([0.85, 0.1, 0.1, 1])
    }
  })

  it('turns a failure inside emit into that cell\'s marker', async () => {
    const stream = hook()
    let calls = 0
    stream.emit = vi.fn(geoms => { if (calls++ === 0) throw new Error('numTri failed'); stream.batches.push(geoms) })
    globalThis.__jscadStream = stream
    const lines = await failureLines(() => runGrid())
    expect(lines[0]).toMatch(/^ALL: FAILED .*: numTri failed$/)
    expect(stream.batches).toHaveLength(11)
  })
})

describe('progress without streaming', () => {
  it('calls __jscadProgress once per cell and returns the geometry', async () => {
    globalThis.__jscadProgress = vi.fn()
    const geoms = await runGrid()
    expect(globalThis.__jscadProgress).toHaveBeenCalledTimes(11)
    expect(geoms).toHaveLength(11)
  })
})
```

`items` is the grid's item list; read it from the generated file once at the top of the test: `const items = JSON.parse(readFileSync(gridPath, 'utf-8').match(/const items = (\[[\s\S]*?\])/)[1])`. Check the real item order in `examples/openscad/text/ALL.js` and adjust the centre expectations for the first two cells (grid 4 wide, spacing 60, centred: x = -90, -30, 30, 90).

4. Change the existing trap test `'fails every cell after a wasm trap instead of trusting it'` only if its expectations break; the log lines do not change.

- [ ] **Step 2: Run to verify failure.** `cd apps/jscad-web && npx vitest run test/all-grid.test.js` — the streaming and progress tests FAIL.

- [ ] **Step 3: Rewrite the template.** In `generate-all-files.js`, replace the generated text from the `require` line through `module.exports = { main }` with the following. Inside the outer template literal every inner backtick and `${` must stay escaped as `\`` and `\${`, as the current template does.

```js
const { gridPosition, normalizeAndPlace, urlToPartName, failureMarker, prebuiltSkull } = require('${libPath}')

const items = ${itemsJson}
const spacing = ${spacing}
const cellSize = ${cellSize}

const isWasmTrap = (err) =>
  (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError) || err?.name === 'RuntimeError'

// Once the wasm has trapped, a built marker would need it too
const markerFor = (x, y) => {
  if (!globalThis.__allWasmTrap) {
    try {
      return normalizeAndPlace(failureMarker(), x, y, cellSize)
    } catch { /* fall back to the stored skull */ }
  }
  return [prebuiltSkull(x, y, cellSize)]
}

const main = async (params) => {
  // Only the outermost grid streams; a nested grid arrives in it as one cell
  const stream = globalThis.__jscadStream
  globalThis.__jscadStream = null
  try {
    return await runCells(params, stream)
  } finally {
    globalThis.__jscadStream = stream
  }
}

const runCells = async (params, stream) => {
  const all = []
  const nameSeen = {}
  const failed = []
  const generation = globalThis.__jscadScriptGeneration

  const send = (geoms) => {
    if (!stream) {
      all.push(...geoms)
      return
    }
    try {
      stream.emit(geoms)
    } finally {
      for (const g of geoms) if (typeof g?.dispose === 'function') g.dispose()
    }
  }

  for (const [i, url] of items.entries()) {
    const [x, y] = gridPosition(i, items.length, spacing)

    try {
      let name = urlToPartName(url)
      if (nameSeen[name]) {
        nameSeen[name]++
        name = \`\${name}_\${nameSeen[name]}\`
      } else {
        nameSeen[name] = 1
      }

      // A trapped wasm instance stays broken, so no later cell's result can be trusted
      if (globalThis.__allWasmTrap) throw new Error(\`not run: wasm trapped in \${globalThis.__allWasmTrap}\`)

      const mod = require(url)
      const fn = (mod && mod.main) || (typeof mod === 'function' ? mod : null)
      if (typeof fn === 'function') {
        const geoms = [].concat(await fn(params[name])).flat()
        // emit evaluates the cell's CSG, so its failures belong to this cell too
        send(normalizeAndPlace(geoms, x, y, cellSize))
      }
    } catch (err) {
      // One bad model marks its own cell; the rest of the grid still renders
      if (isWasmTrap(err)) globalThis.__allWasmTrap ??= url
      console.error(\`ALL: FAILED \${url}: \${err.message}\`)
      failed.push(url)
      try {
        send(markerFor(x, y))
      } catch (markerErr) {
        if (isWasmTrap(markerErr)) globalThis.__allWasmTrap ??= url
        send([prebuiltSkull(x, y, cellSize)])
      }
    }

    if (!stream) globalThis.__jscadProgress?.()
    // Manifold handles are freed by a FinalizationRegistry, which only runs once main yields
    await new Promise(r => setTimeout(r, 0))
    // Yielding lets a newer script start in this worker; stop rather than run beside it
    if (globalThis.__jscadScriptGeneration !== generation) throw new Error(\`grid superseded by a newer script after \${url}\`)
  }

  if (failed.length) {
    console.error(\`ALL: \${failed.length}/\${items.length} models failed: \${failed.join(' ')}\`)
  }
  return stream ? [] : all
}

module.exports = { main }
```

Keep the file's existing header comment lines above the `require`.

- [ ] **Step 4: Regenerate the grids.** From the repo root: `node packages/openscad/bin/generate-all-files.js`. Then `git status --short` must show only `ALL.js` files modified (no renames, no deletions of tracked models). If anything else changed, `git checkout` those paths and report it.

- [ ] **Step 5: Run tests.** `cd apps/jscad-web && npx vitest run test/all-grid.test.js test/grid-utils.test.js test/grid-order.test.js` — PASS. Also `cd packages/openscad && npx vitest run` — PASS (the Node path takes the no-hook branch).

- [ ] **Step 6: Commit.**

```bash
git add packages/openscad/bin/generate-all-files.js apps/jscad-web/test/all-grid.test.js
git add -u apps/jscad-web/examples
git commit -m "feat(grids): stream each cell through __jscadStream when the worker sets it"
```

---

### Task 4: Worker stream hook

**Files:**
- Create: `packages/worker/src/stream.js`
- Create: `packages/worker/src/stream.test.js`
- Modify: `packages/worker/worker.js` (`jscadMain` ~lines 203-345, exports near line 480)
- Modify: `packages/worker/src/state/workerState.js` (add a field)
- Modify: `docs/WORKER_PROTOCOL.md` (document `jscadCells`, `jscadProgress`, `streamed`)

**Model:** `sonnet` — threads a hook through an existing long function.

**Interfaces:**
- Produces from `stream.js`:
  - `createStreamHook({ post, userInstances }) => { hook: { emit(geoms), progress() }, emitted: () => boolean }`. `post(message, transfer)` is `self.postMessage`.
  - `withStreamHook(hook, run) => Promise` — sets `globalThis.__jscadStream = hook` (may be `null`), awaits `run()`, clears to `null` in `finally`.
- Produces from `worker.js`: `jscadMain({ ..., stream = true })`. A run during which `emit` was called resolves to `{ entities: [], streamed: true, treeTime, execTime: 0, convTime: 0, proxyState? }` and sets `workerState.lastRunStreamed = true`; a `stream: true` run that emitted nothing sets it `false`; a `stream: false` run leaves it alone. New exports: `lastRunStreamed(): boolean`, `postProgress(): void`, `releaseSolids(): void`.

- [ ] **Step 1: Write the failing test** `packages/worker/src/stream.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createStreamHook, withStreamHook } from './stream.js'

const mesh = () => ({ type: 'mesh', vertices: new Float32Array(9), normals: new Float32Array(9) })

describe('stream hook', () => {
  afterEach(() => { delete globalThis.__jscadStream })

  it('posts each batch as jscadCells with its buffers for transfer', () => {
    const post = vi.fn()
    const { hook, emitted } = createStreamHook({ post, userInstances: false })
    const a = mesh()
    hook.emit([a])
    expect(emitted()).toBe(true)
    const [message, transfer] = post.mock.calls[0]
    expect(message.method).toBe('jscadCells')
    expect(message.params[0].entities).toHaveLength(1)
    expect(transfer).toContain(a.vertices.buffer)
    expect(transfer).toContain(a.normals.buffer)
    expect(new Set(transfer).size).toBe(transfer.length)
  })

  it('forces manifold evaluation before converting', () => {
    const numTri = vi.fn()
    const solid = { ...mesh(), isManifoldGeom3: true, manifold: { numTri } }
    createStreamHook({ post: vi.fn() }).hook.emit([solid])
    expect(numTri).toHaveBeenCalled()
  })

  it('posts progress with no geometry', () => {
    const post = vi.fn()
    const { hook, emitted } = createStreamHook({ post })
    hook.progress()
    expect(post).toHaveBeenCalledWith({ method: 'jscadProgress', params: [] })
    expect(emitted()).toBe(false)
  })

  it('sets the hook for the run and clears it after, even on a throw', async () => {
    const hook = {}
    let seen
    await withStreamHook(hook, async () => { seen = globalThis.__jscadStream })
    expect(seen).toBe(hook)
    expect(globalThis.__jscadStream).toBeNull()
    await expect(withStreamHook(hook, async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(globalThis.__jscadStream).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure.** `cd packages/worker && npx vitest run src/stream.test.js` — FAIL, module not found.

- [ ] **Step 3: Write `packages/worker/src/stream.js`:**

```js
import { JscadToCommon } from '@jscadui/format-jscad'

/**
 * The hook an ALL.js grid finds on globalThis.__jscadStream: each emitted
 * cell goes to the app at once instead of waiting for main to return.
 * @param {{post: (message: object, transfer?: Transferable[]) => void, userInstances?: boolean}} options
 */
export const createStreamHook = ({ post, userInstances }) => {
  let emitted = false
  const hook = {
    emit(geoms) {
      const solids = [geoms].flat(Infinity)
      for (const solid of solids) {
        if (solid?.isManifoldGeom3) solid.manifold.numTri()
      }
      const transferable = []
      const entities = JscadToCommon.prepare(solids, transferable, userInstances).all
      emitted = true
      post({ method: 'jscadCells', params: [{ entities }] }, [...new Set(transferable.map(a => a.buffer || a))])
    },
    progress() {
      post({ method: 'jscadProgress', params: [] })
    },
  }
  return { hook, emitted: () => emitted }
}

/**
 * @template T
 * @param {object | null} hook
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
export const withStreamHook = async (hook, run) => {
  globalThis.__jscadStream = hook
  try {
    return await run()
  } finally {
    globalThis.__jscadStream = null
  }
}
```

- [ ] **Step 4: Run.** `npx vitest run src/stream.test.js` — PASS.

- [ ] **Step 5: Wire into `jscadMain`.**

1. `workerState.js`: add a `lastRunStreamed = false` field beside `solids` (follow how the class/object declares its other fields).
2. `worker.js`: `import { createStreamHook, withStreamHook } from './src/stream.js'`.
3. Add `stream = true` to `jscadMain`'s destructured options and its JSDoc.
4. Just before the `try {` that runs main, create the hook:

```js
  const { hook, emitted } = stream
    ? createStreamHook({ post: (message, transfer) => self.postMessage(message, transfer), userInstances: workerState.userInstances })
    : { hook: null, emitted: () => false }
  const runMain = (mainParams) => withStreamHook(hook, () => workerState.main(mainParams))
```

5. Replace the three `await workerState.main(X)` calls with `await runMain(X)`.
6. After `treeTime = performance.now() - time`, add the streamed branch; the existing evaluation/conversion runs only when nothing was emitted:

```js
    if (stream) workerState.lastRunStreamed = emitted()
    let entities = []
    if (emitted()) {
      // Each cell went out as it finished; keeping them would hold the whole grid again
      workerState.solids = []
    } else {
      ...existing numTri loop, execTime, prepare, convTime, assigning `entities`...
    }
    const result = { entities, treeTime, execTime, convTime }
    if (emitted()) result.streamed = true
```

Keep the proxyState block and `return withTransferable(result, transferable)` as they are.
7. Near `currentSolids`, add:

```js
export const lastRunStreamed = () => workerState.lastRunStreamed

export const postProgress = () => self.postMessage({ method: 'jscadProgress', params: [] })

export const releaseSolids = () => { workerState.solids = [] }
```

- [ ] **Step 6: Document.** In `docs/WORKER_PROTOCOL.md` under `jscadMain`, add: the `stream` option; the `streamed: true` / `entities: []` result; the `jscadCells` (`params: [{ entities }]`, buffers transferred) and `jscadProgress` (`params: []`) notifications the worker posts during a run; that only the outermost `ALL.js` grid emits.

- [ ] **Step 7: Run the worker and app tests.** `cd packages/worker && npx vitest run`; `cd apps/jscad-web && npx vitest run test/fluent-worker.test.js test/parity.test.js` — PASS. If `parity.test.js` or another test drives `jscadMain` in Node where `self` is undefined, have `createStreamHook` receive `post` lazily (`(m, t) => self.postMessage(m, t)` is only called on emit, so a non-grid model never touches `self`); confirm that holds.

- [ ] **Step 8: Commit.**

```bash
git add packages/worker docs/WORKER_PROTOCOL.md
git commit -m "feat(worker): stream grid cells from jscadMain through __jscadStream"
```

---

### Task 5: Frame host relays cells and progress

**Files:**
- Modify: `apps/jscad-web/src_frame/frameHost.js` (`track` ~72, `attach` ~83, `handleMessage` ~147)
- Test: `apps/jscad-web/test/frame-host.test.js`

**Model:** `sonnet` — security-relevant relay rules in a small file.

**Interfaces:**
- Consumes: worker notifications `{ method: 'jscadCells', params: [{ entities }] }` and `{ method: 'jscadProgress', params: [] }` (Task 4).
- Produces: relays them to the app as `{ method, params }` with `collectBuffers` as the transfer list, restarting every pending kill timer with the current `timeoutMs`.

- [ ] **Step 1: Write failing tests.** Replace the test `'does not relay a control message the worker makes up'` body's expectations only if needed, and add a new `describe`:

```js
describe('streamed cells and progress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const cells = { method: 'jscadCells', params: [{ entities: [] }] }
  const progress = { method: 'jscadProgress', params: [] }

  it('relays cells while a jscadMain is pending', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] })
    workers[0].onmessage({ data: cells })
    expect(posted).toEqual([cells])
  })

  it('relays cells while a jscadScript is pending, since a load runs main', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadScript', id: 1, params: [] })
    workers[0].onmessage({ data: cells })
    expect(posted).toEqual([cells])
  })

  it('drops cells while only another request is pending', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadExportData', id: 1, params: [] })
    workers[0].onmessage({ data: cells })
    expect(posted).toEqual([])
  })

  it('drops cells and progress with nothing pending', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] })
    answer(workers[0])
    posted.length = 0
    workers[0].onmessage({ data: cells })
    workers[0].onmessage({ data: progress })
    expect(posted).toEqual([])
  })

  it('relays progress while any request is pending', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadExportData', id: 1, params: [] })
    workers[0].onmessage({ data: progress })
    expect(posted).toEqual([progress])
  })

  it('drops a cells message that carries an id', () => {
    const { posted, workers, send } = setup()
    send({ method: 'jscadMain', id: 1, params: [] })
    workers[0].onmessage({ data: { ...cells, id: 'x' } })
    expect(posted).toEqual([])
  })

  it('restarts the kill timer on each relayed message', () => {
    const { posted, workers, send } = setup()
    init(send, { timeoutMs: 1000 }, 1)
    answer(workers[0])
    send({ method: 'jscadMain', id: 2, params: [] })
    vi.advanceTimersByTime(900)
    workers[0].onmessage({ data: cells })
    vi.advanceTimersByTime(900)
    workers[0].onmessage({ data: progress })
    vi.advanceTimersByTime(900)
    expect(posted.find((m) => m.id === 2)).toBeUndefined()
    vi.advanceTimersByTime(101)
    expect(posted.find((m) => m.id === 2)?.error?.name).toBe('TimeoutError')
  })
})
```

- [ ] **Step 2: Run to verify failure.** `cd apps/jscad-web && npx vitest run test/frame-host.test.js` — the new tests FAIL.

- [ ] **Step 3: Implement.** Replace `track` and the `worker.onmessage` handler:

```js
  const track = (appId, method) => {
    const workerId = randomId()
    const arm = () => setTimeout(() => {
      killWorker(workerId, `model exceeded ${timeoutMs} ms`, 'TimeoutError')
    }, timeoutMs)
    pending.set(workerId, { appId, method, arm, timer: arm() })
    return workerId
  }

  // A cell or a progress beat shows the model is still advancing, so the
  // budget becomes the longest one step may take.
  const restartTimers = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.timer = request.arm()
    }
  }

  const RUNS_MAIN = new Set(['jscadMain', 'jscadScript'])
  const relayable = (method) => {
    if (method === 'jscadProgress') return pending.size > 0
    if (method === 'jscadCells') return [...pending.values()].some((r) => RUNS_MAIN.has(r.method))
    return false
  }
```

Update the `pending` JSDoc type to `{appId: unknown, method: string, arm: () => ReturnType<typeof setTimeout>, timer: ReturnType<typeof setTimeout>}`.

In `attach`, at the top of `worker.onmessage`:

```js
      if (data?.id == null && relayable(data?.method)) {
        restartTimers()
        const message = { method: data.method, params: data.params }
        post(message, collectBuffers(message))
        return
      }
```

Update the comment above `attach` to say the worker sends answers plus streamed cells and progress. In `handleMessage`, change `track(id)` to `track(id, data?.method)`.

- [ ] **Step 4: Run.** `npx vitest run test/frame-host.test.js test/collect-buffers.test.js` — PASS. Check `collectBuffers` finds typed arrays nested in `params[0].entities[*]`; if it does not, report it rather than changing it silently.

- [ ] **Step 5: Commit.**

```bash
git add apps/jscad-web/src_frame/frameHost.js apps/jscad-web/test/frame-host.test.js
git commit -m "feat(frame): relay streamed cells and progress, restarting the kill timer"
```

---

### Task 6: Export, measure and check re-run a streamed grid

**Files:**
- Modify: `apps/jscad-web/src_frame/bundle.frame-worker.js:65-106`

**Model:** `sonnet` — no unit harness for this bundle; verified by build and the export e2e in CI.

**Interfaces:**
- Consumes: `jscadMain({ params, stream: false })`, `lastRunStreamed()`, `postProgress()`, `releaseSolids()`, `currentSolids()`, `currentParams()` from `@jscadui/worker` (Task 4).

- [ ] **Step 1: Implement.** Add the new names to the `@jscadui/worker` import. Replace `currentGeometry`, `jscadMeasure`, `jscadCheck`, `jscadExportData` with:

```js
const asGeometry = (solids) => solids.length === 1 ? solids[0] : solids

// A streamed grid kept none of its cells, so it runs again whole. Each cell
// reports progress, which restarts the frame's and the app's timers.
const withSolids = async (use) => {
  if (!lastRunStreamed()) return use(currentSolids())
  globalThis.__jscadProgress = postProgress
  try {
    await jscadMain({ params: currentParams(), stream: false })
    return await use(currentSolids())
  } finally {
    globalThis.__jscadProgress = null
    releaseSolids()
  }
}

const jscadMeasure = ({ options = {} }) => withSolids((solids) => modelTools().measure(asGeometry(solids), options))

const jscadCheck = ({ bed, options = {} }) => withSolids((solids) => modelTools().check(asGeometry(solids), { ...options, bed }))

const jscadExportData = async ({ format, options = {} }) => {
  const jscadIo = require('@jscad/io', null, readFileWeb)
  const config = defaultSerializerConfigs.find((c) => c.id === format)
  if (!config) throw new Error(`Unknown export format: ${format}`)
  // Only a model that reads $preview can differ between the two modes, and
  // re-running one is expensive, so ask the runtime whether it ever mattered.
  // A streamed grid is re-run for the export anyway, in preview mode.
  const renderMode = !lastRunStreamed() && _openscad?.j$.previewUsed
  try {
    if (renderMode) {
      setScadPreview(false)
      await jscadMain({ params: currentParams() })
    }
    return await withSolids((solids) => {
      const data = jscadIo[config.serializerKey].serialize({ ...config.defaultOptions, ...options }, solids)
      return withTransferable({ data }, data.filter((v) => typeof v !== 'string'))
    })
  } finally {
    if (renderMode) {
      setScadPreview(true)
      await jscadMain({ params: currentParams() })
    }
  }
}
```

Keep the existing comment block above these (`// ── measure, check and export ──` and the classification note) trimmed to what still applies.

- [ ] **Step 2: Build.** `cd apps/jscad-web && npm run build` (read `package.json` for the right script if `build` is not it) — must succeed.

- [ ] **Step 3: Run the frame-side tests.** `cd apps/jscad-web && npx vitest run test/` — PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/jscad-web/src_frame/bundle.frame-worker.js
git commit -m "feat(frame): export, measure and check re-run a streamed grid"
```

---

### Task 7: three.js keeps built objects across scenes

**Files:**
- Create: `packages/render-threejs/objectCache.js`
- Create: `packages/render-threejs/objectCache.test.js`
- Modify: `packages/render-threejs/index.js` (`setScene` ~228-268, `setMeshColor` ~106)
- Modify: `packages/render-threejs/package.json` (`"test": "vitest run"`)

**Model:** `sonnet` — cache semantics plus renderer integration.

**Interfaces:**
- Produces: `createObjectCache(dispose: (obj3d) => void) => { begin(reset: boolean): void, get(entity: object, build: (entity) => object | undefined): object | undefined, end(): void, clear(): void }`.
  - `begin(true)` disposes everything kept (mesh color or smoothing changed).
  - `get` returns the object built for this same entity object in the previous scene, or builds one. An entity seen twice in one scene gets a second, separately built object.
  - `end()` disposes objects from the previous scene that were not reused, after a `setTimeout(0)` as the current code does.

- [ ] **Step 1: Write the failing test** `packages/render-threejs/objectCache.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { createObjectCache } from './objectCache.js'

const scene = (cache, entities, build) => {
  cache.begin(false)
  const out = entities.map((e) => cache.get(e, build))
  cache.end()
  return out
}

describe('object cache', () => {
  it('builds only entities it has not seen', () => {
    vi.useFakeTimers()
    const dispose = vi.fn()
    const cache = createObjectCache(dispose)
    const build = vi.fn((e) => ({ from: e }))
    const a = {}, b = {}
    const [first] = scene(cache, [a], build)
    const [again, second] = scene(cache, [a, b], build)
    expect(again).toBe(first)
    expect(build).toHaveBeenCalledTimes(2)
    vi.runAllTimers()
    expect(dispose).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('disposes objects whose entity is gone', () => {
    vi.useFakeTimers()
    const dispose = vi.fn()
    const cache = createObjectCache(dispose)
    const a = {}, b = {}
    const [objA] = scene(cache, [a, b], (e) => ({ e }))
    scene(cache, [b], (e) => ({ e }))
    vi.runAllTimers()
    expect(dispose).toHaveBeenCalledWith(objA)
    expect(dispose).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('rebuilds everything after a reset', () => {
    const dispose = vi.fn()
    const cache = createObjectCache(dispose)
    const a = {}
    const [before] = scene(cache, [a], (e) => ({ e }))
    cache.begin(true)
    expect(dispose).toHaveBeenCalledWith(before)
    expect(cache.get(a, (e) => ({ e }))).not.toBe(before)
    cache.end()
  })

  it('gives a repeated entity its own object', () => {
    const cache = createObjectCache(vi.fn())
    const a = {}
    const [x, y] = scene(cache, [a, a], (e) => ({ e }))
    expect(x).not.toBe(y)
  })
})
```

- [ ] **Step 2: Run to verify failure.** `cd packages/render-threejs && npx vitest run` — FAIL, module not found.

- [ ] **Step 3: Write `objectCache.js`:**

```js
/**
 * Three.js objects built for each entity, kept across setScene calls so a
 * streamed grid's redraw builds only the cells that just arrived. Keyed by
 * the entity object: ids repeat when copies share a mesh.
 * @param {(obj3d: object) => void} dispose
 */
export const createObjectCache = (dispose) => {
  let kept = new Map()
  let next = new Map()
  let extra = []
  let staleExtra = []
  let timer = null

  const disposeAll = (list) => list.forEach(dispose)

  return {
    begin(reset) {
      if (reset) {
        disposeAll([...kept.values(), ...extra])
        kept = new Map()
        extra = []
      }
      next = new Map()
      staleExtra = extra
      extra = []
    },
    get(entity, build) {
      if (next.has(entity)) {
        const obj3d = build(entity)
        if (obj3d) extra.push(obj3d)
        return obj3d
      }
      let obj3d = kept.get(entity)
      if (obj3d) kept.delete(entity)
      else obj3d = build(entity)
      if (obj3d) next.set(entity, obj3d)
      return obj3d
    },
    end() {
      const stale = [...kept.values(), ...staleExtra]
      kept = next
      next = new Map()
      staleExtra = []
      timer = setTimeout(() => {
        timer = null
        disposeAll(stale)
      }, 0)
    },
    clear() {
      clearTimeout(timer)
      disposeAll([...kept.values(), ...next.values(), ...extra, ...staleExtra])
      kept = new Map()
      next = new Map()
      extra = []
      staleExtra = []
    },
  }
}
```

Note: if `end()` is called twice before the timer fires, the first timer's list must still be disposed; keep a list of pending timers or dispose the earlier stale list synchronously when a new `end()` starts. Pick one, and add a test for two `end()` calls in a row before timers run.

- [ ] **Step 4: Run.** `npx vitest run` — PASS.

- [ ] **Step 5: Use it in `index.js`.**
1. `import { createObjectCache } from './objectCache.js'`.
2. Replace the `disposalTimer` and `entities` bookkeeping with:

```js
  const disposeObject = (obj3d) => {
    obj3d.geometry?.dispose?.()
    obj3d.material?.dispose?.()
  }
  const built = createObjectCache(disposeObject)
  let builtWith = null
```

3. `setScene`:

```js
  function setScene(scene, { smooth } = {}) {
    groups.forEach(group => _scene.remove(group))
    groups.length = 0
    // Objects take the mesh color and smoothing they were built with
    built.begin(builtWith !== null && (builtWith.smooth !== smooth || builtWith.meshColor !== meshColor))
    builtWith = { smooth, meshColor }

    scene.items.forEach(item => {
      const group = new Group()
      group.jscadId = item.id
      group.ignoreBB = item.ignoreBB
      groups.push(group)
      item.items.forEach(obj => {
        const obj3d = built.get(obj, () => csgConvert(obj, { smooth, scene, meshColor }))
        if (obj3d) group.add(obj3d)
        else console.error('could not convert to obj3d', obj)
      })
      _scene.add(group)
    })
    built.end()
    updateView()
  }
```

Drop the `console.log('setScene', scene)` line; it logs the whole grid on every redraw. Drop the unused `Box3` bounding box in `setScene` only if nothing reads it (it is computed and never used today).
4. In `destroy`, replace the entity disposal and `disposalTimer` handling with `built.clear()`.

- [ ] **Step 6: Package test script.** In `packages/render-threejs/package.json` set `"test": "vitest run"`. Run `npm test -w @jscadui/render-threejs` (or `cd packages/render-threejs && npm test`) — PASS.

- [ ] **Step 7: Build the app** (`cd apps/jscad-web && npm run build`) to confirm the renderer bundles.

- [ ] **Step 8: Commit.**

```bash
git add packages/render-threejs
git commit -m "feat(render-threejs): keep built objects across setScene, build only new entities"
```

---

### Task 8: App stream-run state, caps and coalescing

**Files:**
- Modify: `apps/jscad-web/src/caps.js`
- Create: `apps/jscad-web/src/streamRuns.js`
- Test: `apps/jscad-web/test/caps.test.js`, create `apps/jscad-web/test/stream-runs.test.js`

**Model:** `sonnet` — a new pure module with timers.

**Interfaces:**
- Produces from `caps.js`: `STREAM_CAPS = { bytes: 1.5 * 1024 * 1024 * 1024, entities: 20_000 }`, `geometryBytes(entities): number`, `checkLimits(count: number, bytes: number, limits): void` (throws `ModelError`). `capGeometry` keeps its signature and messages.
- Produces from `streamRuns.js`: `createStreamRuns({ draw, onCells, onError, delayMs = 250 })` returning:
  - `begin(isStale: () => boolean): void` — starts a run, replacing any other.
  - `accept(entities: unknown): boolean` — `false` and nothing drawn if there is no run or it is stale. Otherwise checks the batch against `DEFAULT_CAPS` and the run's new totals against `STREAM_CAPS`; over a limit, flushes what is pending, ends the run and calls `onError(error)`. Otherwise appends, calls `onCells(acceptedBatchCount)`, and schedules `draw(entities, box)` within `delayMs`.
  - `finish(): {cells, vertices, triangles} | null` — the run's final result arrived: `null` if no run or stale; otherwise draws now (even with zero batches, so the previous model is replaced) and ends the run.
  - `end(): void` — flushes pending batches and ends the run (kill, error).
  - `draw(entities: object[], box: {min:{x,y,z}, max:{x,y,z}} | null)`; `entities` is the run's whole accumulated array.

- [ ] **Step 1: Write failing tests.** In `caps.test.js` add:

```js
import { STREAM_CAPS, geometryBytes, checkLimits } from '../src/caps.js'

describe('stream caps', () => {
  it('allows a streamed run 1.5 GB and 20,000 entities', () => {
    expect(STREAM_CAPS).toEqual({ bytes: 1.5 * 1024 * 1024 * 1024, entities: 20_000 })
  })
  it('sums typed-array bytes across entities', () => {
    expect(geometryBytes([{ vertices: new Float32Array(3) }, { indices: new Uint32Array(2) }])).toBe(20)
  })
  it('names the limit that was passed', () => {
    expect(() => checkLimits(3, 0, { entities: 2, bytes: 10 })).toThrow(/entity cap/)
    expect(() => checkLimits(1, 11, { entities: 2, bytes: 10 })).toThrow(/buffer cap/)
  })
})
```

Create `apps/jscad-web/test/stream-runs.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStreamRuns } from '../src/streamRuns.js'

const cell = (x = 0, n = 3) => ({ type: 'mesh', vertices: new Float32Array(n * 3).fill(x) })

const setup = () => {
  const draw = vi.fn()
  const onCells = vi.fn()
  const onError = vi.fn()
  const runs = createStreamRuns({ draw, onCells, onError })
  return { runs, draw, onCells, onError }
}

describe('stream runs', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('drops a batch when no run is streaming', () => {
    const { runs, draw } = setup()
    expect(runs.accept([cell()])).toBe(false)
    vi.runAllTimers()
    expect(draw).not.toHaveBeenCalled()
  })

  it('drops a batch from a stale run', () => {
    const { runs, draw } = setup()
    runs.begin(() => true)
    expect(runs.accept([cell()])).toBe(false)
    vi.runAllTimers()
    expect(draw).not.toHaveBeenCalled()
  })

  it('merges batches that arrive close together into one draw', () => {
    const { runs, draw, onCells } = setup()
    runs.begin(() => false)
    runs.accept([cell(1)])
    runs.accept([cell(2)])
    expect(onCells).toHaveBeenLastCalledWith(2)
    expect(draw).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(draw.mock.calls[0][0]).toHaveLength(2)
  })

  it('keeps a running bounding box of everything accepted', () => {
    const { runs, draw } = setup()
    runs.begin(() => false)
    runs.accept([cell(1)])
    runs.accept([cell(5)])
    vi.advanceTimersByTime(250)
    expect(draw.mock.calls[0][1]).toEqual({ min: { x: 1, y: 1, z: 1 }, max: { x: 5, y: 5, z: 5 } })
  })

  it('replaces the previous model on finish even with no batches', () => {
    const { runs, draw } = setup()
    runs.begin(() => false)
    expect(runs.finish()).toEqual({ cells: 0, vertices: 0, triangles: 0 })
    expect(draw).toHaveBeenCalledWith([], null)
  })

  it('draws pending batches at once on finish and reports totals', () => {
    const { runs, draw } = setup()
    runs.begin(() => false)
    runs.accept([cell(1, 6)])
    expect(runs.finish()).toEqual({ cells: 1, vertices: 6, triangles: 0 })
    expect(draw).toHaveBeenCalledTimes(1)
    expect(runs.accept([cell()])).toBe(false)
  })

  it('ends the run with the cap error and keeps what was drawn', () => {
    const { runs, draw, onError } = setup()
    runs.begin(() => false)
    runs.accept([cell()])
    const tooMany = Array.from({ length: 2001 }, () => cell())
    expect(runs.accept(tooMany)).toBe(false)
    expect(onError.mock.calls[0][0].message).toMatch(/entity cap/)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(draw.mock.calls[0][0]).toHaveLength(1)
    expect(runs.finish()).toBeNull()
  })

  it('caps the run total, not just each batch', () => {
    const { runs, onError } = setup()
    runs.begin(() => false)
    const batch = Array.from({ length: 2000 }, () => cell())
    for (let i = 0; i < 10; i++) expect(runs.accept(batch)).toBe(true)
    expect(runs.accept([cell()])).toBe(false)
    expect(onError.mock.calls[0][0].message).toMatch(/entity cap/)
  })

  it('returns null from finish for a stale run', () => {
    const { runs } = setup()
    let stale = false
    runs.begin(() => stale)
    runs.accept([cell()])
    stale = true
    expect(runs.finish()).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure.** `cd apps/jscad-web && npx vitest run test/caps.test.js test/stream-runs.test.js` — FAIL.

- [ ] **Step 3: Implement `caps.js`.** Keep `DEFAULT_CAPS` and `modelError`. Add:

```js
// A streamed grid is checked batch by batch against DEFAULT_CAPS and in total
// against these; its batches never exist in one message.
export const STREAM_CAPS = {
  bytes: 1.5 * 1024 * 1024 * 1024,
  entities: 20_000,
}

/** @param {Array<object>} entities */
export const geometryBytes = (entities) => {
  let bytes = 0
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue
    // byteLength is buffer metadata; summing it never copies the data.
    for (const value of Object.values(entity)) {
      if (ArrayBuffer.isView(value)) bytes += value.byteLength
    }
  }
  return bytes
}

const checkCount = (count, limits) => {
  if (count > limits.entities) throw modelError(`geometry exceeds the entity cap (${count} > ${limits.entities})`)
}

const checkBytes = (bytes, limits) => {
  if (bytes > limits.bytes) throw modelError(`geometry exceeds the buffer cap (${bytes} > ${limits.bytes})`)
}

export const checkLimits = (count, bytes, limits) => {
  checkCount(count, limits)
  checkBytes(bytes, limits)
}

export const capGeometry = (entities, limits) => {
  checkCount(entities.length, limits)
  checkBytes(geometryBytes(entities), limits)
  return entities
}
```

- [ ] **Step 4: Implement `streamRuns.js`:**

```js
import { boundingBox } from '@jscadui/format-common'
import { capGeometry, checkLimits, DEFAULT_CAPS, geometryBytes, STREAM_CAPS } from './caps.js'
import { countGeometry } from './stats.js'

const mergeBox = (a, b) => a ? {
  min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
  max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
} : b

const hasVertices = (entities) => entities.some((e) => e?.vertices?.length)

/**
 * One streamed run at a time: the batches a grid sends while the load or
 * parameter change that started it is current.
 * @param {{draw: (entities: object[], box: object | null) => void, onCells: (count: number) => void, onError: (error: Error) => void, delayMs?: number}} options
 */
export const createStreamRuns = ({ draw, onCells, onError, delayMs = 250 }) => {
  let run = null

  const flush = (always = false) => {
    if (!run) return
    clearTimeout(run.timer)
    run.timer = null
    if (run.isStale() || !(run.dirty || always)) return
    run.dirty = false
    draw(run.entities, run.box)
  }

  const stop = () => {
    flush()
    run = null
  }

  return {
    begin(isStale) {
      if (run) clearTimeout(run.timer)
      run = { isStale, entities: [], bytes: 0, cells: 0, vertices: 0, triangles: 0, box: null, timer: null, dirty: false }
    },
    accept(batch) {
      if (!run || run.isStale()) return false
      const entities = Array.isArray(batch) ? batch : []
      try {
        capGeometry(entities, DEFAULT_CAPS)
        const bytes = geometryBytes(entities)
        checkLimits(run.entities.length + entities.length, run.bytes + bytes, STREAM_CAPS)
        run.bytes += bytes
      } catch (error) {
        stop()
        onError(error)
        return false
      }
      for (const entity of entities) run.entities.push(entity)
      const { vertices, triangles } = countGeometry(entities)
      run.vertices += vertices
      run.triangles += triangles
      if (hasVertices(entities)) run.box = mergeBox(run.box, boundingBox(entities))
      run.cells++
      onCells(run.cells)
      run.dirty = true
      run.timer ??= setTimeout(flush, delayMs)
      return true
    },
    finish() {
      if (!run || run.isStale()) {
        if (run) clearTimeout(run.timer)
        run = null
        return null
      }
      flush(true)
      const { cells, vertices, triangles } = run
      run = null
      return { cells, vertices, triangles }
    },
    end: stop,
  }
}
```

`finish` draws with `always` so a run whose cells were all already drawn still redraws once; that is cheap because three.js reuses every object (Task 7). If the `bounding box` test fails because `boundingBox` treats the fill value differently, fix the test data, not the module.

Check that importing `stats.js` in Node does not touch the DOM at module load; if it does, move `countGeometry` into its own module and re-export it from `stats.js`.

- [ ] **Step 5: Run.** `npx vitest run test/caps.test.js test/stream-runs.test.js` — PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/jscad-web/src/caps.js apps/jscad-web/src/streamRuns.js apps/jscad-web/test/caps.test.js apps/jscad-web/test/stream-runs.test.js
git commit -m "feat(web): stream-run state with per-batch and per-run caps and 250 ms redraws"
```

---

### Task 9: Wire streaming into the app

**Files:**
- Modify: `apps/jscad-web/src/frameSetup.js` (`createFrame` notifications ~133, options JSDoc ~116)
- Modify: `apps/jscad-web/src/paramsUI.js` (`runModelUpdate` ~174)
- Modify: `apps/jscad-web/main.js`
- Test: `apps/jscad-web/test/frame-setup.test.js` (and `src/frameSetup.test.js` if that is where `createFrame` is tested)
- Docs: `apps/jscad-web/docs/architecture.md`, `docs/backlog.md`

**Model:** `opus` — cross-cutting wiring in `main.js` with staleness, errors and replay interacting.

**Interfaces:**
- Consumes: `proxy.resetTimeouts()` (Task 1); frame-relayed `jscadCells` / `jscadProgress` (Task 5); `createStreamRuns` (Task 8); worker `streamed: true` results (Task 4).
- Produces: `createFrame({ ..., onCells?: (entities: unknown[]) => void })`. `runModelUpdate(deps)` calls `deps.beginRun?.()` before `jscadMain` and `deps.endRun?.()` when it throws.

- [ ] **Step 1: Write failing frameSetup tests.** Read the existing `createFrame` tests to reuse their fake frame/port. Add:
  - A `jscadCells` notification from the frame calls `onCells` with its `entities` array, and restarts the pending RPC timers: start a `workerApi.jscadMain()` call with fake timers, advance to just before the 5-minute default, deliver `jscadCells`, advance again by the same amount, and the call is still pending.
  - A `jscadProgress` notification restarts the timers and does not call `onCells`.
  - A `jscadCells` whose `entities` is not an array calls `onCells` with `[]`.

- [ ] **Step 2: Run to verify failure.** `cd apps/jscad-web && npx vitest run test/frame-setup.test.js src/frameSetup.test.js` — FAIL.

- [ ] **Step 3: frameSetup.** Add `onCells` to `createFrame`'s options and JSDoc. Replace the `notifications` object and its comment:

```js
  // The frame sends frameWorkerTerminated on its own, and relays a grid's
  // cells and progress while a model is running.
  const notifications = {
    frameWorkerTerminated: ({ reason }) => {
      onError(new Error(reason))
      replay.restore()
      onTerminated?.()
    },
    jscadCells: ({ entities } = {}) => {
      proxy.resetTimeouts()
      onCells?.(Array.isArray(entities) ? entities : [])
    },
    jscadProgress: () => {
      proxy.resetTimeouts()
    },
  }
```

- [ ] **Step 4: paramsUI.** In `runModelUpdate`, destructure `beginRun, endRun` from `deps`; call `beginRun?.()` right before `await workerApi.jscadMain(...)`, and `endRun?.()` as the first line of its `catch`.

- [ ] **Step 5: main.js.**
1. Imports: `import { createStreamRuns } from './src/streamRuns.js'`.
2. After `handleEntities`, before `createFrame`, add:

```js
// A grid draws cell by cell; the camera refits to what is drawn, so it only zooms out.
const drawStream = (entities, box) => {
  viewState.setModel(entities)
  if (viewState.zoomToFit && box) {
    const { fov, aspect } = viewState.viewer.getCamera()
    ctrl.fit(box.min, box.max, fov, aspect, 1 / 0.6)
  }
}

const streamRuns = createStreamRuns({
  draw: drawStream,
  // Read by the render sweep, which restarts its hang guard on each cell
  onCells: count => { document.documentElement.dataset.cells = String(count) },
  onError: error => {
    setError(error)
    onProgress(undefined)
  },
})

/** @param {() => boolean} isStale */
const beginStream = isStale => {
  delete document.documentElement.dataset.cells
  streamRuns.begin(isStale)
}
```

3. At the top of `handleEntities`, handle the streamed final result:

```js
  if (result?.streamed) {
    const totals = streamRuns.finish()
    onProgress(undefined)
    if (!totals) return
    document.documentElement.dataset.vertices = String(totals.vertices)
    setError(undefined)
    updatePipelineStats(statsContent, { treeTime: result.treeTime, triangles: totals.triangles, vertices: totals.vertices })
    if (!skipLog) console.log('streamed', totals.cells, 'cells, tree:', result.treeTime?.toFixed(2))
    return
  }
```

4. `createFrame({... onCells: entities => streamRuns.accept(entities) })`.
5. Model-update deps: define once after `scriptRuns` exists and use it in `installStudioBridge`, the tree `onChange` and `onClassChange` calls (replacing the three inline `{ workerApi, handleEntities: handlers.entities, setError, stopCurrentAnim }` objects):

```js
const modelUpdateDeps = () => ({
  workerApi,
  handleEntities: handlers.entities,
  setError,
  stopCurrentAnim,
  beginRun: () => beginStream(scriptRuns.paramChange()),
  endRun: () => streamRuns.end(),
})
```

`installStudioBridge` is called before `scriptRuns` is declared; move the `const scriptRuns = createScriptRuns()` line up above `installStudioBridge` so the closure is safe to call at any time.
6. `paramChangeCallback`: after `const isStale = scriptRuns.paramChange()`, call `beginStream(isStale)`; add `catch (error) { streamRuns.end(); throw error }` to the existing `try/finally`.
7. `jscadScript`: after `const isStale = scriptRuns.load()`, call `beginStream(isStale)`. In the restore branch, call `beginStream(isStale)` right before `await workerApi.jscadMain(paramsCtrl.getWorkerParams())`. In the outer `catch (err)`, add `streamRuns.end()` before `if (!isStale()) setError(err)`.
8. `onRenderEngineChange`: after `const isStale = scriptRuns.paramChange()`, call `beginStream(isStale)`; wrap the `jscadMain` call so a throw calls `streamRuns.end()` and rethrows.

Leave `AnimRunner` and `createEvaluate` (AI) unchanged: they do not stream, and their batches are dropped because no run is current.

- [ ] **Step 6: Run all app tests.** `cd apps/jscad-web && npx vitest run` — PASS. Then `npm run build` in `apps/jscad-web` — succeeds. Then from the repo root `npm run validate` if it runs in reasonable time locally (lint + typecheck + tests); it must not run the OpenSCAD comparison suite. If `validate` includes it, run `npm run lint` and the typecheck script instead.

- [ ] **Step 7: Docs.**
  - `apps/jscad-web/docs/architecture.md`: a short section on streamed grids: the hook, the frame relay rule (cells while `jscadScript`/`jscadMain` is pending, progress while anything is), per-cell budgets from timer restarts, per-batch and per-run caps, 250 ms redraws, three.js reuse by entity object, export/measure/check re-running the grid.
  - `docs/backlog.md`, `## Combined ALL.js grids`: rewrite the first paragraph (a grid no longer holds all its geometry at once in the worker, and the budget is per cell). Leave the NopSCADlib and killed-grid bullets for Task 10 to update from measured results.

- [ ] **Step 8: Commit.**

```bash
git add apps/jscad-web/main.js apps/jscad-web/src/frameSetup.js apps/jscad-web/src/paramsUI.js apps/jscad-web/test apps/jscad-web/src/frameSetup.test.js apps/jscad-web/docs/architecture.md docs/backlog.md
git commit -m "feat(web): draw streamed grid cells as they arrive"
```

---

### Task 10: Sweep guard per cell

**Files:**
- Modify: `apps/jscad-web/e2e/render-all.mjs:176-196`
- Modify: `apps/jscad-web/e2e/RENDER-TESTING.md`, `ci/render-grids` (comment only)

**Model:** `sonnet` — harness change plus docs.

**Interfaces:**
- Consumes: `html[data-cells]`, set by the app on each accepted batch (Task 9).

- [ ] **Step 1: Implement.** Replace the `status = await Promise.race([...])` block with a wait that restarts whenever `data-cells` changes:

```js
    // A streamed grid sets data-cells as each cell lands, so the guard is per cell.
    const settled = async () => {
      let cells = null
      for (;;) {
        const handle = await page.waitForFunction((seen) => {
          const d = document.documentElement.dataset
          if (['ok', 'error'].includes(d.render)) return { settled: true }
          const now = d.cells ?? null
          return now !== seen ? { cells: now } : false
        }, cells, { timeout: opts.timeout })
        const state = await handle.jsonValue()
        if (state.settled) return
        cells = state.cells
      }
    }
    status = await Promise.race([settled(), crashed])
      .then(() => page.evaluate(() => document.documentElement.dataset.render))
```

Update the usage header's `--timeout` line to say the guard restarts on each streamed grid cell.

- [ ] **Step 2: Syntax check.** `node --check apps/jscad-web/e2e/render-all.mjs`. Do not run the sweep locally.

- [ ] **Step 3: Docs.** In `RENDER-TESTING.md`: the model budget (`--model-timeout`, capped at 290s) and the 320s hang guard both apply per cell for a streamed grid, because each cell restarts the frame's kill timer, the app's RPC timers and the harness guard; a grid is scored when it settles. Replace any statement that a grid holds every cell's geometry at once. Update the `ci/render-grids` header comment the same way (the concurrency and ordering rationale may stay if still true; say so only if it is).

- [ ] **Step 4: Commit.**

```bash
git add apps/jscad-web/e2e/render-all.mjs apps/jscad-web/e2e/RENDER-TESTING.md ci/render-grids
git commit -m "test(e2e): restart the sweep's hang guard on each streamed grid cell"
```

---

### Task 11: CI verification and baseline refresh (controller, inline)

**Model:** controller runs this itself: it waits on CI jobs with background `sci wait`.

- [ ] **Step 1:** Push the branch to CI and run the grid sweep: `sci push jscadui/render-grids`; wait with `sci wait <JOB-ID>` under Bash `run_in_background`.
- [ ] **Step 2:** Compare to `e2e/render-grids-baseline.json`. Expected changes: the NopSCADlib tests grid no longer fails the 256 MB cap (it is checked per batch and against 1.5 GB); grids that were killed at 290s may now finish. Any new failure or new dead cell is a regression to investigate before refreshing. Refresh the baseline to the new report and update the `docs/backlog.md` grid bullets and `RENDER-TESTING.md` counts from it. Commit.
- [ ] **Step 3:** Run the per-model sweep (`sci push jscadui/render`) and the comparison suite (`cd packages/openscad && npm test`); both must match their baselines unchanged.
- [ ] **Step 4:** Final whole-branch review (subagent, `opus`), then delete this plan and the spec in the final commit, folding anything not yet in `architecture.md` into it.
