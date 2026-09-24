# Grid worker pool

Run an `ALL.js` grid across several frame workers at once, so a grid's leaf
models, including those inside nested sub-grids, evaluate in parallel. Workers
hand out leaves by claiming them one at a time, which is the same mechanism a
later `part()` boundary for JSCAD and SCAD parts will use.

Out of scope: `part()` itself, parallel export/measure/check, and non-grid
models, which keep running on one worker.

## Pool

The frame keeps up to `N = max(1, min(hardwareConcurrency - 1, 4))` workers.
`jscadInit` takes an optional `poolSize` that overrides `N`; the frame strips it
as it does `timeoutMs`. Tests and the render sweep use it to pin the size. Every
worker holds its own bundles, WASM instances and file map, which is what bounds
`N`.

The active worker and the spare become one list of workers. Each slot records
the script it has loaded (`slot.script`, compared by identity with
`lastScript`) in place of the `loaded` flag, so an idle worker left on an older
script reloads before it runs. The pool keeps one idle worker warm, as the spare
is kept today; a trap or supersede outside a pooled run promotes an idle worker
the same way, preferring one that already has the current script.

## Claims

The stream hook gains `claim(key, url)`, which posts
`{ method: 'jscadClaim', id, params: [{ key, url }] }` with a random id and
resolves with the frame's answer, `{ method: '__CLAIM__', id, params: [won] }`.
The worker's own listener takes the answer; `sealMessages` keeps model code from
adding listeners. Since claiming is part of the stream hook, it exists exactly
when streaming does. A `stream: false` run (the solids re-run of export, measure
and check, animation frames, agent evaluation) has no hook, and its grid runs
every leaf itself.

Every streaming run is a run in the frame's sense, with a claimed-key set. The
frame accepts a claim only from a worker that is a member of the current run.
A claim restarts that worker's kill timers, as a relayed cell does. Model code
can post claims of its own; the only effect is on which of its own grid's
leaves run where.

The frame cannot tell a grid from a model before it runs, so a run's first claim
fans it out: the frame answers that claim and, when `N > 1`, sends the same
request (same params, `runId` and `held`) to up to `N - 1` more workers through
`relay`, which already starts a worker with the mirrored setup and reloads
`lastScript` with `runMain: false` before a `jscadMain`. A `jscadScript` run is
sent as is. These are frame requests (`onAnswer`); their answers never reach the
app directly. A worker that joins late finds the early keys claimed and takes
what is left. With `N = 1` every claim is won and nothing fans out.

## Grid template and placement

The loop, name deduplication, failure markers and trap handling move from the
generated template into `examples/lib/grid-utils.js`. A generated `ALL.js`
becomes its item list and one call, which `generate-all-files.js` emits:

```js
const { gridModule } = require('../../lib/grid-utils.js')
const items = [ /* ... */ ]
module.exports = gridModule(items, { spacing: 60, cellSize: 51 }, require)
```

The file's own `require` is passed in so item paths resolve against the grid's
directory. `gridModule` returns `{ main, runGrid }`. `main(params)` takes
`__jscadStream` and nulls it while cells run, so leaf code sees neither
streaming nor claiming, restores it after, and calls `runGrid` with the identity
transform and an empty key path.

### Placement

A grid runs its cells under a world transform `ctx`. For cell `i`,
`gridPosition(i, items.length, spacing)` gives `(x, y)` as today.

- A leaf model (a module without `runGrid`) is normalized to `cellSize` and
  placed at `(x, y)` by `normalizeAndPlace`, then `ctx` is applied.
- A sub-grid (a module exporting `runGrid`) is called directly with
  `ctx · translate(x, y) · scale(s) · translate(-c)`, where `c` is the centre of
  the sub-grid's layout and `s = cellSize / max(width, depth)`. `width` and
  `depth` are the extent of the sub-grid's `gridPosition` points plus one of its
  `cellSize`, so they follow from its item count and options alone. A sub-grid
  whose leaves are all small or flat is therefore placed slightly differently
  from today.
- The sub-grid streams its own leaves, so the per-cell budget applies to each
  leaf rather than to a whole sub-grid.
