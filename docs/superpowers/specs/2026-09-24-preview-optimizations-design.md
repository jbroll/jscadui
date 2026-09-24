# Preview optimizations

## Goal

Four changes that make every model preview faster or sturdier, not only the
`ALL.js` grids:

1. **Indexed geometry with GPU normals.** Send Manifold meshes indexed and
   without normals, and shade them flat on the GPU in three.js as regl
   already does. About 18 bytes a triangle instead of 84.
2. **Stream the parts of a multi-part model.** Evaluate, convert and post one
   solid at a time, so an assembly draws part by part.
3. **Keep unchanged meshes across runs.** Send a content hash in place of a
   mesh the page already holds, and reuse the page's copy.
4. **A spare worker.** Abandon a long stale run or a trapped worker at once
   and continue on a warm spare, instead of waiting for the run to finish.

Each part ships on its own, in this order: 1, 2, 3, 4.

Out of scope: a worker pool that splits one model or grid across workers,
curated showcase grids, progress-driven budgets for single models.

## 1. Indexed geometry with GPU normals

`ManifoldGeom3.useGpuNormals` already switches the mesh getters to Manifold's
indexed mesh (`vertProperties`, `triVerts`) with no normals. The app sets it
only for regl, because three.js has no path for a mesh without normals.

- `format-threejs` shades a mesh that has no normals with a
  `flatShading: true` material; three.js then takes the face normal from
  screen-space derivatives. Meshes with normals keep today's material. The
  smooth option still works: `toCreasedNormals` computes normals from
  positions.
- `render-threejs` reports `supportsGpuNormals`, and `engine.js` sets it for
  both viewers, so the existing `useGpuNormals` option reaches the worker on
  every run.
- The raw mesh keeps only x, y, z when Manifold's `numProp` is more than 3.
- `exportStlText` computes face normals from positions when an entity has no
  normals or is indexed, so it no longer depends on the render layout.
- Export, measure and check work from solids through `polygons`, not from the
  render buffers; a test pins that the flag changes neither.
- Plain jscad geometry (`CSG2Vertices`) is already indexed and keeps its CPU
  normals.

## 2. Stream the parts of a multi-part model

- A `jscadMain` that carries a `runId`, whose `main` emitted nothing, and
  that returned more than one solid, streams its solids: for each solid in
  order it forces evaluation, converts it with `prepare` and posts a
  `jscadCells` batch through the existing stream hook. The result is
  `{ entities: [], streamed: true, runId }`, the same shape a grid returns.
- Unlike a grid, the worker keeps `workerState.solids` and leaves
  `lastRunStreamed` false, so export, measure and check use the solids with
  no re-run.
- A request with no `runId` (AI evaluate, animation, export re-runs) gets a
  whole result as today.
- The app needs no change: `streamRuns` already accepts, caps, coalesces and
  finishes the run.
- Instancing groups only within one batch. The app does not enable instancing,
  so nothing is lost today.

## 3. Keep unchanged meshes across runs

Nothing produces identical geometry objects across runs. Plain jscad,
Manifold and the OpenSCAD runtime rebuild every part. So reuse is by content.

- The worker hashes each `mesh` entity's type and buffers (64-bit FNV-1a over
  the bytes) after conversion.
- `jscadMain` and `jscadScript` take `held: string[]`, the hashes of meshes
  the page is drawing. An entity whose hash is held goes out as
  `{ type, hash, ref: true, color, transforms, isTransparent, opacity }` with
  no buffers and nothing added to the transfer list. This applies to whole
  results and to streamed batches.
- The worker clears the `JscadToCommon` conversion cache after each run it
  posts. A cache hit could otherwise hand out buffers already transferred and
  detached. With content hashes, the identity cache buys nothing.
- The app keeps a map from hash to entity for the model it is drawing. Before
  caps, it resolves each `ref` entity. If color, transforms, transparency and
  opacity also match, it reuses the previous entity object itself, so
  three.js reuses its built object. Otherwise it makes a new entity sharing
  the buffers. A `ref` whose hash the page does not hold fails the run as a
  `ModelError`.
- Resolved entities count toward the caps like any other.
- Requests that pass no `held` (AI evaluate, animation, export) get full
  entities.
- render-regl gains nothing: it rebuilds every entity on each scene.

## 4. A spare worker

The frame host keeps two workers, an active one and a spare.

- **Warm-up.** The frame sends the spare every `jscadInit` (after its own
  rewrite), `jscadSetFiles` and cache clear it sends the active worker, but
  no script. A spare holds the bundles and an initialised WASM runtime and
  no model.
- **Record.** The frame records the arguments of the last `jscadScript` and
  the last `jscadMain` that succeeded.
- **Promote.** Retiring the active worker terminates it, promotes the spare
  and starts a new spare. Before the promoted worker runs a request that needs
  the model (`jscadMain`, export, measure, check), the frame loads the
  recorded script into it with `jscadScript({ ..., runMain: false })`, which
  loads the module and WASM without running `main`. Before export, measure or
  check it also replays the recorded `jscadMain` with `stream: false`. These
  setup requests are the frame's own, tracked with the same timeouts; a
  failure answers the app's request with the error.
- **Abandon.** A `jscadScript` or `jscadMain` sent with `supersede: true`,
  arriving while a `jscadScript` or `jscadMain` has been pending on the active
  worker for at least 500 ms, answers the pending one with a `SupersededError`
  and retires the worker. The new request runs on the promoted worker.
  Below 500 ms the request goes to the active worker as today, so a slider
  drag does not restart workers.
- **Trap.** A response whose error is named `RuntimeError`, or a result with
  `trapped: true`, retires the worker after the answer is relayed. The worker
  sets `trapped` when `globalThis.__allWasmTrap` is set, which a grid does
  when one of its cells traps.
- **Kill.** A timeout kill keeps today's behaviour (answer, post
  `frameWorkerTerminated`, the app replays), and the spare becomes the
  replacement worker.
- **App.** Loads and parameter changes send `supersede: true`. A parameter
  change that arrives while a run has been in flight for at least 500 ms is
  sent at once, not queued. A `SupersededError` shows no error bar.

Cost: one more worker's bundles and WASM runtime, and a script load on
promotion. The frame's transpile cache lives in each worker, so a promoted
worker transpiles the model's OpenSCAD includes again.

## Testing

- Unit tests per part: `packages/manifold`, `packages/format-threejs`,
  `packages/worker`, `apps/jscad-web/test` (frame host, frame setup, stream
  runs, mesh refs, params UI).
- CI after each part: the per-model render sweep and the grid sweep against
  their baselines, the export e2e, and the OpenSCAD comparison suite
  unchanged. Part 1 records the page memory change in the grid sweep.
