# Parts fan-out: a lazy model tree, root-children claims

Backlog: `docs/backlog.md` — "`part()` boundaries for JSCAD and SCAD parts"
(Combined ALL.js grids).

## Goal

A single model's parts run in parallel across the compute frame's worker pool,
the way an ALL.js grid spreads its leaves: each part is claimed by one worker,
built there, streamed back, and given its own model budget. This buys both
wall-clock speed (parts evaluate and convert concurrently) and budget scoping
(one part's timers restart on claim, so the budget bounds one part, not the
whole model). A failed part still fails the whole run, exactly as a throwing
`main` fails a model today: there are no partial survivors.

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
| Model tree (new) | The modeling API as node constructors; predicates read tags; measurements, numeric anchor extraction and overlay snapshots are the only eager reads | nothing (pure) |
| Splitter | Root children to parts; key is the child index; anchor-linked root children co-locate (see "Anchors") | model tree |
| Evaluator (new) | Walk a claimed subtree, call the real engine namespace, return geometry; seeds its memo from the build specials; resolves anchor descriptors and bbox-dependent frame placement; passes `literal` leaves straight through | engine namespace |
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
   part key with no `url` (grid leaves claim `key` plus a leaf `url`; model
   parts claim `key` only). The first win calls `fanOut`, and joining workers
   reload the script and rebuild the tree. The build is deterministic, so every
   worker agrees on keys. Pool size 1 wins every claim on the single worker,
   which evaluates parts sequentially; the `fanOut` join loop adds no members.
5. **Evaluate and stream.** A won part is evaluated by walking its subtree and
   calling the real engine namespace; the geometry is emitted as a `jscadCells`
   batch under the run's `runId`, with that part's ghost entities in a
   following batch, mirroring `packages/worker/worker.js:401-402`. `slotOps.restartTimers` on
   claim gives each part its own budget.
6. **Merge.** `merged()` sorts answers by claim order, merges proxy state,
   warnings and console, and returns the streamed result; `createStreamRuns`
   accepts the batches under `runId` and draws them. For a model-parts run
   (see "Frame run mode") any error, trap, or lost part fails the run; there
   is no `lost` list and no partial result.

`jscadMain` return contract:

- Multi-part model: the claim loop streams every won part (each part emits at
  least one batch, so `emitted()` is true) and `jscadMain` returns
  `{ streamed: true, runId }` with empty `entities`. The old solids-based
  `streamParts` fallback (`packages/worker/worker.js:393`) is deleted: under the tree there
  are no solids at build time, and the claim loop covers the lone-worker case
  (claims always win, parts evaluate sequentially).
- One-part model: no claims, no fan-out; evaluate the whole tree on the single
  worker and return entities — today's behaviour with a cheaper build. The
  caller tells the two apart by the `streamed` flag, as today.

Degenerate cases:

- **One part** (a SCAD `main`, or a model that unions everything): no claims,
  no fan-out; evaluate the whole tree on one worker and return entities —
  today's behaviour with a cheaper build (the `streamed` flag absent).
- **Empty root** (a model returning nothing): no parts, no claims; return
  empty entities, as today.
- **Budget:** each claim restarts the run's timers
  (`apps/jscad-web/src_frame/workerSlot.js:63`), so the budget bounds one part.
  A part that exceeds it fails the run, as an over-budget model does today.
- **Trapped WASM:** the worker is retired and replaced and the run fails; there
  are no partial survivors (`gridRun.js:205-210` is grid-only behaviour, not
  model behaviour).

## Frame run mode

A run is a model-parts run when its claims carry `key` with no `url`
(`gridRun.js:97-109`: `url` stays `null`). Grid leaves always claim with a leaf
`url`; model parts never do. No new request type and no `parts` flag.

Model-parts runs differ from grid runs in exactly three places in `gridRun.js`:

- `merged()`: any answer error (including `trapped`, which grids tolerate via
  replacement), any `lost` entry, or any `pendingLost` entry returns
  `{ method: RESPONSE, id, error }`. No `lost` list, no partial entities.
- `answered()`: no replacement `join(run)` on trap or heap-recycle for a
  model-parts run; the slot is retired and the run settles to the error above.
- `leave()`: a member that dies holding a part key records it directly in
  `lost` (no single retry via `pendingLost`/`retried`); the merge then fails
  the run. The run is marked `closed` on the first failure so later claims are
  refused and late `jscadCells` batches are dropped by `relaysCells`.

## Tree namespace and read policy

Node shape:

```js
{ op: 'cube', params: {...}, children: [],
  isTreeNode: true,
  dim: 3,            // 2 | 3 | undefined
  overlay: null,     // null | { kinds: [], unmapped: bool } — snapshots live in build specials
  anchors: null,     // null | { frames, pending } — see "Anchors"
  color: null }
```