- Params namespaces are unchanged: a sub-grid's `runGrid` gets `params[name]`.
- With no stream hook, `runGrid` returns its leaves already in world
  coordinates, and the parent collects them without normalizing again.
- Failure markers take `ctx`: `failureMarker()` is normalized and then
  transformed, and `prebuiltSkull` composes `ctx` into its `transforms`.

### Keys

A leaf's key is its index path, for example `"2/14"` for the fifteenth item of
the third sub-grid. Item lists are static, so every worker builds the same tree
and the keys agree. For each leaf, `runGrid` awaits `claim(key, url)`; on
`false` it skips the leaf without requiring it. Sub-grids are walked regardless,
so a worker requires every `ALL.*.js` in the tree but transpiles only the leaves
it wins. The `__jscadScriptGeneration` check after each cell stays.

## The run

A run holds the app request id, `runId`, the claimed keys, its member workers,
the key each member is running (from its last claim), and the leaves lost so
far. `jscadCells` from any member is relayed while the run is open. The run
answers the app once, when its last member has answered: `{ entities: [],
streamed: true, runId, lost }` on success, or the first member error that is not
a trap or a timeout.

### Losing a member

A trap or a timeout stops only the member it happened in. The frame retires that
member and adds a replacement that joins late, so the run never runs out of
workers while keys remain. Each loss consumes a leaf, so replacements are
bounded by the leaf count.

- On a trap, `runGrid` marks the leaf with `prebuiltSkull`, stops claiming and
  returns; the worker answers `trapped: true`. Its unclaimed keys stay open.
- On a timeout, the member's current key goes into `lost` as
  `{ url, reason: 'TimeoutError' }`. `streamRuns.js` shows the lost urls as an
  error and keeps the cells already drawn.

`frameWorkerTerminated` is posted only when no member remains and none can be
started.

### Supersede

A superseding request answers the old app request `SupersededError`, closes the
run to claims (later claims answer `false`) and stops relaying its cells. Each
member then gets today's `abandonStale` rule on its own: one whose current leaf
started at least `ABANDON_AFTER_MS` ago is retired, and the rest finish their
leaf, walk the remaining keys without running anything, and go idle. A
superseding `jscadMain` still never abandons a pending `jscadScript`.

### Code layout

`frameHost.js` (394 lines) splits:

- `src_frame/workerSlot.js`: start, `track`, timers, `end`.
- `src_frame/workerPool.js`: the worker list, idle workers, promotion, setup
  replay, `ensureLoaded`.
- `src_frame/gridRun.js`: fan-out, claims, lost leaves, finishing the run.
- `src_frame/frameHost.js`: message routing, `jscadInit` rewrite, supersede
  entry points.

## Testing

Unit:

- `grid-utils.js`: nested layout transforms, a sub-grid's scale from its item
  count; `runGrid` with a fake claim skips a lost leaf without requiring it,
  keys match across two walks, a trap stops claiming, and with no stream hook
  every leaf is returned placed.
- `gridRun.js` and `workerPool.js` with fake workers: fan-out on the first
  claim, none at `N = 1`, a late joiner gets only open keys, the run answers
  after its last member, a trapped member is replaced, a timed-out member's leaf
  appears in `lost`, supersede drains young members and retires old ones, claims
  from a non-member are ignored, an idle worker on an older script reloads.
- Worker: the `claim` round trip, and no hook on a `stream: false` run.
- `apps/jscad-web/test/all-grid.test.js` against the regenerated templates.

End to end, via simple-ci on GPU: the render sweep with `poolSize: 1` and
`poolSize: 4` draws the same `data-cells` count per grid and holds the 596/788
baseline. Time the NopSCADlib tests grid under both; that number decides
whether the pool pays for itself.

## Docs

- `apps/jscad-web/docs/architecture.md`: the pool, claims and layout scaling
  replace the spare section and the "only the outermost grid streams" section.
- `docs/WORKER_PROTOCOL.md`: `jscadClaim`, `lost`, `poolSize`.
- `docs/backlog.md`: `part()` boundaries for JSCAD and SCAD parts, using the
  claim mechanism.
