# Dossier: `part()` boundaries for JSCAD and SCAD parts

**Task**: Spread a single model's parts across the compute frame's worker pool like an `ALL.js` grid spreads its leaves, reusing `jscadClaim`, a key per part, and fan-out on the first claim.
**Classification**: feature / refactor (perf + runtime protocol). **Scope**: large (6–20 files across `packages/worker`, `apps/jscad-web/src_frame`, `apps/jscad-web/src`, docs, tests).
**Backlog item**: `docs/backlog.md:165-168`.

## 1. Files to touch (likely)

| File | Why |
|---|---|
| `apps/jscad-web/src_frame/gridRun.js` | The run/claim/fan-out engine. `claim()` (:97), `fanOut()` (:91), `relayedCells` (:118), `merged()` (:142), `answered` (:197), `leave` (:216), `supersede` (:263) all assume grid leaves. |
| `packages/worker/src/stream.js` | `createStreamHook` (:29) exposes `claim` (:47) and `emit` (:32); the place a per-part claim hook would live. |
| `packages/worker/worker.js` | `jscadMain` (:271); the existing single-model multi-solid stream (`streamParts`, :393-403) is the natural home. |
| `packages/worker/src/claims.js` | `createClaims` (:12) — the reusable claim abstraction. |
| `apps/jscad-web/src/streamRuns.js` | App-side single streamed run holder (:25-101). |
| `apps/jscad-web/examples/lib/grid-utils.js` | `gridModule` (:239) and the claim call sites (:292, :302) — the reference implementation. |
| `apps/jscad-web/src_frame/workerPool.js` | Pool, reload, retire, `NEEDS_MODEL`/`NEEDS_SOLIDS` (:6-7), `relay` (:179). |
| `apps/jscad-web/src_frame/workerSlot.js` | `restartTimers` (:63) per-cell budget restart. |
| `apps/jscad-web/src_frame/frameHost.js` | `receive` routing of `jscadClaim` (:118) and `jscadCells` (:119); `claims: true` in init (:288). |
| `docs/WORKER_PROTOCOL.md` | Protocol contract for `jscadClaim` (:223-256), streaming (:166-182). |
| `apps/jscad-web/docs/architecture.md` | Streamed runs, Streaming claims, budget (:455-630). |
| Tests | See §6. |

## 2. The ALL.js grid mechanism, end to end

### Grid generator and cell declaration
- Grids are generated artifacts, never tracked (`docs/backlog.md:478-481`; `packages/openscad/bin/generate-all-files.js`, `organize-corpus.js`).
- Every generated `ALL.js` calls `gridModule(items, { spacing, cellSize }, require)` at `examples/lib/grid-utils.js:239`. `items` is an array of URLs (a sub-grid URL is detected by `isGridUrl`, :222).
- A **cell** is one item rendered at a grid position: `gridPosition(index,total,spacing)` :26-38, `gridExtent` :47-51. A cell is normalized/scaled/placed by `normalizeAndPlace(geoms, gx, gy, cellSize)` :79-133 (bbox → centre → uniform scale to `cellSize` → translate to `(gx,gy)`), then transformed to world by `toWorld(geoms, ctx)` :60-67.
- **Sub-grid nesting/scaling**: `subGridContext(ctx, x, y, cellSize, extent)` :54-58 computes `ctx · translate(x,y) · scale(s)`, `s = cellSize / max(extent)`; the sub-grid module is invoked `mod.runGrid(params[name], { ctx: subGridContext(...), path: key, stream })` :295-299. The sub-grid's size is known from item count alone (`gridExtent`), so a parent can size it before any leaf runs (:41-51, docs :483-490).