Transform nodes additionally carry their affine matrix (`matrix`), computed
from params by pure math at build, so frame mapping needs no geometry.
`literal` nodes (`{ op: 'literal', value }`) hold already-real values entering
from outside the tree (eager path2 objects, `text()` results); the evaluator
passes them straight to the engine.

Sentinels (`NO_CHILD`, `undefined`) are unchanged.

- Primitives, booleans, transforms, extrusions, expansions and hulls all return
  nodes; every geometry op is deferred, including `resize`, `center` and `align`.
  `dim` is derived (e.g. `linear_extrude` of a 2D child is 3).
- `colorize` returns a node with `color`.
- Pure helpers (`maths`, `vector`, most `utils`) pass through to the real
  namespace.
- Async is preserved, not evaluated: if any operand is thenable (e.g. `text()`,
  file imports; `openscad-runtime/src/primitives.js:252-255,268-270`), the op
  returns a `Promise` of a node, mirroring `overlay.js:attach/gathering`.
  `jscadMain` already awaits `runMain` and flattens (`packages/worker/worker.js:371-380`), and
  the evaluator awaits subtree promises before calling the engine.
- Measurements are the eager reads, all twelve (`measureArea`,
  `measureBoundingBox`, `measureBoundingSphere`, `measureCenter`,
  `measureCenterOfMass`, `measureDimensions`, `measureEpsilon`, `measureVolume`
  and the four `measureAggregate*` variants): evaluate the operand with the
  preemptive per-build cache, record `{node, geometry, value}` in a
  build-local `WeakMap` special, and return the value. Numeric anchor
  extraction (`anchor(geom, name).origin` used in arithmetic) and overlay
  snapshots (`background`/`highlight`, which read meshes in
  `overlay.js:108-116`) are eager reads under the same mechanism, returning an
  overlay marker instead of a value.
- Specials lifetime: the `WeakMap` lives in the per-run build context on each
  worker that rebuilds the tree. Build, claim and evaluate happen on the same
  worker in sequence, so the evaluator seeds its memo from that worker's own
  build specials by node object identity. No specials cross workers: every worker
  rebuilds and re-measures locally, and a claimed subtree's measured nodes hit
  the memo populated during that worker's build.
- Overlays evaluate like measurements: `background`/`highlight` force their
  operand, store the mesh snapshot, and tag the node with `overlay`. The
  evaluator emits the real part with ghosts stripped (`strip`: drop `Ghosts`
  entries, keep the rest, per `overlay.js:67-71`) and the ghost entities
  from the stored snapshots (one entity per kind and dimension, merged as in
  `overlay.js:162-173`) with `previewOnly: true`, streamed in a following
  batch. Exports drop them, as `packages/worker/worker.js:383-385` does today.
- Geometry identity is by tag, never by engine class: nodes carry
  `isTreeNode: true` and must not reach `instanceof geom3`, `instanceof
  ManifoldGeom3`, or geometry-keyed `WeakMap`s. The shim answers every such
  check via `op`/`dim`/`overlay` predicates; the table below is the complete
  list of runtime call sites. Any new engine or runtime call site that
  branches on geometry identity must add a tag predicate here rather than
  touching a node. Direct `instanceof` on a node is unsupported by contract.

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
the subtree it reads. Booleans and parts around it stay deferred. No
provenance is tracked on returned numbers, and none is needed: internal
transform uses (`resize`/`center`/`align`) never measure, they defer as nodes,
so only explicit model-code measurements force evaluation, and the cache makes
benign uses free at evaluate time.

## Anchors and fluent

`@jbroll/jscad-anchors` and `@jbroll/jscad-fluent` run on the shim through one
composition: engine namespace → model tree → anchors `wrapTree` (which wraps
whatever `require('@jscad/modeling')` resolves to at load) → fluent classes.
Model code importing either package gets the anchored-tree namespace with no
new aliases. Anchorless models are unaffected: with no frames in play every
wrapper reduces to its wrapped tree constructor. Three changes, all bounded,
make it work.

