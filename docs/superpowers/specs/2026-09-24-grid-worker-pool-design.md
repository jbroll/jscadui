# Grid worker pool

Run an `ALL.js` grid across several frame workers at once, so a grid's leaf
models, including those inside nested sub-grids, evaluate in parallel. Workers
hand out leaves by claiming them one at a time, which is the same mechanism a
later `part()` boundary for JSCAD and SCAD parts will use.

Out of scope: `part()` itself, parallel export/measure/check, and non-grid
models, which keep running on one worker.

## Pool

The frame keeps up to `N = max(1, min(hardwareConcurrency - 1, 4))` workers.
`jscadInit` takes an optional `poolSize` that overrides `N`; tests and the
render sweep use it to pin the size. Every worker holds its own bundles, WASM
instances and file map, which is what bounds `N`.

When `N > 1`, the frame adds `claims: true` to every relayed `jscadScript` and
`jscadMain` that streams (carries a `runId` and not `stream: false`). The worker
then installs `globalThis.__jscadClaim` for that run. Without `claims`, the hook
is absent and a grid runs every leaf itself, as it does today; that covers
`N = 1`, the `stream: false` re-run of export, measure and check, animation
frames, and agent evaluation.

A run starts on one worker as now. The frame cannot tell a grid from a model
before it runs, so the first `jscadClaim` a run's worker sends makes the run a
pooled run: the frame answers that claim at once and sends the same request,
same params, same `runId` and `held`, to up to `N - 1` more workers.

- A worker that has the current script loaded gets the `jscadMain` or
  `jscadScript` directly.
- A worker without it goes through the existing `ensureLoaded` path: replay the
  mirrored setup if it is new, then `lastScript` with `runMain: false` before a
  `jscadMain`. A `jscadScript` run is sent as is, with `runMain` as the app gave
  it.
- A worker that does not exist yet is started and set up from `mirrored`, as the
  spare is today.

A worker that joins late finds the early keys claimed and takes what is left.
Helper requests are frame requests (`onAnswer`); their answers never reach the
app directly.

Once a grid has run, its workers stay loaded and idle between runs. They replace
the spare: a trap or supersede in a non-pooled run promotes an idle loaded worker
the way the spare is promoted now. Before the first grid there is no idle worker,
so a trap in an ordinary model before then pays a cold start. The spare that
`answered()` starts after the first `jscadScript` goes away.

## Grid template and placement

### Template

The loop, name deduplication, failure markers and trap handling move from the
generated template into `examples/lib/grid-utils.js`. A generated `ALL.js`
becomes its item list and one call:

```js
const { gridModule } = require('../../lib/grid-utils.js')
const items = [ /* ... */ ]
module.exports = gridModule(items, { spacing: 60, cellSize: 51 }, require)
```

The file's own `require` is passed in so item paths resolve against the grid's
directory. `gridModule` returns `{ main, runGrid }`. `main(params)` is the entry
the worker calls; it takes `__jscadStream` and `__jscadClaim`, nulls both on
`globalThis` while cells run (so leaf code sees neither), restores them after,
and calls `runGrid` at the top level with the identity transform and an empty
key path. `generate-all-files.js` emits the new form.

### Placement from the layout

A grid runs its cells under a world transform `ctx`. For cell `i`,
`gridPosition(i, items.length, spacing)` gives `(x, y)` as today.

- A leaf model (a module without `runGrid`) is normalized to `cellSize` and
  placed at `(x, y)` by `normalizeAndPlace`, then `ctx` is applied.
- A sub-grid (a module exporting `runGrid`) is called directly with
  `ctx · translate(x, y) · scale(s) · translate(-c)`, where `c` is the centre of
  the sub-grid's layout and `s = cellSize / max(width, depth)`. `width` and
  `depth` follow from the sub-grid's item count, its `spacing` and its
  `cellSize` alone: the extent of its `gridPosition` points plus one
  `cellSize`. The sub-grid never waits for its leaves' geometry to be placed.
- The sub-grid streams its own leaves. A nested grid is no longer one cell, and
  the per-cell budget applies to each leaf rather than to a whole sub-grid.
- Params namespaces are unchanged: a sub-grid's `runGrid` gets `params[name]`.
- With no stream hook, `runGrid` returns its leaves already in world
  coordinates, and the parent collects them without normalizing again.
- Failure markers take `ctx`: `failureMarker()` is normalized and then
  transformed, and `prebuiltSkull` composes `ctx` into its `transforms`.

A sub-grid whose leaves are all small or flat is placed slightly differently
from today, since its scale no longer comes from its measured bounding box.

