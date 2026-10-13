# Parts fan-out: a lazy model tree, root-children claims

Backlog: `docs/backlog.md` — "`part()` boundaries for JSCAD and SCAD parts"
(Combined ALL.js grids).

## Goal

A single model's parts run in parallel across the compute frame's worker pool,
the way an ALL.js grid spreads its leaves: each part is claimed by one worker,
built there, streamed back, and given its own model budget and failure
boundary. This buys both wall-clock speed (parts evaluate and convert
concurrently) and isolation (one part over budget or trapping does not take the
model down).

## Background

- **Grids already fan out.** A grid model calls `stream.claim(key, url)` before
  building each leaf (`apps/jscad-web/examples/lib/grid-utils.js:302`); a lost
  claim skips the leaf. The first won claim calls `fanOut`
  (`apps/jscad-web/src_frame/gridRun.js:91`); every worker reloads the same
  script, runs the same `jscadMain`, and builds only its claimed leaves, which
  it streams as `jscadCells` batches under a `runId`.
- **Single models do not.** `main` runs top to bottom and returns its geometry.
  By the time a worker could claim "part 3", part 3 is already built. The
  manifold modeling layer is eager: `union` calls `getManifold().union(...)`
  immediately (`packages/manifold/src/booleans/index.js:56`), and only mesh
  conversion is lazy (`getMesh`/`polygons`/`vertices`, forced by `numTri()` at
  `packages/worker/worker.js:410`). There is no JS operation tree to partition.
- **Both languages meet at one namespace.** JSCAD models `require('@jscad/modeling')`;
  the worker maps that alias to the engine bundle
  (`apps/jscad-web/src_frame/frameHost.js:14`). The OpenSCAD runtime is injected
  with the same namespace (`packages/openscad-runtime/src/primitives.js:20`,
  `index.js:410-417`), and the transpiler emits `require('@jscad/modeling')`
  (`packages/openscad/src/transpiler/helpers/index.ts:19`). So one shim covers
  both languages.
- **Prior art: `@jscad/vtree`** (pinned OpenJSCAD.org checkout,
  `.deps-cache/OpenJSCAD.org/packages/vtree`). It is `apiClone`, a fake modeling
  API returning `{type, params, children}` nodes instead of geometry
  (`core/index.js`), evaluated by DFS with a hash cache
  (`core/buildCachedGeometryFromTree.js`). It is used by OpenJSCAD.org's desktop
  and web apps, **not by jscadui**. Its `findDisconnectedSubGraphs`
  (`core/findDisconnectedSubGraphs.js`) returns the root children — the model's
  returned array — and is an unused prototype; vtree's evaluator never calls it.

## Direction

Introduce a lazy modeling namespace (the **model tree**) in place of the eager
one for a parts run. Building `main` produces a tree cheaply; the parts are the
root's children; each is claimed and evaluated on a worker using the real
engine namespace. This is engine-agnostic: the deferral lives in the shim, not
the engine, so both the manifold and jscad engines use the same design, with an
engine-specific evaluator.

Only root children are parts. Below a root child, sub-results are intermediates
of a boolean, so further splitting would require shipping intermediate geometry
between workers and a dependency scheduler — a different, larger project. A
root child is the maximal subtree whose result is an output.

## Architecture

| Unit | Responsibility | Depends on |
|---|---|---|
| Model tree (new) | The modeling API as node constructors; predicates read tags; measurements are the only eager reads | nothing (pure) |
| Splitter | Root children to parts; key is the child index | model tree |
| Evaluator (new) | Walk a claimed subtree, call the real engine namespace, return geometry; reuse measurement caches | engine namespace |
| Worker run (extend `jscadMain`) | Build the tree, expose part keys, claim each, evaluate claimed ones, stream | model tree, splitter, evaluator, claims |
| Frame claims (extend `gridRun`) | Claim, fan-out, recycle, per-part budget, retire trapped workers | worker pool |
| App stream (extend `streamRuns`) | Accept part batches under the run's `runId`, draw as they arrive | — |

Parts are already positioned in world space by the model, so unlike grid cells
there is no `normalizeAndPlace` and no placement metadata: a part streams
exactly the geometry the model placed.

## Data flow