**Frames live in node tags.** The `anchors` tag holds `{ frames, pending }`:
`frames` are explicit frames (`withAnchors`, `fromBosl2`, `fromConnector`)
plus already-resolved directional frames; `pending` are unresolved directional
descriptors `{ node, direction }` with a build-time orientation basis (pure
vector math on the direction, per `defaults.js:yHint`). Storage
(`storage.js:basisOf/localFrames/worldFrames/withWorldFrames`) reads and
writes tags; `bake` no-ops on nodes, correctly, since immutable nodes cannot go
stale. The per-op frame semantics mirror `wrap/groups.js` exactly:
matrix-known transforms map frames via the node's stored matrix;
`keep`-group ops carry; anchored booleans merge per `booleans.js`;
`drop`-group ops (extrusions, hulls, minkowski) drop frames. Bbox-dependent
placement (`center`/`align`/`resize` frame resolution) defers to the evaluator,
which resolves it with the same bbox→placement helper that evaluates those
nodes. `place.js` gains `resolveAnchor` plus deferred `attach`/`alignTo` emission (below);
`defaults.js` is unchanged (direct `anchor()` calls stay eager — numbers contract).
`place.attach`'s matrix math is pure and reused in both paths.

**Names stay lazy; numbers force evaluation.** `attach` and `alignTo` with
directional names become deferred composite nodes carrying anchor descriptors;
the evaluator resolves both sides from memoized geometry, computes the
placement matrix, and applies it. Only numeric extraction — `anchor(geom,
name).origin` used in arithmetic — is an eager read under the measurement
mechanism. Two traps, both in the diff: `booleans.js:isOptions` must exclude
tree nodes (every node has `basisOf() === undefined`, so a trailing node
operand would be misread as subtract options), and the `wrap/index.js`
`anchoredManifold` gate must also match nodes carrying frames (otherwise
`translate`, the most common transform, silently drops them), with `matrixOf`
reading the node's stored matrix instead of calling the constructor on an
empty path.

**Splitter co-location.** Anchor descriptors are cross-subtree references. When
an `attach`/`alignTo` node in one root child references a subtree under
another, those root children merge into a single part: a worker evaluating one
side would otherwise need the other side's geometry, breaking the no-shipping
rule. Algorithm: walk the whole root once, mapping every node object to its
root-child index; then walk each `attach`/`alignTo` node's params and each
pending descriptor, collecting referenced node identities. Union-find over
root children linked by these edges (transitive closure); each set claims
under one key — joint scheduling, not boolean union: the evaluator evaluates
each member subtree separately and streams all batches under the one claim.
Unlinked children keep one-part-per-child keys.

**Fluent accepts nodes at its gates.** `checkGeometry.ts` accepts `isTreeNode`
(geom2 vs geom3 by `node.dim`); `_wrap`/`copyGeometry` already copy node props
structurally, so fluent wrappers duck-type as nodes and need no evaluator
unwrapping. The splitter and evaluator flatten fluent arrays alongside plain
arrays. Eager path2 objects stay real (cheap, no CSG) and enter the tree as
`literal` leaves.

## Integration

- **New package** `packages/model-tree` (`@jscadui/model-tree`): tree API,
  splitter, evaluator, specials. Engine namespace by injection; Node-testable.
- **New bundles** `apps/jscad-web/src_bundle/bundle.model_tree_manifold.js`
  (imports `@jscadui/manifold`) and a jscad twin
  `bundle.model_tree_jscad.js` (imports `@jscad/modeling`), each importing the
  `@jscadui/model-tree` factory, injecting its engine namespace, and exporting
  the tree API plus `evaluate`/splitter; plus anchored twins
  `bundle.model_tree_anchored_manifold.js` / `bundle.model_tree_anchored_jscad.js`
  that additionally apply the anchors `wrapTree` composition. They are
  additional entry points: the existing `bundle.manifold_modeling.js` and
  `bundle.jscad_modeling.js` stay as the plain bundles (still used for the
  `@jscad/modeling-for-manifold` alias).
- **Alias wiring.** `workerBundles(bundleBase, engine)` (`frameHost.js:14`) maps
  `@jscad/modeling` and `@jscad/modeling-for-anchors` to the engine's
  anchored-tree bundle; `@jscad/modeling-for-manifold` stays the plain bundle.
  One composition covers both, since anchored wrappers reduce to plain tree
  constructors on anchorless nodes. `@jbroll/jscad-anchors` loads from a local
  `bundle.jscad-anchors.js` built out of the pinned checkout, not the
  stale-pinned CDN dist (whose geometry-bound storage predates nodes), and
  `@jbroll/jscad-fluent` from its local bundle the same way; both pick up the
  tree through their internal `require('@jscad/modeling')`. Tag mechanics
  (carry, map, merge, resolve) are implemented once in `@jscadui/model-tree`;
  the anchors package holds only thin node branches delegating to those
  helpers plus `resolveAnchor`/descriptor emission. Wrapping already-tagged
  factory output a second time is a no-op by construction: node `basis` is the
  constant `'tree'`, so the outer `carry`'s `inSync` check always passes on
  tagged nodes.