### Claims: spreading leaves over the pool
- **Key per leaf** = index path: `const key = [...path, i]` :284, sent as `key.join('/')` (e.g. `"2/14"`) :292, :302. Item lists are static, so **every worker computes the same keys** (docs :493-499).
- **Worker side**: `createClaims({ post, randomId, heap })` (`packages/worker/src/claims.js:12`) posts `{ method:'jscadClaim', id, params:[{ key, url, runId, heap }] }` (:22-25) and resolves the promise when `answer({id, won})` arrives (:28-33). The stream hook exposes `hook.claim = (key,url) => claim(key,url,runId)` and marks the run emitted (`stream.js:47-52`).
- The grid calls `stream.claim(key.join('/'), url)` before running a leaf; a lost claim (`false`) skips the leaf (`grid-utils.js:302`). A sub-grid's failed load is claimed under its own key so only one worker draws the skull (:292).
- **Frame side**: `frameHost.receive` routes `jscadClaim` to `runs.claim(slot, data)` (`frameHost.js:118`). `claim()` (`gridRun.js:97-114`): updates `slot.heap`, finds the run by `runId`, refuses if not a member / run closed / recycling / key already in `run.claimed`; on a win: records `member.order = run.claimed.size` (first-claim rank), increments `member.wins`, `run.claimed.add(key)`, records key/url/startedAt. It restarts timers and answers `{ method:'__CLAIM__', params:[{ id, won }] }` directly on the worker (:112); **first won claim fans out** (:113).
- **Fan-out**: `fanOut(run)` (`gridRun.js:91-95`) sets `run.fanned = true` and `join`s workers until `run.members.size === state.poolSize`, then `pool.ensureSpare()`. `join` (`:83-89`) picks an idle worker or starts one and relays the stored request to it. Joining workers load the script the run was sent against (`workerPool.js:170`, `scriptFor`).
- **Streaming cells back**: grids call `stream.emit(geoms)` (:254-264 / `stream.js:32-41`), which posts `{ method:'jscadCells', params:[{ entities, runId }] }` with buffers transferred. The frame relays only cells whose `runId` names an open run the slot belongs to (`gridRun.js:118-124`; `frameHost.js:119`); relaying clears `member.key` (a claimed leaf streams one batch).
- **App side**: `createStreamRuns` (`src/streamRuns.js:25`) holds one run, `begin(isStale, runId)` (:49), `accept(batch, runId)` (:53 — caps/check/accumulate/draw), `finish(runId, lost)` (:83), `end`, `discard`. `runId` is a random UUID so a spoofed batch names no open run (docs :601-614).
- **Final answer**: `merged(run)` (`gridRun.js:142-175`) sorts answers by claim order (primary = order 0), merges proxy states (`mergeProxyStates.js`), warnings, console; returns `entities: []`, `streamed: true`, `runId`, `lost`. `answer` posts it when the last member settles (`settle`/`answered`, :177-212).

### `normalizeAndPlace`
- Definition `examples/lib/grid-utils.js:79-133`. It measures the aggregate bbox (`measureAggregateBoundingBox`, handles single or array bbox), centres each geometry, uniformly scales to `cellSize/maxSize`, translates to `(gx,gy,0)`, and disposes the two intermediate transforms (`disposeIntermediate`, :135-139). Called for each leaf at :311 and for failure markers via `markerFor` :212.

### Grid failure path
- **Skull marker**: `failureMarker()` (:191-193) colourises two skull meshes from `./skull-mesh.js`; `prebuiltSkull(gx,gy,cellSize,ctx)` (:201-206) builds a placement-only marker needing no WASM. `markerFor` (:209-216) uses `failureMarker` unless `globalThis.__allWasmTrap` is set or building fails, then `prebuiltSkull`. The grid's `fail(url,x,y,err)` (:267-277) sets `__allWasmTrap` on a WASM trap (`isWasmTrap`, :218), logs `ALL: FAILED <url>: <msg>`, records the failed url, and sends the marker.
- **Trapped-WASM worker replacement**: after a trap the grid stops claiming (`grid-utils.js:281` breaks the item loop) and later cells throw `not run: wasm trapped in <url>` (:305). Frame side: `answered` detects `trapped(data)` and calls `pool.retire(slot, 'the model trapped in WebAssembly')`, then `join(run)` to recruit a replacement while the run is open (`gridRun.js:205-210`; `trapped` :11; also `frameHost.js:141`). Docs: `architecture.md:524-533`.
- **Sweep scoring `partial`**: the sweep reads `ALL: FAILED ` console lines into `cellFailures` and sets `status='partial'` when a grid otherwise returned ok (`e2e/render-all.mjs:227-231`); baseline diff treats new dead cells as regressions (`e2e/baseline-diff.mjs:9,41`; tests `test/render-baseline-diff.test.js:40-54`). Baseline `e2e/render-grids-baseline.json`; docs `e2e/RENDER-TESTING.md:65-72`.