### Claims

A leaf's key is its index path, for example `"2/14"` for the fifteenth item of
the third sub-grid. Item lists are static, so every worker builds the same
tree and the keys agree. For each leaf, `runGrid` awaits
`__jscadClaim(key, url)`; on `false` it skips the leaf without requiring it.
Sub-grids are walked regardless, so a worker requires every `ALL.*.js` in the
tree but transpiles only the leaves it wins.

### Traps

A trap stops only the worker it happened in. `runGrid` marks the trapped leaf
with `prebuiltSkull`, stops claiming, walks no further and returns; the worker
answers with `trapped: true`. Its unclaimed keys stay open to the rest of the
pool. The frame retires that worker and adds a replacement that joins the run
late, so a pooled run never runs out of workers while keys remain. Each trap
consumes a leaf, so replacements are bounded by the leaf count.

The `__jscadScriptGeneration` check after each cell stays.

## Frame

### Claim protocol

In the worker, `__jscadClaim(key, url)` posts
`{ method: 'jscadClaim', id, params: [{ key, url }] }` with a random id and
resolves with the frame's answer, `{ method: '__CLAIM__', id, params: [won] }`.
The worker's own listener takes the answer; `sealMessages` keeps model code
from adding listeners. The frame accepts a claim only from a worker that is a
member of a pooled run, or the one worker of a streaming run whose request
carried `claims`, and answers from that run's claimed-key set. A claim restarts
that worker's kill timers, as a relayed cell does. Model code can post claims
of its own; the only effect is on which of its own grid's leaves run where.

### The run owns the app request

A pooled run holds the app request id, `runId`, the claimed keys, its member
workers, the key each member is currently running, and the leaves lost so far.
`jscadCells` from any member is relayed while the run is open. The run answers
the app once, when its last member has answered: `{ entities: [], streamed:
true, runId, lost }` on success, or the first member error that is not a trap
or a loss.

### Timeouts

A member that exceeds the budget is killed and replaced like a trapped member.
The key it was running goes into `lost` as `{ url, reason: 'TimeoutError' }`.
`streamRuns.js` shows the lost urls as an error and keeps the cells already
drawn. `frameWorkerTerminated` is posted only when the run as a whole fails,
which is when no member remains and none can be started.

### Supersede

When a superseding request arrives for a pooled run, the frame answers the old
app request `SupersededError`, closes the run to new claims (every later claim
for it answers `false`), and stops relaying its cells. Each member finishes the
leaf it is on, walks the rest without running anything, and is free for the
new run. A member whose current leaf started at least `ABANDON_AFTER_MS` ago is
retired instead. A superseding `jscadMain` still never abandons a pending
`jscadScript`.

### Code layout

`frameHost.js` is 394 lines and would grow past what reads well, so it splits:

- `src_frame/workerSlot.js`: start, `track`, timers, `end`.
- `src_frame/workerPool.js`: membership, idle loaded workers, promotion,
  setup replay, `ensureLoaded`.
- `src_frame/gridRun.js`: fan-out, claims, lost leaves, finishing the run.
- `src_frame/frameHost.js`: message routing, `jscadInit` rewrite, supersede
  entry points.

## Testing

Unit:

- `grid-utils.js`: nested layout transforms, a sub-grid's scale from its item
  count; `runGrid` with a fake claim skips a lost leaf without requiring it,
  keys match across two walks, a trap stops claiming, and with no claim hook
  every leaf is returned placed.
- `gridRun.js` and `workerPool.js` with fake workers: fan-out on the first
  claim, a late joiner gets only open keys, the run answers after its last
  member, a trapped member is replaced, a timed-out member's leaf appears in
  `lost`, supersede drains young members and retires old ones, claims from a
  non-member are ignored.
- Worker: the `__jscadClaim` round trip, and its absence without `claims` and
  on a `stream: false` re-run.
- `apps/jscad-web/test/all-grid.test.js` against the regenerated templates.

End to end, via simple-ci on GPU: the render sweep with `poolSize: 1` and
`poolSize: 4` draws the same `data-cells` count per grid and holds the 596/788
baseline. Time the NopSCADlib tests grid under both; that number decides
whether the pool pays for itself.

## Docs

- `apps/jscad-web/docs/architecture.md`: the pool, claims and layout scaling
  replace the spare section and the "only the outermost grid streams" section.
- `docs/WORKER_PROTOCOL.md`: `jscadClaim`, `claims`, `lost`, `poolSize`.
- `docs/backlog.md`: `part()` boundaries for JSCAD and SCAD parts, using the
  claim mechanism.