- **Protocol.** No new request type and no `parts` flag. `jscadMain` always builds
  the tree and splits root children. Multi-part runs drive the
  claim/evaluate/emit loop and return `{ streamed: true, runId }` with empty
  entities; one-part runs evaluate the whole tree and return entities with no
  `streamed` flag. The wire protocol is unchanged (`jscadClaim` to
  `runs.claim`, `jscadCells` relayed by `runId`; run mode comes from the claims
  themselves); `gridRun.js` gains the three model-parts branches described
  under "Frame run mode".
- **Gating.** Single evaluation mechanism for both engines: every run goes through
  the model tree. There is no `parts` option and no eager-mode switch.
- **Failure.** No fallback to eager. A failed part fails the whole tree, exactly as
  a throwing `main` fails a model today: the run errors, no partial survivors.
- **Assumption.** Keys are child indices, so fan-out assumes deterministic
  control flow (same params, same root children on every worker). Models
  branching on `random()`/time could diverge; grids carry the same assumption.

## Export and solids

Solid-producing re-runs must produce the model's whole geometry on one worker:
`withSolids` re-runs `jscadMain` with `stream:false, solidsOnly:true`
(`packages/worker/worker.js:415-426`), and `NEEDS_SOLIDS` requests (`jscadMeasure`,
`jscadCheck`, `jscadExportData`) reload and re-run the same way
(`workerPool.js:205-233`). A `solidsOnly` run builds the tree and
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
- Identity audit: a vitest test greps the runtime and engines for new
  `instanceof` geometry checks and geometry-keyed `WeakMap` uses against the
  table in "Tree namespace and read policy", so an unlisted call site fails
  loudly instead of breaking nodes at runtime.
- Splitter: root-child keys, nested arrays flattened, fluent arrays flattened,
  single and empty roots; anchor-linked root children co-locate under one key.
- Evaluator equivalence: tree to geometry matches the eager namespace on volume,
  bbox and triangle count, for both engines, in the style of
  `apps/jscad-web/examples.test.js`.
- Specials: a mid-build measurement returns the right value and is not
  re-evaluated; the evaluator memo is seeded from the same worker's build
  context.
- Anchors: evaluator equivalence for `attach`/`alignTo`/directional anchors
  against the eager anchored namespace; explicit frames survive matrix
  transforms symbolically; `subtract` with a trailing node operand is not
  misread as options; cross-part `attach` merges parts.
- Fluent: node-accepting constructors (`geom2` vs `geom3` by `dim`); method
  chains build deferred nodes matching eager results.
- Failure: an unsupported op or a throwing part fails the run rather than
  falling back.

Worker (`packages/worker`): emits one claimed batch per part under
`runId`; a one-part model neither claims nor fans out; a `solidsOnly` run
returns all solids; `jscadMeasure`/`jscadCheck` after a streamed run see the whole
model.

Frame (`apps/jscad-web/test`): a parts run is tracked; first claim fans out;
each claim restarts the budget; a failed part fails the run; `merged()`
returns the streamed result. Extend `frame-host.test.js`, `stream-runs.test.js`,
`with-solids.test.js`.

End to end: run the render sweep for both engines and diff against
the two baselines; a multipart example must stream its parts.

```bash
npx vitest run                      # packages/model-tree, packages/worker, apps/jscad-web
npm run test:e2e                    # apps/jscad-web
node e2e/render-all.mjs --baseline             # manifold, needs `npm run dev`
node e2e/render-all.mjs --engine jscad --baseline  # jscad twin
```

Manifold evaluator equivalence runs where the WASM engine runs (worker/browser
harness, as `apps/jscad-web/examples.test.js` does); pure tree/splitter/special
unit tests run in Node/vitest without WASM.

## Out of scope

- vtree's hash cache across runs (a separate item).
- Splitting below root children (nested sub-part claims); union-of-disjoint
  splitting; post-evaluation `decompose` conversion parallelism.
- Rewriting SCAD models to return arrays.

## Resolved decisions

- Mechanism: a lazy model tree over the existing `@jscad/modeling` alias, not an
  exported-functions or `part`-choice API.
- Engine scope: both engines, engine-specific evaluator only.
- Granularity: root children only.
- Part declaration: none — parts are the model's returned array; internal part
  functions become tree children.
- Failed part: fails the whole run, as today. Skull markers are a grid-demo
  concept and do not apply to models.
- Rollout: single mechanism, always on; no opt-in flag and no eager fallback.
- Anchors/fluent: supported through the anchored-tree composition, not an
  eager fallback. Directional anchors are lazy descriptors resolved at
  evaluate time; numeric extraction is an eager read like measurements.
- Frame identity: anchor-linked subtrees are one part. `attach`/`alignTo`
  across root children merges those children under one claim key.