### Budget restart per cell (120s / 290s)
- **120s default**: `main.js:291` `DEFAULT_EDITOR_TIMEOUT_MS = 120_000`; the app sends `timeoutMs: 120000` in `initFrame()`, or `engine.modelTimeoutMs` (docs `architecture.md:170-176`; `main.js:294`).
- **290s sweep**: `e2e/render-all.mjs:75` default `timeout: 300_000`; :101-104 `modelTimeout = max(30_000, timeout-30_000)` capped at `MAX_MODEL_TIMEOUT`; `RENDER-TESTING.md:38` states the budget stops at 290 s with a 300 s RPC. Baseline `why` strings show `model exceeded 290000 ms` (`render-grids-baseline.json:81`).
- **Restart on each claim/cell**: every claim calls `slotOps.restartTimers(slot)` (`gridRun.js:111`); `restartTimers` clears and re-arms each pending request's kill timer (`workerSlot.js:63-70`). Relayed `jscadCells`/`jscadProgress` also restart timers (`frameHost.js:109-126`). So the budget bounds **one cell/leaf**, not the whole grid (docs `architecture.md:594-599`; `backlog.md:133-135`).

## 3. The frame worker pool (`apps/jscad-web/src_frame/`)

- **Composition**: `createFrameHost` (`frameHost.js:46`) wires `createSlots` → `createPool` → `createGridRuns` (`:80-99`). State (`:61-75`): `slots`, `active`, `mirrored`, `lastScript`, `sentScript`, `lastSource`, `lastMain`, `poolSize`, `timeoutMs`.
- **Worker count**: `defaultPoolSize(hardwareConcurrency) = max(1, min(hardwareConcurrency-1, 2))` (`frameHost.js:27-29`) — memory-bounded, not core-bounded. `jscadInit.poolSize` overrides; the frame strips it (`:285`). Pool keeps at most `poolSize + 1` workers (active + run members + one warm idle; `ensureSpare` `workerPool.js:65-68`).
- **`NEEDS_MODEL` / `NEEDS_SOLIDS`** (`workerPool.js:6-7`): `jscadMain`, `jscadExportData`, `jscadMeasure`, `jscadCheck` need a loaded model; the last three also need solids, so `ensureLoaded` reloads the last script (`runMain:false`) and possibly the last `jscadMain` (`stream:false`) before them (`:205-233`). Requests queue behind the reload (`relay` :179-183, `release` :185-193).
- **Claims / replay / NEEDS_MODEL interplay**: `relay` calls `needsReload` (`:174-176`) and, when true, `ensureLoaded`; otherwise `dispatch` (`:159-167`), which calls `openRun` (`gridRun.open`) and tracks the request. On a new worker, `start({ replay:true })` replays `state.mirrored` (`:39-44`; `mirror` :83-85, frameHost `mirror` :255-263 — holds one init, latest `jscadSetFiles`, cache clears in order).
- **Worker replacement**: `retire(slot, reason)` (`workerPool.js:104-117`) promotes an idle worker or starts one, `handOver`s setup answers, calls `onExit` (`runs.leave`) and `slotOps.end`. `kill` (:131-142) removes a dead/timed-out worker (posts `frameWorkerTerminated` unless the slot was in a fanned grid run). `reset` (:122-129) ends all workers on source change. `trim` (:72-81) ends all idle workers but the smallest-heap one under budget after a run settles. `abortActive` (:148-157) for the Stop button.
- **1 GiB WASM heap recycling**: `RECYCLE_HEAP_BYTES = 2**30` (`gridRun.js:7`). Each claim carries `slot.heap`; a member past the budget after winning a leaf is marked `recycle`, every later claim refused (`gridRun.js:102-104`), and on answer it is retired and a replacement joined (:205-210). Docs `architecture.md:535-549`; protocol `WORKER_PROTOCOL.md:232-248`.

## 4. How a single model runs now

