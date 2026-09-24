# Streamed ALL.js grids

## Goal

Draw an `ALL.js` grid cell by cell as the worker finishes each one, instead of
all at once when `main` returns. Along with that:

- The model time budget applies to each cell, not to the whole grid, so a slow
  grid that keeps making progress is not killed.
- The worker frees each cell's geometry once it has been sent, so its heap
  holds one cell at a time.
- A failed cell always shows the skull marker, including every cell after a
  WASM trap.
- A streamed grid may total up to 1.5 GB of buffers in the page.

Out of scope: a worker pool, per-cell parameters driven by the app, and
cutting the per-triangle cost of drawn geometry (in `docs/backlog.md`).

## Behaviour

Every cell is placed at its final grid position as soon as it arrives; the
cell count is known before the grid starts, so nothing already drawn moves.
With zoom-to-fit on, the camera refits to everything drawn so far after each
redraw, so the view only zooms out.

Only the outermost grid streams. A nested grid returns its geometry as today
and arrives in its parent as one cell, so in the top-level `ALL.js` each
sub-grid appears whole when it finishes.

Export, measure and check re-run the grid without streaming and use the full
result. For a large grid that re-run holds the whole grid in memory again and
can still fail.

## Worker and grid

### The stream hook

For the duration of one `jscadMain`, `packages/worker/worker.js` sets
`globalThis.__jscadStream` to `{ emit(geoms), progress() }` and clears it in a
`finally`.

- `emit(geoms)` forces Manifold evaluation (`numTri()`) of the solids, converts
  them with `JscadToCommon.prepare(geoms, transferable, userInstances)`, and
  posts `{ method: 'jscadCells', params: [{ entities }] }` with `transferable`
  as the transfer list.
- `progress()` posts `{ method: 'jscadProgress', params: [] }`, carrying no
  geometry.

The result of a `jscadMain` during which `emit` was called carries
`streamed: true` and `entities: []`, and the worker records that the last run
was streamed.

Instances only group within one `prepare` call, so instancing works per cell.
Entity ids stay unique across calls because the `JscadToCommon` id sequence is
module-global.

### The generated grid

`packages/openscad/bin/generate-all-files.js` changes the template's `main`:

- It reads `globalThis.__jscadStream` once, sets the global to `null` while its
  cells run, and restores it in a `finally`. A nested grid therefore sees no
  hook.
- With a hook, after each cell it places the cell with `normalizeAndPlace`,
  calls `stream.emit(placed)`, then disposes each placed geometry that has
  `dispose()`, and returns `[]` at the end.
- With no hook but `globalThis.__jscadProgress` set (see Export), it calls that
  after each cell and returns its geometry as today.
- With neither, it behaves exactly as today. `run-jscad`, the Node comparison
  suite and the unit tests take this path.

The existing yield after each cell and the `__jscadScriptGeneration` check stay.

### The skull after a trap

`apps/jscad-web/examples/lib/grid-utils.js` gains a prebuilt skull: triangle
vertices and normals stored as data, generated once from the current
`failureMarker()` geometry by a script checked in beside it. A cell that fails
after `__allWasmTrap` is set, or whose marker fails to build, emits that mesh as
a ready-made entity placed with a transform matrix at the cell's position and
scale. Building and sending it needs no Manifold and no WASM. Cells that fail
before a trap keep today's `failureMarker()`.

On the non-streaming path the prebuilt skull is returned as a plain `geom3`
built from the same data, which `JscadToCommon` converts without WASM.

## Frame relay

`apps/jscad-web/src_frame/frameHost.js`:

- `track` records each pending request's method beside its timer.
- `worker.onmessage` relays a message with no id whose method is `jscadCells`
  only while a `jscadMain` request is pending, and one whose method is
  `jscadProgress` while any request is pending. Both go out with
  `collectBuffers`. Every other non-response message is still dropped.