1. **Load.** `jscadScript` loads the module as today, with the run's
   `@jscad/modeling` alias pointing at the model tree, so `main` becomes a
   tree-builder.
2. **Build.** `jscadMain` runs `main(params)` against the tree (cheap, no
   geometry) and gets the root. Parameter discovery falls out of the same run.
3. **Split.** Parts are the root's children; the key is the child index
   (`[...path, i].join('/')`, the grid leaf-key shape). One child means one part
   and no fan-out.
4. **Claim and fan out.** Each worker rebuilds the same tree and claims each
   part key; the first win calls `fanOut`, and joining workers reload the script
   and rebuild the tree. The build is deterministic, so every worker agrees on
   keys.
5. **Evaluate and stream.** A won part is evaluated by walking its subtree and
   calling the real engine namespace; the geometry is emitted as a `jscadCells`
   batch under the run's `runId`.
6. **Merge.** `merged()` sorts answers by claim order, merges proxy state,
   warnings and console, and returns the streamed result; `createStreamRuns`
   accepts the batches under `runId` and draws them.

Degenerate cases:

- **One part** (a SCAD `main`, or a model that unions everything): no fan-out;
  evaluate the whole tree on one worker and return entities — today's behaviour
  with a cheaper build.
- **Budget:** each claim restarts the run's timers
  (`apps/jscad-web/src_frame/workerSlot.js:63`), so the budget bounds one part.
  A part that exceeds it loses its worker; `leave()` retries once, then marks it
  lost.
- **Trapped WASM:** the worker is retired and replaced, the part is reported
  lost, the others continue (`gridRun.js:205-210`).

## Tree namespace and read policy

Node shape:

```js
{ op: 'cube', params: {...}, children: [],
  dim: 3,            // 2 | 3 | undefined
  overlay: null,     // 'background' | 'highlight' | null
  color: null }
```

Sentinels (`NO_CHILD`, `undefined`) are unchanged.

- Primitives, booleans, transforms, extrusions, expansions and hulls return
  nodes; `dim` is derived (e.g. `linear_extrude` of a 2D child is 3).
- `colorize` returns a node with `color`.
- Pure helpers (`maths`, `vector`, most `utils`) pass through to the real
  namespace.
- `resize` and any geometry-needing transform (`center`, `align`) are recorded
  as nodes; the read moves to evaluation.
- Measurements (`measureBoundingBox`/`measureArea`/`measureVolume`) are the only
  eager reads: evaluate the operand with a preemptive cache, record
  `{cache, result}` as a special, return the value. The evaluator seeds its
  caches from the specials so a measured subtree is not evaluated twice.

Every mid-build read in the runtime and its answer:

| Read | Site | Answer |
|---|---|---|
| `'sides' in p \|\| 'outlines' in p` | `openscad-runtime/src/primitives.js:231,260` | `node.dim === 2` |
| `withoutDegeneratePolygons` | `primitives.js:477-480` | no-op on nodes; the evaluator filters degenerates of real operands |
| `WeakMap` + `instanceof Ghosts` | `openscad-runtime/src/overlay.js:40-64` | `node.overlay` |
| `consuming` dispose | `openscad-runtime/src/consume.js:5-13` | no-op (no handles); the evaluator disposes |
| `measureBoundingBox` in `resizeFactors` | `openscad-runtime/src/transforms.js:123` | the deferred `resize` node |
| `isManifoldGeom3` / `hullPoints` | `primitives.js:216` | node `op` checks; node constructors |
| geometry construction (`geom2`/`geom3`) | `overlay.js:35-37` | node constructors |

The irreducible limit: a build-time branch on a measurement forces evaluation of
the subtree it reads. Booleans and parts around it stay deferred.

## Integration

- **New package** `packages/model-tree` (`@jscadui/model-tree`): tree API,
  splitter, evaluator, specials. Engine namespace by injection; Node-testable.
- **New bundles** `apps/jscad-web/src_bundle/bundle.model_tree.js` (imports
  `@jscadui/manifold`) and a jscad twin (imports `@jscad/modeling`), each
  injecting its namespace and exporting the tree API plus `evaluate`/splitter.
- **Alias wiring.** `workerBundles(bundleBase, engine)` (`frameHost.js:14`) gains
  a parts variant mapping `@jscad/modeling` and `@jscad/modeling-for-anchors` to
  the engine's tree bundle when parts mode is on; `@jscad/modeling-for-manifold`
  stays the plain bundle.