- **Entry/protocol**: worker methods in `packages/worker/worker.js`: `jscadInit`, `jscadScript` (:487), `jscadMain` (:271), `jscadExportData`, `jscadMeasure`, `jscadCheck` (protocol doc `docs/WORKER_PROTOCOL.md`).
- **What `main()` returns / how multiple geometries are handled**: `jscadMain` flattens `main`'s return (`worker.js:371/377/380`), splits `previewOnly` ghosts (`:383-385`), and stores `workerState.solids`. Then:
  - If the model streamed itself (grid), solids are dropped, result is `streamed` (`:394-396`).
  - **Single-model multi-solid path** (`streamParts`, :393): if `hook && !emitted() && runId !== undefined && solids.length > 1`, it emits **one `jscadCells` batch per solid in array order** (`:397-403`) and marks the result `streamed:true, runId` (:430) — but the worker **keeps the solids** for export.
  - Otherwise converts all solids to entities in one result (`:419-426`).
- **Rendering / caps**: app receives either a whole `entities` array or streamed batches (`src/streamRuns.js`); `src/caps.js` bounds entities (2000) and buffers; `STREAM_CAPS` (1.5 GB / 20,000 entities) for streamed runs (docs `architecture.md:400-413`).
- **OpenSCAD transpiled `main`**: returns `[solid, ...ghosts]`; ghosts are geom3/geom2 with `previewOnly:true` (`architecture.md:392-398`). Ghosts are drawn but excluded from `solids` and dropped by grid cells.
- **Export after a streamed run**: `src_frame/withSolids.js` re-runs `jscadMain` with `stream:false, solidsOnly:true` (`architecture.md:581-592`; `worker.js:415-426`; test `worker.stream.test.js:430-460`).

## 5. What `part()` means in both worlds

**There is no `part()` function anywhere in this repo** (grep for `function part(`, `.part(`, `partCount`, `part_number` found none; `.deps-cache` has none). "Part" is the informal name for **an item of the array `main()` returns**:

- **JSCAD**: `main` returns a single geom or an array; each top-level array item is a "part". `@jscadui/model-tools` addresses them by index: `measureParts(geom, geomType, selectors)` with selectors `"N"` / `"N-M"` / `"all"` (`packages/model-tools/src/measure.js:68-73`), and `measureAnchors` tags each `{ part: String(i) }` (:91-99). The model-tools test shows `{ part: '0-1', dimensions: [...] }` (`test/measure.test.js:33`). The multipart example is `examples/jscad/13-multipart.example.js` (`src/examples.js:14`).
- **OpenSCAD**: transpiled `main` returns solids (+ ghosts); there is no per-part naming/grouping in the runtime. The `parts` package (`packages/parts`) is an unrelated **catalog of library hardware**, and `src/partsBrowser.js` is its UI — not a geometry-part concept.
- **UI distinguishing parts**: none by name. Each geometry becomes an entity drawn in the scene; the params tree's "part path" is a **parameter namespace**, not geometry (`packages/params-ui`, `params-controller`). Instancing groups only matching geometry **within one streamed batch**, not across parts (`architecture.md:468-470`).
- **Where part/group counts are measured (the grader)**: `packages/agent-loop/eval/probe.js` — `bodiesOf` splits polygons by shared-vertex connectivity (:277-293), `runProbe` sets `out.bodyCount = groups.length` (:327). `packages/agent-loop/eval/judge.js:25-48` renders the prompt text "`N separate solid(s)`, in `M group(s) not touching each other" (`solidsAndGroups`, :39-44); tests `judge.test.js:59-101`. `packages/agent-loop/eval/mesh.js:135` carries a `part` field per mesh piece.

## 6. Existing tests and commands

**Unit (vitest)**:
- Grid module/claims: `apps/jscad-web/test/grid-module.test.js` (claiming hook helper :43-56, claims describe block :125+), `grid-utils.test.js`, `grid-order.test.js`, `all-grid.test.js`.
- Frame/pool/run: `test/frame-host.test.js`, `test/run-id.test.js`, `test/stream-runs.test.js`, `test/with-solids.test.js`, `test/params-ui.test.js`, `test/caps.test.js`.
- Worker streaming/claims: `packages/worker/worker.stream.test.js` (claims :366-427, multi-part stream :148-201, `withSolids` :430+), `packages/worker/src/claims.test.js`, `packages/worker/src/stream.test.js`, `packages/worker/worker.ghosts.test.js`.
- Sweep baseline: `test/render-baseline-diff.test.js`.