- Each relayed message restarts the pending request's kill timer with the
  budget set by `jscadInit`, so that budget becomes the longest one cell may
  take.

Model code can post a `jscadCells` of its own. That draws only geometry it
could have returned, only during its own live run, and it passes through the
app's caps.

## App

### RPC timeout

`packages/postmessage` gains `resetTimeouts()` on the proxy, beside
`rejectPending`: each pending request's timer restarts with the duration it
started with. `apps/jscad-web/src/frameSetup.js` adds `jscadCells` and
`jscadProgress` to its notification handlers; both call `resetTimeouts()`, and
`jscadCells` passes its entities to `onCells`.

### Accepting batches

In `main.js`, a load or parameter change that calls `jscadMain` becomes the
streaming run. A batch is drawn only while that run is current and not stale
(`scriptRuns.js`); any other batch is dropped, including batches that arrive
during a replay. The first batch of a run replaces the previous model.

### Caps

`src/caps.js` checks each batch against the existing limits, 256 MB and 2,000
entities, and a streamed run's running total against 1.5 GB and 20,000
entities. A batch over either limit ends the run with the cap error; the cells
already drawn stay.

### Drawing

Batches that arrive close together are merged and the scene redraws at most
every 250 ms. `packages/render-threejs` keeps the objects it built, keyed by
entity id, across `setScene` calls: a later `setScene` builds only new entities
and disposes the ones that are gone. `render-regl` is not the default and keeps
rebuilding in full, bounded by the 250 ms coalescing.

With zoom-to-fit on, the app keeps a running bounding box of what is drawn and
calls `ctrl.fit` with it after each redraw.

### Finishing

A final `jscadMain` result with `streamed: true` does not replace the model.
The app sets `data-vertices` from the running count and clears the error, so
`data-render` goes to `ok`. While a run streams, the app sets `data-cells` to the
number of batches accepted, updating it as each one arrives rather than on
redraw. A kill or cap error ends the run
as `error` with the drawn cells left in place.

### Kill and replay

A cell over budget is killed as today. The app keeps the drawn cells and shows
the timeout error, and `frameSetup`'s replay restores the worker. No run is
streaming during the replay, so its batches are dropped.

## Export, measure and check

When the last run was streamed, `jscadExportData`, `jscadMeasure` and
`jscadCheck` in `bundle.frame-worker.js` set `globalThis.__jscadProgress` to the
progress poster, re-run `jscadMain` with no stream hook, use the returned
solids, and clear the global. The progress messages restart the frame's timer
and the app's RPC timers, so a long export is not killed while it advances.
For a streamed grid, export skips its `$preview` re-run.

## Sweep

`apps/jscad-web/e2e/render-all.mjs` restarts its per-page guard whenever
`data-cells` changes, so its 320 s guard also becomes per cell.
`RENDER-TESTING.md` describes the per-cell budgets.

## Testing

- `apps/jscad-web/test/all-grid.test.js`: with a fake hook, cells emit in order
  and each placed geometry is disposed; a nested grid emits nothing and
  returns geometry; a streaming grid returns `[]`; after a trap the later
  cells emit the prebuilt skull; with no hook the grid behaves as today; with
  only `__jscadProgress` it calls it once per cell.
- Worker: `jscadMain` sets and clears the hook, marks the result streamed, and
  lists each batch's buffers for transfer.
- `apps/jscad-web/test/frame-host.test.js`: `jscadCells` relays only while a
  `jscadMain` is pending, `jscadProgress` while any request is; each restarts
  the timer; other worker posts are dropped.
- `packages/postmessage`: `resetTimeouts` restarts pending timers with their
  original duration.
- App: cumulative caps, stale batches dropped, the first batch replacing the
  model, three.js reusing objects by id.
- CI: the grids sweep against its baseline, refreshed to what the NopSCADlib
  grid and the grids killed at 290 s now do; the per-model render sweep and
  the comparison suite unchanged; the deploy smoke test still renders
  `01-basics/ALL.js`.