- **Protocol.** No new request type. `jscadInit` gains `parts: true`, set by
  `frameInit` beside `claims: true` (`frameHost.js:288`) and read into
  `workerState.parts`. `jscadMain` in parts mode drives the claim/evaluate/emit
  loop and returns `{ streamed: true, runId, lost }`. The frame side is
  unchanged: `jscadClaim` to `runs.claim`, `jscadCells` relayed by `runId`.
- **Gating.** Available for both engines. Off by default behind a `parts`
  option; flip default-on once the render sweep in parts mode matches both
  baselines (`render-baseline.json`, `render-jscad-baseline.json`).
- **Fallback.** An op the shim does not cover falls back to the eager namespace
  for that run rather than failing the model.
- **Assumption.** Keys are child indices, so fan-out assumes deterministic
  control flow (same params, same root children on every worker). Models
  branching on `random()`/time could diverge; grids carry the same assumption.

## Export and solids

Solid-producing re-runs must produce the model's whole geometry on one worker:
`withSolids` re-runs `jscadMain` with `stream:false, solidsOnly:true`
(`worker.js:415-426`), and `NEEDS_SOLIDS` requests (`jscadMeasure`,
`jscadCheck`, `jscadExportData`) reload and re-run the same way
(`workerPool.js:205-233`). In parts mode a `solidsOnly` run builds the tree and
evaluates the entire root (no claims, no fan-out) on the single worker, filling
`workerState.solids` as before. Measure, check and export are unchanged in
behaviour. The model budget on such a run bounds the whole model, as it does
today for export.

SCAD transits the same alias, so it is covered by construction, but a transpiled
`main` usually returns one solid or one union — a single root child — so SCAD
typically gets no fan-out and behaves as today.

## Testing

Unit — `packages/model-tree` (Node/vitest):

- Tree API shape: node fields, `dim` derivation, `color`/`overlay` tags, pure
  pass-throughs.
- Read policy: `is2D` from `dim`; absent vs empty; `overlaysOf`/`strip`;
  `withoutDegeneratePolygons` no-op.
- Splitter: root-child keys, nested arrays flattened, single and empty roots.
- Evaluator equivalence: tree to geometry matches the eager namespace on volume,
  bbox and triangle count, for both engines, in the style of
  `apps/jscad-web/examples.test.js`.
- Specials: a mid-build measurement returns the right value and is not
  re-evaluated.
- Fallback: an unsupported op yields the fallback signal rather than throwing.

Worker (`packages/worker`): parts mode emits one claimed batch per part under
`runId`; a one-part model neither claims nor fans out; a `solidsOnly` run
returns all solids; `jscadMeasure`/`jscadCheck` after a parts run see the whole
model.

Frame (`apps/jscad-web/test`): a parts run is tracked; first claim fans out;
each claim restarts the budget; a lost part is reported by key; `merged()`
returns the streamed result. Extend `frame-host.test.js`, `stream-runs.test.js`,
`with-solids.test.js`.

End to end: run the render sweep in parts mode for both engines and diff against
the two baselines; a multipart example must stream its parts.

```bash
npx vitest run                      # packages/model-tree, packages/worker, apps/jscad-web
npm run test:e2e                    # apps/jscad-web
node e2e/render-all.mjs --baseline  # needs `npm run dev`
```

## Out of scope

- vtree's hash cache across runs (a separate item).
- Splitting below root children (nested sub-part claims); union-of-disjoint
  splitting; post-evaluation `decompose` conversion parallelism.
- Rewriting SCAD models to return arrays.
- Part-level skull markers: a failed part is reported by key and the survivors
  are drawn.
- Any change to the eager path when parts mode is off; it is the fallback.

## Resolved decisions

- Mechanism: a lazy model tree over the existing `@jscad/modeling` alias, not an
  exported-functions or `part`-choice API.
- Engine scope: both engines, engine-specific evaluator only.
- Granularity: root children only.
- Part declaration: none — parts are the model's returned array; internal part
  functions become tree children.
- Failed part: reported lost, no marker.
- Rollout: opt-in first, default-on after the sweep passes; silent fallback to
  eager on an unsupported op.