**Commands**:
```bash
# app unit tests (from apps/jscad-web)
npx vitest run test/grid-module.test.js test/grid-utils.test.js test/stream-runs.test.js test/frame-host.test.js
npm test                       # vitest run (app)
# worker unit tests (from packages/worker)
npx vitest run                 # worker.js, src/claims.test.js, src/stream.test.js
# e2e / render sweep
npm run test:e2e               # playwright, from apps/jscad-web
node e2e/render-all.mjs --grids --baseline   # needs `npm run dev` up
```
`TESTING.md` is the full test-structure reference.

## 7. Conventions / prior art

- **Protocol versioning via `jscadInit`**: `claims: true` is set by the frame and read by the worker (`frameHost.js:288`; `worker.js:254,342`; `worker.stream.test.js:381,418-427`). Any new claim surface should be gated the same way. `poolSize`/`timeoutMs` are frame-only and stripped (`frameHost.js:282-289`; `WORKER_PROTOCOL.md:16-18`).
- **Request vs notification**: a message with a top-level `id` is a request the worker answers; `jscadClaim` carries its id **inside `params`** and the answer is a `__CLAIM__` notification with the id nested, precisely so the worker does not treat it as a request (`claims.js:5-8`, `gridRun.js:112`, `WORKER_PROTOCOL.md:237-244`).
- **Reusable claim abstraction**: `createClaims` (`packages/worker/src/claims.js:12`) is transport-only — it takes `{ post, randomId, heap }` and knows nothing about grids. The optional `hook.claim` (`stream.js:47-52`) is the injection point. A single-model part run would add a claim call alongside the `streamParts` loop in `worker.js:397-403`, keyed by part index.
- **Run naming**: `runId` is a random UUID (`src/runId.js`) echoed on every `jscadCells` and the streamed result; the app's `createStreamRuns` accepts a batch only when `runId` matches (`streamRuns.js:53`; docs `architecture.md:601-614`).
- **Merging across members**: `mergeProxyStates.js` merges params discovered by each member; `mergedWarnings`/`mergedConsole` collectors in `gridRun.js:130-140`. A part run spread over workers would reuse these.
- **Leaving/retiring members**: `gridRun.leave` (:216-240) frees a dead member's current leaf for one retry (`run.retried`, `pendingLost`) and reports it via `lost`; `streamRuns.finish` raises `lostError` (`streamRuns.js:12-17,83-95`). A part run needs the same lost-part semantics.
- **Failure marker reuse**: `failureMarker`/`prebuiltSkull` (`grid-utils.js:191-206`) live in `examples/lib/`, not the worker bundle; the worker keeps no marker of its own. A part-level failure marker would need a worker-side equivalent or the same console/`ALL: FAILED` convention.
- **Budget semantics**: budgets are per-leaf because claims/cells restart timers (`workerSlot.js:63-70`); a part run must decide whether each part claim restarts the model budget likewise.

## Open questions for design (not answered here)
1. Whether the worker (not the grid model code) should drive the part claim loop — grids claim from model code, but a plain model has no `gridModule`.
2. Whether `streamParts` (`worker.js:393-403`) becomes claim-aware or a new path is added.
3. Key scheme for parts (index path `"0"`, `"1"`, …) and whether rendered/serialized output order must match `main`'s array order.
4. Interaction with `solidsOnly` re-runs and `withSolids` after a fanned part run.

**Key source anchors**: `docs/backlog.md:128-168`; `apps/jscad-web/docs/architecture.md:455-630`; `docs/WORKER_PROTOCOL.md:166-256`; `apps/jscad-web/src_frame/gridRun.js` (whole file); `apps/jscad-web/examples/lib/grid-utils.js:239-342`; `packages/worker/src/claims.js`; `packages/worker/src/stream.js`; `packages/worker/worker.js:271-478`.
