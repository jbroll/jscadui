# Parts Tree Fan-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the lazy model tree and root-children parts fan-out from `docs/superpowers/specs/2026-10-13-parts-tree-fanout-design.md`, so a single model's parts evaluate in parallel across the frame worker pool.

**Architecture:** New `packages/model-tree` builds deferred node trees over an injected engine namespace; the worker builds the tree, claims one root child per worker, evaluates with memo-seeded specials, and streams batches; `gridRun` gains model-parts branches (fail-fast, no partials); anchors/fluent compose over the tree via tag-based frames and lazy anchor descriptors.

**Tech Stack:** Node 22, ES2022+ ESM, vitest 4, esbuild bundles, Manifold + jscad engines, existing worker/frame message protocol (no protocol changes).

## Global Constraints

- Work in `/home/john/src/jscadui-wt1` on branch `feat/parts-tree-fanout`. Exception: Task 16 explicitly authorizes `checkout main`, fast-forward merge and push; Tasks 13–14 explicitly authorize pushing inside their own upstream checkouts only. Otherwise never switch branches, never push.
- TDD: write the failing test first, watch it fail, minimal implementation, watch it pass. Every task ends in a commit.
- `node.isTreeNode === true` duck-checks only. Never `instanceof` on nodes. Never mutate nodes; spread them.
- No polyfills, ES2022+ only. `sideEffects: false` on the new package.
- `.deps-cache/jscad-anchors` and `.deps-cache/jscad-fluent` are checkouts SHARED with the parent via symlink: Tasks 13–14 commit on their own branches inside those checkouts and record SHAs here. Everything else commits on `feat/parts-tree-fanout` in this worktree.
- After each task: run the task's test command plus `npx eslint <touched>`; the repo pre-commit hook runs the full gate on commit.
- Exact spec path: `docs/superpowers/specs/2026-10-13-parts-tree-fanout-design.md`.

---

## File structure

Created:

- `packages/model-tree/package.json` — name `@jscadui/model-tree`, `main: src/index.js`, `exports` map, `"test": "vitest run"`, devDeps `vitest` + `@jscad/modeling` (tests import the real engine).
- `packages/model-tree/vitest.config.js` — `environment: 'node'`.
- `packages/model-tree/src/index.js` — public surface: `createModelTree`, `createEvaluator`, `createBuildContext`, `withBuildContext`, `bindEvaluator`, `eagerEvaluate`, `memoFromSpecials`, `splitParts`, tag helpers, op-path constants.
- `packages/model-tree/src/nodes.js` — node constructors for every deferred op, `dim` derivation, stored transform matrices, `literal` leaves, attach/alignTo/ghost shapes.
- `packages/model-tree/src/tags.js` — color/overlay/anchors tag ops, frame math over plain arrays using the injected engine `maths`, anchor-descriptor helpers, shared bbox→placement helper.
- `packages/model-tree/src/measurements.js` — all 12 eager measurements against specials.
- `packages/model-tree/src/context.js` — per-run build context (`{ engine, specials: WeakMap, memo: Map, eager }`), `globalThis.__jscadBuild` scoping.
- `packages/model-tree/src/splitter.js` — root-children split, union-find co-location over anchor edges.
- `packages/model-tree/src/evaluator.js` — `createEvaluator(engine)`, subtree replay over the raw engine, memo seeding, ghost emission data, descriptor resolution.
- `packages/model-tree/test/*.test.js` — `scaffold`, `nodes`, `measurements`, `splitter`, `evaluator`, `anchors-tags`, `identity-audit`.
- `apps/jscad-web/src_bundle/bundle.model_tree_jscad.js`, `bundle.model_tree_manifold.js`, `bundle.model_tree_anchored_jscad.js`, `bundle.model_tree_anchored_manifold.js`, `bundle.jscad-anchors.js`.

Modified:

- `packages/openscad-runtime/src/primitives.js` — tree branches in `_is2D`, `_sameDimensionAsFirst`, `withoutDegeneratePolygons`.
- `packages/openscad-runtime/src/overlay.js` — tag-based `overlaysOf`/`strip`/`attach`/`gathering`, deferred `affine`, eager `highlight`/`background` via `eagerEvaluate`.
- `packages/openscad-runtime/src/transforms.js` — bind tree `resize` in `initTransforms`; `_resize`/`resizeMatrix` node branches (no `resizeFactors` on nodes).
- `packages/openscad-runtime/test/tree-branches.test.js` + `vitest.config.js` + `package.json` test script (new scaffold — no runner exists today).
- `packages/worker/worker.js` — `jscadMain` tree path; delete `streamParts` fallback.
- `packages/worker/src/treeApi.js` — `loadBoundEvaluate()` from the active tree bundle (test-seam via `vi.mock`).
- `packages/worker/package.json` — add `"@jscadui/model-tree": "*"` dependency.
- `apps/jscad-web/src_frame/gridRun.js` — model-parts branches in `merged`/`answered`/`leave`, `modelParts` flag on first key-only claim.
- `apps/jscad-web/src_frame/frameHost.js` — alias remap to anchored-tree + local anchors bundles.
- `apps/jscad-web/build.js` — five bundle entries.
- `apps/jscad-web/test/frame-host.test.js`, `stream-runs.test.js`, `with-solids.test.js`, `option-warnings.test.js`, `bundle-entries.test.js` (new), `evaluator-manifold.test.js` (new) — extend/create; `packages/agent-loop/eval/backend.test.js:116` mirror read-only (update only if it pins values).
- `packages/worker/worker.parts.test.js` (new), `worker.stream.test.js`, `worker.ghosts.test.js` — extend.
- `.deps-cache/jscad-anchors` (own branch): `src/storage.js`, `src/wrap/index.js`, `src/place.js`, `src/booleans.js`.
- `.deps-cache/jscad-fluent` (own branch): `src/checkGeometry.ts`, `src/index.ts` (`wrapShape`), templates + `make gen`, `src/types.ts` widening.
- `scripts/deps/sources.json` — pin bumps for the two upstream SHAs (landing gate, Task 16).

---

### Task 1: Scaffold packages/model-tree

**Files:**
- Create: `packages/model-tree/package.json`
- Create: `packages/model-tree/vitest.config.js`
- Create: `packages/model-tree/src/index.js` (stub re-exports)

**Interfaces:**
- Consumes: nothing.
- Produces: package resolvable as `@jscadui/model-tree`; `src/index.js` exports `createModelTree`, `createEvaluator`, `createBuildContext`, `withBuildContext`, `bindEvaluator`, `eagerEvaluate`, `memoFromSpecials`, `splitParts` (stubs throwing `new Error('not implemented')` until later tasks).

- [ ] **Step 1: Write the failing test**

`packages/model-tree/test/scaffold.test.js`:
```js
import { test, expect } from 'vitest'
import * as api from '../src/index.js'

test('public surface exists', () => {
  for (const name of ['createModelTree', 'createEvaluator', 'createBuildContext', 'withBuildContext', 'bindEvaluator', 'eagerEvaluate', 'memoFromSpecials', 'splitParts']) {
    expect(typeof api[name], name).toBe('function')
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/model-tree && npx vitest run test/scaffold.test.js`
Expected: FAIL with cannot find module `../src/index.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/model-tree/package.json` (mirror `packages/format-common` conventions):
```json
{
  "type": "module",
  "sideEffects": false,
  "name": "@jscadui/model-tree",
  "version": "0.1.0",
  "description": "lazy model tree for parts fan-out",
  "main": "src/index.js",
  "exports": { ".": "./src/index.js" },
  "files": ["src"],
  "scripts": { "test": "vitest run" },
  "devDependencies": { "@jscad/modeling": "*", "vitest": "^4.0.18" },
  "license": "MIT"
}
```

`packages/model-tree/vitest.config.js`:
```js
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

`packages/model-tree/src/index.js`:
```js
const todo = (name) => () => { throw new Error(`${name}: not implemented`) }
export const createModelTree = todo('createModelTree')
export const createEvaluator = todo('createEvaluator')
export const createBuildContext = todo('createBuildContext')
export const withBuildContext = todo('withBuildContext')
export const bindEvaluator = todo('bindEvaluator')
export const eagerEvaluate = todo('eagerEvaluate')
export const memoFromSpecials = todo('memoFromSpecials')
export const splitParts = todo('splitParts')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/model-tree && npx vitest run test/scaffold.test.js`
Expected: PASS (1 test; functions exist, throwing only when called — the test only checks `typeof`).

- [ ] **Step 5: Commit**

```bash
git add packages/model-tree
git commit -m "feat(model-tree): scaffold package with stub surface"
```

---

### Task 2: Deferred node constructors + namespace parity

**Files:**
- Create: `packages/model-tree/src/nodes.js`
- Modify: `packages/model-tree/src/index.js` (wire `createModelTree`)
- Test: `packages/model-tree/test/nodes.test.js`

**Interfaces:**
- Consumes: injected raw engine namespace (any object shaped like `@jscad/modeling` categories).
- Produces: `createModelTree(engine, opts?) -> treeNamespace` mirroring modeling categories (`primitives, booleans, transforms, extrusions, expansions, hulls, measurements, colors, geometries, maths, utils, text, curves, modifiers, minkowski`). Deferred op entries return nodes; `maths`, `curves`, pure `utils` pass through to the raw engine by reference. `opts.anchors` (default false): anchor-mode applies the groups-TABLE tag semantics at construction (map on matrix-known transforms, carry on keep-group, merge on anchored booleans, drop on extrude/hull/minkowski) using the tag helpers from `tags.js` (Task 5 defines them; Task 2 stubs the flag plumbing with tag ops as pure functions passed in — concretely: `createModelTree(engine, { tagOps })` where production passes the Task 5 helpers and tests pass fakes. The `{anchors:true}` shorthand used by bundles is defined in Task 5.)

Node shape (exact — defined once here, used by Tasks 4–6, 13):
```js
{ op, params, children, isTreeNode: true, dim, overlay: null, anchors: null, color: null }
// overlay: null | { kinds: ['background'|'highlight', ...], unmapped: bool }
// anchors: null | { frames: {name: frame}, pending: [{node, direction}] }
// transform nodes add: matrix (16 floats, computed from params by pure math)
// literal leaves: { op: 'literal', value, isTreeNode: true, dim, ...null tags }
// ghost markers: { op: 'ghost', params: { kind }, ... } (snapshot lives in build specials keyed by marker)
// attach: { op: 'attach', params: { child, childAnchor, parent, parentAnchor, overlap, flip, spin },
//             children: [child, parent], ... } — each anchor ref is {frame} concrete or {node, direction} descriptor
// alignTo: { op: 'alignTo', params: { child, parent, direction, inset, inside }, children: [child, parent], ... }
```

Op strings are dotted engine paths (`primitives.cube`, `booleans.union`, `transforms.translate`, `extrusions.extrudeLinear`, `colors.colorize` as `{op:'colorize'}` with `color`, `attach`, `alignTo`, `ghost`, `literal`).

`dim` rules: primitives carry their known dim (`cube/cuboid/sphere/cylinder` 3; `circle/square/polygon` 2; `polyhedron` 3); `polygon`/`polyhedron` from inputs; booleans take the dim of the first present child (`undefined`/`null`/`NO_CHILD` skipped); transforms/colorize preserve child dim (multi-child: first present); `extrudeLinear`/`extrudeRotate`/`extrudeHelical` of any 2D child is 3; `project` is 2; `attach`/`alignTo` take the child dim; `ghost` markers take the measured child dim; `literal` detects via raw `geometries.geom2.isA` / `geom3.isA` / `path2.isA` (path2 literal dim is 2).

Async: if any operand (after array flatten) is thenable, return `Promise<node>` resolving through the same constructor (mirror `overlay.js:attach` behaviour). `text()` always returns `Promise<literal node>` (real text generation is async IO; resolve then wrap).

`flatten` inputs: plain arrays, fluent arrays (objects with `isFluentArray === true` — duck-check, spread via `[...value]`), nodes, literals, promises, sentinels (`undefined`, `null`, `NO_CHILD` object identity from `packages/openscad-runtime/src/sentinels.js` — accept any of these as absent, pass through untouched).

- [ ] **Step 1: Write the failing test**

`packages/model-tree/test/nodes.test.js` (uses a FAKE engine — no real geometry, proves deferral):
```js
import { test, expect } from 'vitest'
import { createModelTree } from '../src/index.js'

const raw = {
  primitives: { cube: (...a) => ({ real: 'cube', a }) },
  maths: { vec3: { add: (o, a, b) => [a[0] + b[0]] } },
  utils: {},
}
const treeOf = () => createModelTree(raw)

test('primitive defers without touching the engine', () => {
  let called = 0
  const t = createModelTree({ primitives: { cube: () => { called++; return {} } } })
  const n = t.primitives.cube({ size: 3 })
  expect(called).toBe(0)
  expect(n).toMatchObject({ op: 'primitives.cube', isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null })
})

test('namespace parity: every modeling category present', async () => {
  const modeling = await import('@jscad/modeling').catch(() => null)
  if (!modeling) return
  const t = createModelTree(modeling)
  for (const cat of ['primitives', 'booleans', 'transforms', 'extrusions', 'expansions', 'hulls', 'measurements', 'colors', 'geometries', 'maths', 'utils']) {
    expect(t[cat], cat).toBeTruthy()
  }
})

test('boolean takes first present child dim', () => {
  const t = treeOf()
  const c3 = t.primitives.cube({})
  expect(t.booleans.union(undefined, c3).dim).toBe(3)
})

test('colorize tags color', () => {
  const t = treeOf()
  const n = t.colors.colorize([1, 0, 0], t.primitives.cube({}))
  expect(n.color).toEqual([1, 0, 0])
  expect(n.dim).toBe(3)
})

test('thenable operand returns Promise of node', async () => {
  const t = treeOf()
  const out = t.booleans.union(Promise.resolve(t.primitives.cube({})), t.primitives.cube({}))
  expect(typeof out.then).toBe('function')
  expect((await out).isTreeNode).toBe(true)
})

test('transform stores its matrix', () => {
  const t = treeOf()
  const n = t.transforms.translate([5, 0, 0], t.primitives.cube({}))
  expect(n.matrix.slice(12, 15)).toEqual([5, 0, 0])
  expect(n.dim).toBe(3)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/model-tree && npx vitest run test/nodes.test.js`
Expected: FAIL with `createModelTree: not implemented`.

- [ ] **Step 3: Write minimal implementation**

`src/nodes.js`: implement `createNamespace(engine)` per the Interfaces block. Matrix math: use `engine.maths.mat4`/`vec3` (both engines provide them) or inline column-major builders for translate/scale/rotate/mirror/transform; store on every `transforms.*`, `mirror*`, `rotate*`, `scale*`, `translate*` node. `geometries` entries: `isA` returns false for nodes (never claim nodes), `create`/`fromPoints` stay real (cheap, return real values entering as `literal` children downstream — constructors accept them as `literal` leaves automatically: any non-node, non-array, non-thenable object operand is wrapped `{op:'literal', value}`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/model-tree && npx vitest run test/nodes.test.js`
Expected: PASS. Parity test imports the real `@jscad/modeling` (resolves to the OpenJSCAD checkout) and checks categories only — no geometry built.

- [ ] **Step 5: Commit**

```bash
git add packages/model-tree
git commit -m "feat(model-tree): deferred node constructors with dim, matrix, async"
```

---

### Task 3: Measurements, specials, build context

**Files:**
- Create: `packages/model-tree/src/context.js`, `packages/model-tree/src/measurements.js`
- Modify: `packages/model-tree/src/index.js` (export `withBuildContext`, `eagerEvaluate`)
- Test: `packages/model-tree/test/measurements.test.js`

**Interfaces:**
- Consumes: `createModelTree(engine)` namespace from Task 2; raw `engine.measurements` (all 12: `measureArea, measureBoundingBox, measureBoundingSphere, measureCenter, measureCenterOfMass, measureDimensions, measureEpsilon, measureVolume, measureAggregateArea, measureAggregateBoundingBox, measureAggregateEpsilon, measureAggregateVolume`).
- Produces:
  - `withBuildContext(ctx, run)` — sets `globalThis.__jscadBuild = ctx`, awaits `run()`, restores previous (mirror `withStreamHook` in `packages/worker/src/stream.js:62`).
  - `createBuildContext(engine)` — `{ engine, specials: new WeakMap(), memo: new Map(), eager }`, where `eager` defaults to a function throwing `new Error('eagerEvaluate: no evaluator bound')` and production (Task 5/bundles) assigns the real evaluator-bound implementation. `ctx.eager` is the design seam, not test scaffolding.
  - `eagerEvaluate(node)` — reads `globalThis.__jscadBuild`; calls `ctx.eager(node)`; throws `new Error('measure* outside build context')` when the global is unset.
  - `memoFromSpecials(ctx)` — `new Map` of `node -> geometry` projected from specials entries carrying `.geometry` (overlay-link entries carry snapshots, not geometry, and are skipped).
  - Tree `measurements.*`: `(nodeOrNodes) -> value`; on call: evaluate operand via `eagerEvaluate` with the current context memo, store `{node, geometry, value}` in `ctx.specials` keyed by operand node identity, return value. Throw `new Error('measure* outside build context')` when `globalThis.__jscadBuild` is unset.

- [ ] **Step 1: Write the failing test**

```js
import { test, expect } from 'vitest'
import { createModelTree, createBuildContext, withBuildContext } from '../src/index.js'

test('measurement evaluates once and caches in specials', async () => {
  let evals = 0
  const fakeEngine = { measurements: { measureVolume: () => 42 } }
  const t = createModelTree(fakeEngine)
  const cube = t.primitives.cube({})
  const ctx = createBuildContext(fakeEngine)
  ctx.eager = async (node) => { evals++; return { fakeGeom: true } }
  const v = await withBuildContext(ctx, async () => t.measurements.measureVolume(cube))
  expect(v).toBe(42)
  expect(evals).toBe(1)
  expect(ctx.specials.get(cube).value).toBe(42)
  await withBuildContext(ctx, async () => t.measurements.measureVolume(cube))
  expect(evals).toBe(1)
})

test('all twelve measurements exist', async () => {
  const t = createModelTree({ measurements: {} })
  for (const name of ['measureArea', 'measureBoundingBox', 'measureBoundingSphere', 'measureCenter', 'measureCenterOfMass', 'measureDimensions', 'measureEpsilon', 'measureVolume', 'measureAggregateArea', 'measureAggregateBoundingBox', 'measureAggregateEpsilon', 'measureAggregateVolume']) {
    expect(typeof t.measurements[name], name).toBe('function')
  }
})

test('measurement outside build context throws', async () => {
  const t = createModelTree({ measurements: { measureVolume: () => 1 } })
  await expect(t.measurements.measureVolume(t.primitives.cube({}))).rejects.toThrow('outside build context')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/model-tree && npx vitest run test/measurements.test.js`
Expected: FAIL (`createBuildContext` not exported).

- [ ] **Step 3: Write minimal implementation**

`src/context.js` + `src/measurements.js` per Interfaces. Note: `ctx.eager` seam is test-only; production sets it in Task 5's evaluator wiring (`withBuildContext` in the worker passes the real `eagerEvaluate` bound to the context memo). Measurements must also accept arrays of nodes (pass the flattened list to the raw fn after evaluating each) and literal leaves (evaluate = unwrap value, no special needed).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/model-tree && npx vitest run`
Expected: PASS (scaffold, nodes, measurements).

- [ ] **Step 5: Commit**

```bash
git add packages/model-tree
git commit -m "feat(model-tree): eager measurements with specials cache"
```

---

### Task 4: Splitter with anchor co-location

**Files:**
- Create: `packages/model-tree/src/splitter.js`
- Modify: `packages/model-tree/src/index.js` (export real `splitParts`)
- Test: `packages/model-tree/test/splitter.test.js`

**Interfaces:**
- Consumes: nodes from Task 2 (with `children`, `params`, `anchors.pending` descriptors, `attach`/`alignTo` op nodes referencing other nodes by object identity in `params`).
- Produces: `splitParts(root) -> [{ key, nodes }]` where `root` is the node (or array) returned by `main`. Algorithm (spec "Anchors and fluent" + reviewer lock):
  1. Normalize root to child list: arrays flattened (`[...path, i].join('/')` key shape per spec; top level keys are plain child indices `'0'`, `'1'`, ...). Empty root → `[]`. Single child → `[{ key: '0', nodes: [child] }]` (caller decides no fan-out).
  2. Walk the whole root once, mapping every node object → its root-child index.
  3. Walk each `attach`/`alignTo` node's `params` and each `anchors.pending` descriptor, collecting referenced node identities; union-find over root-child indices linked by these edges (transitive closure).
  4. Each set emits one entry: key = sorted member indices joined by `+` (`'0'`, `'1+3'`); `nodes` = member subtrees in index order. Unlinked children keep single keys. This is joint scheduling, not boolean union: the evaluator evaluates each member separately.

- [ ] **Step 1: Write the failing test**

```js
import { test, expect } from 'vitest'
import { createModelTree, splitParts } from '../src/index.js'

const t = () => createModelTree({})

test('three independent children split three ways', () => {
  const tr = t()
  const parts = splitParts([tr.primitives.cube({}), tr.primitives.cube({}), tr.primitives.cube({})])
  expect(parts.map(p => p.key)).toEqual(['0', '1', '2'])
})

test('attach edge merges two root children', () => {
  const tr = t()
  const a = tr.primitives.cube({})
  const b = tr.primitives.cube({})
  const placed = { op: 'attach', params: { child: b, childAnchor: { node: b, direction: [0, 0, -1] }, parent: a, parentAnchor: { node: a, direction: [0, 0, 1] }, overlap: 0, flip: true, spin: 0 }, children: [b, a], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const parts = splitParts([a, placed])
  expect(parts).toHaveLength(1)
  expect(parts[0].key).toBe('0+1')
  expect(parts[0].nodes).toHaveLength(2)
})

test('transitive edges merge three ways', () => {
  const tr = t()
  const a = tr.primitives.cube({})
  const b = tr.primitives.cube({})
  const c = tr.primitives.cube({})
  const mk = (child, parent) => ({ op: 'attach', params: { child, childAnchor: { node: child, direction: [0, 0, -1] }, parent, parentAnchor: { node: parent, direction: [0, 0, 1] }, overlap: 0, flip: true, spin: 0 }, children: [child, parent], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null })
  expect(splitParts([a, mk(b, a), mk(c, b)])).toHaveLength(1)
})

test('empty and single roots', () => {
  expect(splitParts([])).toEqual([])
  expect(splitParts(undefined)).toEqual([])
  const tr = t()
  expect(splitParts(tr.primitives.cube({}))).toHaveLength(1)
})

test('fluent arrays flatten', () => {
  const tr = t()
  const arr = { isFluentArray: true, [Symbol.iterator]: function* () { yield tr.primitives.cube({}) } }
  expect(splitParts([arr])).toHaveLength(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/model-tree && npx vitest run test/splitter.test.js`
Expected: FAIL (`splitParts: not implemented`).

- [ ] **Step 3: Write minimal implementation**

`src/splitter.js` per the algorithm. Descriptor scan: any `params` value (deep) that `isTreeNode`, plus `anchors.pending[].node`. Map phase records every reachable node object → index (walk `children` arrays and `params` values). Union-find with path compression.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/model-tree && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/model-tree
git commit -m "feat(model-tree): splitter with anchor co-location"
```

---

### Task 5: Evaluator

**Files:**
- Create: `packages/model-tree/src/evaluator.js`, `packages/model-tree/src/tags.js` (frame/tag ops + shared bbox→placement helper; Task 6 and Task 13 consume the same helper semantics)
- Modify: `packages/model-tree/src/index.js` (export `createEvaluator`, `memoFromSpecials`, real `evaluate` bound per engine only by callers; wire `ctx.eager` assignment helper `bindEvaluator(ctx, evaluate)`)
- Test: `packages/model-tree/test/evaluator.test.js`, `packages/model-tree/test/anchors-tags.test.js`, `apps/jscad-web/test/evaluator-manifold.test.js` (manifold volume/bbox/triangle-count equivalence vs eager, following the `examples.test.js` worker harness — WASM only runs there, never in Node)

**Interfaces:**
- Consumes: nodes (Tasks 2–3), injected `engine` — the RAW engine in all cases (tag threading is implemented here in `tags.js`, not imported from the anchors package).
- Produces:
  - `createEvaluator(engine) -> evaluate` — bound evaluator. The worker/bundles call this once per engine; `evaluate(node, memo)` is the bound form. `createBuildContext`'s `eager` slot is assigned `(node) => evaluate(node, ctx.memo)` by whoever creates the context (bundles do this at wiring; tests assign fakes).
  - `evaluate(node, memo) -> Promise<{ solids: [...], ghosts: [...] }>` — replays the subtree: dotted `op` → engine path; `colorize` → engine colors; `literal` → value; memo checked before evaluating and stored after (geometries only).
  - `memoFromSpecials(ctx)` (defined Task 3) is the only specials→memo path.
  - Tag mechanics (single implementation, consumed by Task 13's thin branches): carry/map/merge/drop per the groups TABLE over `anchors` tags, using `engine.maths` for frame math; node `basis` constant `'tree'`; shared bbox→placement helper for `center`/`align`/`resize` frame resolution and descriptor resolution.
  - `createModelTree(engine, { tagOps })` anchor-mode (Task 2 plumbing): production passes these tag mechanics; the `{ anchors: true }` shorthand used by bundles is defined here as `{ tagOps: productionTagOps(engine) }`.
  - Ghosts: `ghost`-marker snapshots resolve from build specials; result nodes with `overlay.kinds` emit ghost entities built exactly like `overlay.js:ghostOf` (math copied into `tags.js`); `overlay.unmapped` entries are mapped through the node's stored matrix here.
  - Dispatch: dotted `op` → engine path (`primitives.cube` → `engine.primitives.cube(params, ...evaluatedChildren)`); `colorize` → `engine.colors.colorize(color, ...children)`; `literal` → `value`; `ghost` markers → real ghost entities via the snapshot (see below); `attach`/`alignTo` → resolve then apply.
  - Ghosts: `ghost` node params carry `{ kind, snapshot, matrix }`; evaluator builds entities exactly like `overlay.js:ghostOf` (copy that math into `tags.js` operating on stored snapshots — same flip/merge behaviour, one entity per kind+dim).
  - Deferred overlay mapping: transform nodes with `overlayPending` map the child ghost snapshots through the node's stored matrix at evaluate time.
  - `attach` resolution: evaluate child + parent (memoized, no double eval); resolve each anchor ref — explicit tag frames used directly, `{node, direction}` descriptors via the shared bbox→placement helper (bbox of the evaluated geometry, origin = center + d·size/2, orientation basis built at build); `M = P · T(overlap) · flip · spin · C⁻¹`; apply `engine.transforms.transform(M, childGeom)`; result frames = mapped child frames.
  - `alignTo` resolution: bboxes of evaluated child + parent, offset math per `place.js:28-32`, `engine.transforms.translate(offset, childGeom)`.
  - `center`/`align`/`resize` nodes: evaluate child, compute placement from real bbox with the shared helper, apply; result frames resolved from the evaluated child frames.
  - Frame threading: the factory's anchor-mode maps incoming tag frames at build for matrix-known transforms; the evaluator ALSO maps any unmapped frames on nodes it evaluates, so direct tree use without anchor-mode stays correct.

- [ ] **Step 1: Write the failing test** (jscad engine in Node — no WASM needed)

```js
import { test, expect } from 'vitest'
import { createModelTree, createBuildContext, withBuildContext, memoFromSpecials } from '../src/index.js'
import { createEvaluator } from '../src/evaluator.js'
import modeling from '@jscad/modeling'

const evaluate = (node, memo) => createEvaluator(modeling)(node, memo)

test('tree evaluates to the same volume as eager', async () => {
  const t = createModelTree(modeling)
  const ctx = createBuildContext(modeling)
  const built = await withBuildContext(ctx, async () =>
    t.booleans.union(t.primitives.cube({ size: 10 }), t.transforms.translate([20, 0, 0], t.primitives.cube({ size: 10 }))))
  const eager = modeling.booleans.union(modeling.primitives.cube({ size: 10 }), modeling.transforms.translate([20, 0, 0], modeling.primitives.cube({ size: 10 })))
  const { solids } = await evaluate(built, memoFromSpecials(ctx))
  expect(solids).toHaveLength(1)
  expect(modeling.measurements.measureVolume(solids[0])).toBe(modeling.measurements.measureVolume(eager))
})

test('measured subtree evaluates once across build and evaluate', async () => {
  const t = createModelTree(modeling)
  const ctx = createBuildContext(modeling)
  let vols = 0
  const counting = { ...modeling, measurements: { ...modeling.measurements, measureVolume: (...a) => { vols++; return modeling.measurements.measureVolume(...a) } } }
  const sub = t.primitives.cube({ size: 4 })
  const v = await withBuildContext(ctx, async () => t.measurements.measureVolume(sub))
  expect(v).toBe(64)
  await evaluate(sub, memoFromSpecials(ctx))
  expect(vols).toBe(1)
})

test('attach resolves to placed geometry', async () => {
  const t = createModelTree(modeling)
  const parent = t.primitives.cube({ size: 10 })
  const child = t.primitives.cube({ size: 2 })
  const node = { op: 'attach', params: { child, childAnchor: { node: child, direction: [0, 0, -1] }, parent, parentAnchor: { node: parent, direction: [0, 0, 1] }, overlap: 0, flip: false, spin: 0 }, children: [child, parent], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const { solids } = await evaluate(node, new Map())
  expect(solids).toHaveLength(1)
  const [[xmin, , zmin], [xmax, , zmax]] = modeling.measurements.measureBoundingBox(solids[0])
  expect(zmax - zmin).toBeCloseTo(12, 5)
  expect(xmax - xmin).toBeCloseTo(10, 5)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/model-tree && npx vitest run test/evaluator.test.js`
Expected: FAIL (`evaluate: not implemented`).

- [ ] **Step 3: Write minimal implementation**

`src/evaluator.js` + `src/tags.js` per Interfaces. Manifold engine equivalence is NOT unit-tested here (needs WASM) — it is covered by the browser-harness equivalence in Task 15's sweep plus `apps/jscad-web/examples.test.js` style checks. Note that in a code comment on the volume test.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/model-tree && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Manifold equivalence (apps/jscad-web harness)**

Create `apps/jscad-web/test/evaluator-manifold.test.js` following `examples.test.js`: build the same 2–3 multipart models eagerly and via the tree, assert equal volume, bbox and triangle count. This file lives here (not in the package) because Manifold WASM only loads in the worker/browser harness.

Run: `cd apps/jscad-web && npx vitest run test/evaluator-manifold.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/model-tree apps/jscad-web/test/evaluator-manifold.test.js
git commit -m "feat(model-tree): evaluator with memo, ghosts, attach resolution"
```

---

### Task 6: openscad-runtime tree branches

**Files:**
- Modify: `packages/openscad-runtime/src/primitives.js`, `src/overlay.js`, `src/transforms.js` (no `consume.js` change: `isDisposable` is already false for nodes, a no-op by construction)
- Scaffold: `packages/openscad-runtime/test/tree-branches.test.js`, `packages/openscad-runtime/vitest.config.js` (`environment: 'node'`), `packages/openscad-runtime/package.json` (`"test": "vitest run"`, devDep `vitest ^4.0.18` — this package has no runner today; verify and add)

**Interfaces:**
- Consumes: `@jscadui/model-tree` (`eagerEvaluate`, node duck-check `v?.isTreeNode === true`). Runtime already receives the tree namespace as injected `jscad`; add `treeResize = jscad.transforms.resize` to the `initTransforms` bindings (it is absent today — `transforms.js:21-31` binds translate/rotate/scale/mirror/transform only).
- Produces per-site behaviour (spec read-policy table):
  - `primitives.js:_is2D(p)` → `p?.isTreeNode ? p.dim === 2 : ('sides' in p || 'outlines' in p)`; same for `_sameDimensionAsFirst`'s local `is2D`.
  - `primitives.js:withoutDegeneratePolygons` → first line `if (geometry?.isTreeNode) return geometry`.
  - `overlay.js`, with node `overlay` = `null | { kinds, unmapped }` and snapshots in build specials: `overlaysOf(x)` on a node returns `x.overlay?.kinds.map(kind => ({ kind })) ?? []`; `strip(x)` drops `ghost`-op nodes and clears overlay tags; `attach(result, list)` on a node merges `list` kinds into `result.overlay.kinds` and records the link `result → snapshots` in the build specials; `gathering(op)` strips node args, calls op, re-attaches; `affine(matrixOf, op)` on node input returns the op node with the list carried and `overlay.unmapped = true` (evaluator maps through the stored matrix); `highlight`/`background` evaluate the operand via `eagerEvaluate`, store the snapshot in specials, return a `ghost`-op marker node (dim = child dim).
  - `transforms.js:_resize` → if `geo?.isTreeNode`, return the bound `treeResize(newsize, geo)` without calling `resizeFactors`. Same guard in `resizeMatrix` (return `null` → affine defers mapping). `resize` is a NEW deferred op for this task: add it to the tree transforms in `packages/model-tree/src/nodes.js` (`DEFERRED_OPS.transforms`, lead 1, dim = child dim, NO stored matrix — factors need the bbox) and to the evaluator dispatch (evaluate child, compute factors from the real bbox exactly like `resizeFactors`, apply scale, resolve frames via the shared helper).
- [ ] **Overlay ownership (Task 5 follow-up, owned here):** ghost markers are the Task 2 shape (`{op:'ghost', params:{kind}}`, snapshot in build specials keyed by marker) — change `evalGhost` to read specials (drop `params.snapshot`), updating any Task 5 test that hand-builds snapshots-in-params. Result nodes with `overlay.kinds` emit ghost entities from the specials `result → snapshots` link recorded by `attach()` (map through `node.matrix` when `unmapped`). `attach`/`alignTo` map CHILD ghosts only; parent ghosts are dropped (the parent is not in the result — eager `withOverlays` agrees). Add the one-line unknown-op throw test (`evaluator.js` already throws; lock it).

- [ ] **Step 1: Write the failing test**

`packages/openscad-runtime/test/tree-branches.test.js`:
```js
import { test, expect } from 'vitest'
import { _is2D, withoutDegeneratePolygons } from '../src/primitives.js'
import { overlaysOf, strip } from '../src/overlay.js'

const node2 = { op: 'x', params: {}, children: [], isTreeNode: true, dim: 2, overlay: null, anchors: null, color: null }
const node3 = { ...node2, dim: 3 }

test('is2D reads dim on nodes', () => {
  expect(_is2D(node2)).toBe(true)
  expect(_is2D(node3)).toBe(false)
})

test('withoutDegeneratePolygons passes nodes through', () => {
  expect(withoutDegeneratePolygons(node3)).toBe(node3)
})

test('overlay strip drops ghost markers, keeps nodes', () => {
  const ghost = { ...node3, op: 'ghost', params: { kind: 'background' } }
  const tagged = { ...node3, overlay: { kinds: ['highlight'], unmapped: false } }
  expect(strip([node3, ghost])).toEqual([node3])
  expect(overlaysOf(node3)).toEqual([])
  expect(overlaysOf(tagged)).toEqual([{ kind: 'highlight' }])
  expect(strip(tagged).overlay).toBe(null)
})
```

(Check whether `_is2D` is exported; if not, test via `_safeUnion` dim filtering on mixed nodes vs the unexported path — prefer exporting the predicate if it is module-private.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/openscad-runtime && npx vitest run test/tree-branches.test.js`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Per-site edits above. Keep every non-node path byte-identical (existing tests must not move).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/openscad-runtime && npx vitest run` and `cd packages/openscad && npx vitest run`
Expected: PASS — new runtime file green and the transpiler suite (the runtime's consumer) unaffected.

- [ ] **Step 5: Commit**

```bash
git add packages/openscad-runtime packages/model-tree
git commit -m "feat(openscad-runtime): tree branches for dim, overlays, resize"
```

---

### Task 7: Worker jscadMain claim loop

**Files:**
- Modify: `packages/worker/worker.js`, `packages/worker/package.json` (add `"@jscadui/model-tree": "*"` dependency)
- Create: `packages/worker/src/treeApi.js`, `packages/worker/worker.parts.test.js`
- Modify: `packages/worker/worker.stream.test.js`, `packages/worker/worker.ghosts.test.js`
- Test: `worker.parts.test.js` + the two extended files.

**Interfaces:**
- Consumes: pure tree functions statically (`splitParts`, `createBuildContext`, `withBuildContext`, `memoFromSpecials` from `@jscadui/model-tree`); the ENGINE-BOUND evaluator dynamically via `src/treeApi.js:loadBoundEvaluate()`, which requires the active tree bundle URL from `requireCache.bundleAlias['@jscad/modeling']` (precedent: `worker.js:281-289` requires the modeling bundle for GPU normals) and returns its bound `evaluate`. Tests `vi.mock('../src/treeApi.js')` — the seam is explicit because a bundle URL cannot be required under vitest/Node.
- Produces `jscadMain` tree path (replacing the `out = flatten(await runMain(...))` block through the result build):
  1. `const ctx = createBuildContext()` and `root = flatten(await withBuildContext(ctx, () => runMain(params)))` (params/proxy handling above unchanged). Assign `ctx.eager = (node) => boundEvaluate(node, ctx.memo)` after loading the bound evaluator.
  2. `const parts = splitParts(root)`; `const memo = memoFromSpecials(ctx)`.
  3. Empty → today's empty-entities result. Single → evaluate whole, convert as today (entities, no `streamed` flag).
  4. Multi: `for (const part of parts) { if (await hook.claim(part.key)) { const { solids, ghosts } = await evaluatePart(part.nodes, memo); hook.emit(solids); if (ghosts.length) hook.emit(ghosts) } }`, where `evaluatePart` evaluates each member subtree and concatenates `{solids, ghosts}`. Claim posts `{key, url: undefined, runId}` (see `packages/worker/src/claims.js:22-26`; `hook.claim` forwards at `packages/worker/src/stream.js:47-52`) → frame sees key-only → `modelParts`. Return `{ entities: [], streamed: true, runId, ... }`.
  5. Root-level ghosts (overlay content attached at root, belonging to no part): if present, one extra trailing claim key `${parts.length}`; winner emits them. No root ghosts → no extra claim.
  6. `stream: false` (non-solids): evaluate ALL parts, concatenate, convert → entities, no flag.
  7. `solidsOnly`: build tree, evaluate entire root, fill `workerState.solids` (previewOnly filtered as today), skip conversion — behaviour identical to today.
  8. Delete the `streamParts` fallback block (`worker.js:393-403`); multi-part always streams through claims (lone worker wins every claim sequentially).
  9. Errors: keep today's catch semantics (clear geometry, `jscadMain failed:` wrap). A throwing part fails the run — no fallback, no partials.

- [ ] **Step 1: Write the failing test**

New `packages/worker/worker.parts.test.js` (read `worker.stream.test.js` first; mirror its harness — fake `main` returning an array of tree nodes, fake hook capturing emits, `vi.mock('../src/treeApi.js')` returning a bound `evaluate` over the real jscad engine):
```js
test('multi-part main claims each part and streams batches', async () => {
  // main returns [cubeNode, sphereNode];
  // claims resolve won=true for every key;
  // expect hook.claim called with keys '0' and '1' (url undefined),
  // hook.emit called twice with one solid each,
  // result = { entities: [], streamed: true, runId }
})
test('one-part main returns entities with no claims', async () => {
  // expect claims.claim not called, result has entities and no `streamed` flag
})
test('throwing part rejects the run with no fallback', async () => {
  // bound evaluate throws on part '1';
  // expect jscadMain rejects with /jscadMain failed/, hook.emit called at most once (part '0')
})
test('unsupported op rejects the run', async () => {
  // main returns [{ op: 'nope', isTreeNode: true, ... }];
  // expect jscadMain rejects (evaluator throws on unknown op)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/worker && npx vitest run worker.parts.test.js`
Expected: FAIL (no claim loop; `src/treeApi.js` missing).

- [ ] **Step 3: Write minimal implementation**

Per Interfaces. The claim call is `hook.claim(key)` — forwarded at `packages/worker/src/stream.js:47-52`, posted at `packages/worker/src/claims.js:22-26`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/worker && npm test`
Expected: PASS (all worker tests; update `worker.ghosts.test.js`/`worker.stream.test.js` expectations where the deleted fallback changed batch counts).

- [ ] **Step 5: Commit**

```bash
git add packages/worker packages/model-tree
git commit -m "feat(worker): jscadMain tree claim loop, drop streamParts fallback"
```

---

### Task 8: gridRun model-parts branches

**Files:**
- Modify: `apps/jscad-web/src_frame/gridRun.js`, `apps/jscad-web/test/frame-host.test.js`
- Test: new cases in `frame-host.test.js` (follow its `createFrameHost` + fake worker harness at `:10-36`).

**Interfaces:**
- Consumes: `jscadClaim` messages with `{key, url: null, runId}` (worker posts `url: undefined`; structured clone preserves the key with `url` absent → `typeof url === 'string' ? url : null` stays `null`).
- Produces:
  - `run.modelParts`: set on the run's FIRST claim — `true` when that claim's `url` is `null`, else `false`. (Grid leaves always claim with a leaf url.)
  - `merged()`: for model-parts runs, any answer error (including `trapped`), any `lost` entry, or any `pendingLost` entry returns `{ method: RESPONSE, id, error }` — no `lost` list, no partial entities. Grid path byte-identical.
  - `answered()`: no replacement `join(run)` on trap or heap-recycle for model-parts runs; retire the slot, let the run settle to the error.
  - `leave()`: a member dying while holding a part key records it directly in `lost` (skip the `pendingLost`/`retried` single retry); mark the run `closed` on first failure so later claims are refused and late cells dropped by `relaysCells`.

- [ ] **Step 1: Write the failing test**

```js
test('model-parts run fails on a lost part, no partials', async () => {
  // open run via jscadMain with stream; primary claims key '0' with NO url;
  // kill the member holding key '1' (simulate leave with key);
  // expect the answered message to carry error (not entities/streamed/lost list)
})
test('model-parts run fails on trap with no replacement join', async () => {
  // answered() with { error: { name: 'RuntimeError' } } on a model-parts run;
  // expect pool.retire called, join NOT called (members size unchanged), merged error answered
})
test('grid run with urls keeps lost-leaf behaviour', async () => {
  // existing grid test — write one if absent: claim WITH url, lost leaf appears in `lost`, run still answers streamed
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/frame-host.test.js`
Expected: FAIL (no `modelParts` concept; trap triggers replacement join).

- [ ] **Step 3: Write minimal implementation**

Per Interfaces. This task is frame-only and independent of the tree — no model-tree import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/frame-host.test.js test/stream-runs.test.js test/with-solids.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web
git commit -m "feat(frame): model-parts run mode fails fast, no partials"
```

---

### Task 9: Bundles

**Files:**
- Create: `apps/jscad-web/src_bundle/bundle.model_tree_jscad.js`, `bundle.model_tree_manifold.js`, `bundle.model_tree_anchored_jscad.js`, `bundle.model_tree_anchored_manifold.js`, `bundle.jscad-anchors.js`
- Modify: `apps/jscad-web/build.js` (five entries)
- Read-only: `packages/agent-loop/eval/backend.test.js:116` (bundle-list mirror — asserts `workerBundles` KEYS; new bundles add no keys, so expect no change unless it pins values)
- Test: new `apps/jscad-web/test/bundle-entries.test.js` (fast grep test, no build)

**Interfaces:**
- Consumes: `@jscadui/model-tree`, `@jscadui/manifold`, `@jscad/modeling` (build-time real), `@jbroll/jscad-anchors` checkout source (build-time).
- Produces (mirror existing `format: 'cjs'`, `loader: frameCjs` patterns):
  - `bundle.model_tree_jscad.js`: `import * as raw from '@jscad/modeling-for-manifold'` + `createModelTree(raw)` → export tree namespace + `splitParts`/`createEvaluator`/`createBuildContext`/`withBuildContext`/`memoFromSpecials`/`eagerEvaluate`, plus the bound `evaluate` from `createEvaluator(raw)` with `bindEvaluator` applied for worker contexts. Externals for THIS bundle: `['@jscad/modeling-for-manifold']` (runtime → plain bundle; esbuild must not inline a second engine copy). Do NOT copy the fluent entry's list here — it lacks this entry.
  - `bundle.model_tree_manifold.js`: same over `@jscadui/manifold` (bundled, + `setWasmUrl`/`startInit` exactly like `bundle.manifold_modeling.js:12-16`).
  - Anchored twins: `createModelTree(raw, { anchors: true })` (Task 5 shorthand — tag mechanics live in model-tree; NO anchors-package import here, so no bloat and no require cycles).
  - `bundle.jscad-anchors.js`: `module.exports = require('@jbroll/jscad-anchors')` (bundled from the checkout at build time), externals `['@jscad/modeling']` (runtime → anchored-tree bundle, so anchors wraps the tree namespace on load; the outer wrap no-ops on tagged nodes by the `'tree'`-basis `inSync` rule).
  - `build.js`: five `buildBundle(frameBuildDir, ...)` entries after line 253. Per-bundle externals: the jscad tree bundle externalizes `['@jscad/modeling-for-manifold']`; the anchored twins and `bundle.jscad-anchors.js` externalize `['@jscad/modeling', '@jscad/modeling-for-anchors', '@jbroll/jscad-anchors']` exactly as the fluent entry at `build.js:245-250` does (verify character-for-character — a prior draft wrote `modeling-for-manifolds` with a bogus trailing `s`).

- [ ] **Step 1: Write the failing test**

New `apps/jscad-web/test/bundle-entries.test.js` (no build; reads source text):
```js
import { test, expect } from 'vitest'
import { readFileSync } from 'fs'

test('build.js registers the five tree bundles', () => {
  const build = readFileSync(new URL('../build.js', import.meta.url), 'utf8')
  for (const name of ['bundle.model_tree_jscad.js', 'bundle.model_tree_manifold.js', 'bundle.model_tree_anchored_jscad.js', 'bundle.model_tree_anchored_manifold.js', 'bundle.jscad-anchors.js']) {
    expect(build.includes(`'${name}'`), name).toBe(true)
  }
})
```
Also read `packages/agent-loop/eval/backend.test.js:116`: if the mirror pins bundle VALUES (not just `workerBundles` keys), extend its expectation for the remapped aliases; if keys-only, no change.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/bundle-entries.test.js`
Expected: FAIL (entries absent).

- [ ] **Step 3: Write minimal implementation**

Bundle files + `build.js` entries. Verify with `npm run build` in `apps/jscad-web` and `ls frame/assets | grep -E 'model_tree|jscad-anchors'` showing all five files.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/bundle-entries.test.js test/frame-host.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web
git commit -m "feat(bundles): model-tree plain and anchored bundles, local anchors bundle"
```

---

### Task 10: frameHost wiring

**Files:**
- Modify: `apps/jscad-web/src_frame/frameHost.js`, `apps/jscad-web/test/option-warnings.test.js` (only if the modeling-table assertion needs the new surface — read it first)
- Test: `apps/jscad-web/test/frame-host.test.js` (bundles map assertion), option-warnings suite.

**Interfaces:**
- Consumes: bundle filenames from Task 9.
- Produces `workerBundles(bundleBase, engine)`:
```js
'@jscad/modeling': bundleBase + (engine === 'manifold' ? 'bundle.model_tree_anchored_manifold.js' : 'bundle.model_tree_anchored_jscad.js'),
'@jscad/modeling-for-anchors': /* same anchored bundle as above */,
'@jscad/modeling-for-manifold': bundleBase + 'bundle.jscad_modeling.js',   // unchanged
'@jbroll/jscad-anchors': bundleBase + 'bundle.jscad-anchors.js',            // was CDN pin
// ...rest unchanged
```
Single mechanism, always on: no flags, no eager switch. The anchored composition reduces to plain tree constructors on anchorless nodes (Task 13 proves it).

- [ ] **Step 1: Write the failing test**

In `frame-host.test.js` (or wherever `workerBundles` is asserted — grep first):
```js
test('modeling aliases resolve to anchored tree bundles', () => {
  const m = workerBundles('https://base/', 'manifold')
  expect(m['@jscad/modeling']).toBe('https://base/bundle.model_tree_anchored_manifold.js')
  expect(m['@jscad/modeling-for-anchors']).toBe('https://base/bundle.model_tree_anchored_manifold.js')
  expect(m['@jscad/modeling-for-manifold']).toBe('https://base/bundle.jscad_modeling.js')
  expect(m['@jbroll/jscad-anchors']).toBe('https://base/bundle.jscad-anchors.js')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/frame-host.test.js`
Expected: FAIL (old bundle names).

- [ ] **Step 3: Write minimal implementation**

The four-line remap. Nothing else in `frameHost.js` changes (protocol untouched).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/frame-host.test.js test/option-warnings.test.js`
Expected: PASS (update the option-warnings modeling-table expectation only if the anchored surface legitimately differs — it must not; wrappers preserve keys).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web
git commit -m "feat(frame): wire modeling aliases to anchored tree bundles"
```

---

### Task 11: Stream + solids tests

**Files:**
- Modify: `apps/jscad-web/test/stream-runs.test.js`, `apps/jscad-web/test/with-solids.test.js`
- Test: the files themselves (no source change expected; `src/streamRuns.js` already keys batches by `runId`).

**Interfaces:**
- Consumes: Tasks 7–8 behaviour.
- Produces: proof that a parts run streams per-part batches under one `runId` and draws as they arrive (`accept` per part, `finish` returns the streamed result); proof that `withSolids` re-run (`stream:false, solidsOnly:true`) after a streamed parts run returns the whole model and export/measure/check read it.

- [ ] **Step 1: Write the failing test**

```js
test('parts run draws each part batch as it arrives', () => {
  // begin(runId); accept(partBatch0, runId); accept(partBatch1, runId);
  // expect draw called per batch; finish(runId) returns streamed result with entities: []
})
test('solids re-run after streamed parts returns the whole model', () => {
  // streamed run finished; withSolids path re-runs solidsOnly; expect all solids present for export
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/stream-runs.test.js test/with-solids.test.js`
Expected: FAIL (new assertions on multi-batch behaviour; if they pass already, strengthen: assert per-part ordering matches claim order).

- [ ] **Step 3: Write minimal implementation**

Extend the tests; change `src/streamRuns.js` only if a gap appears (e.g. ordering). Prefer no source change.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/stream-runs.test.js test/with-solids.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web
git commit -m "test(frame): parts streaming and solids re-run coverage"
```

---

### Task 12: Identity audit test

**Files:**
- Create: `packages/model-tree/test/identity-audit.test.js`
- Test: itself.

**Interfaces:**
- Consumes: the read-policy table in the spec ("Tree namespace and read policy") hardcoded as data in the test.
- Produces: a vitest test that greps `packages/openscad-runtime/src`, `packages/manifold/src`, and the OpenJSCAD modeling checkout for `instanceof (geom3|geom2|ManifoldGeom|Ghosts)` and `new WeakMap` uses against the allow-list below; any unlisted site fails the test. Allow-list (spec table): `primitives.js:231,260` is2D `in`-checks (now dim branches), `overlay.js:40-64` (tag storage — WeakMap retained ONLY for real-geometry overlays, never nodes), `checkGeometry.ts` isKind (Task 14 keeps the `in` form, node-accepted), `storage.js` basis paths (Task 13). The test asserts each allow-listed file+pattern still exists AND no new matches exist elsewhere.

- [ ] **Step 1: Write the failing test**

```js
import { test, expect } from 'vitest'
import { execSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FIND = 'instanceof\\s+(geom3|geom2|ManifoldGeom3|ManifoldGeom2|Ghosts)|new\\s+WeakMap'
// allow-list: [file substring, regex source matching permitted lines in that file]
const ALLOW = [
  ['openscad-runtime/src/overlay.js', 'table = new WeakMap'],
  ['openscad-runtime/src/overlay.js', 'instanceof Ghosts'],
  ['openscad-runtime/src/primitives.js', 'is2D'],
]
test('no unlisted geometry identity checks', () => {
  // git grep covers tracked packages; plain grep covers the gitignored .deps-cache checkouts
  const tracked = execSync(`git grep -n -E "${FIND}" -- packages/openscad-runtime packages/manifold || true`, { encoding: 'utf8', cwd: ROOT })
  const cache = execSync(`grep -rn -E "${FIND}" .deps-cache/jscad-anchors/src .deps-cache/jscad-fluent/src || true`, { encoding: 'utf8', cwd: ROOT })
  const lines = (tracked + '\n' + cache).trim().split('\n').filter(Boolean)
  for (const line of lines) {
    const ok = ALLOW.some(([file, re]) => line.includes(file) && new RegExp(re).test(line))
    expect(ok, line).toBe(true)
  }
})
```

Tune ALLOW to the true post-Task-6/13/14 state on first run — the committed list is the contract; Task 12 lands it green. Note: the starter list is a best guess (the `primitives.js` `is2D` matcher may match nothing and no `packages/manifold` entry is yet known); the implementer validates every entry against real grep output and adds missing ones before committing.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/model-tree && npx vitest run test/identity-audit.test.js`
Expected: FAIL on first run if any site is missing from ALLOW (tune the list until it reflects reality — the committed list is the contract).

- [ ] **Step 3: Write minimal implementation**

Tune ALLOW to the true post-Task-6/13/14 state. No source change.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/model-tree && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/model-tree
git commit -m "test(model-tree): identity audit for geometry checks"
```

---

### Task 13: jscad-anchors tree awareness (upstream checkout)

**Where:** `/home/john/src/jscadui-wt1/.deps-cache/jscad-anchors` — its OWN git checkout, OWN branch `feat/tree-nodes`, committed and pushed there per that repo's flow. Record the SHA in the Task 16 landing note. This checkout is shared with the parent via symlink: run that package's test suite before and after, and leave its branch checked out on your change (do not disturb other worktrees' expectations — they use pins, not branches).

**Files:**
- Modify: `src/storage.js`, `src/wrap/index.js`, `src/place.js`, `src/booleans.js`, `src/index.js` (export `wrapTree` + tag helpers for tests)
- Test: extend that checkout's `test/` (follow its runner: `cat package.json | grep -A3 scripts`)

**Interfaces:**
- Consumes: `@jscadui/model-tree` tag helpers (import by package name if resolvable from that checkout, else duplicate the ~20-line duck-check + tag spread locally and note the debt in the commit message. Do NOT add a dependency that breaks that package's publish). Ownership rule: tag MECHANICS (carry/map/merge/drop, frame math, bbox helper) live in model-tree Task 5; this task adds only thin node branches delegating to those helpers, plus `resolveAnchor`/descriptor emission. The constant node `basis: 'tree'` makes the outer `carry`'s `inSync` check pass on already-tagged factory output, so double-wrapping is a no-op (spec §Anchors).
- Produces:
  - `storage.js`: `isTreeNode` duck-check first in `basisOf` (nodes with `anchors` tag → `'tree'`; dim 2/3 without tag → `'tree-bare'`), `localFrames`/`worldFrames` read node tags (no staleness check — immutable), `withWorldFrames` spreads node + tag, `bake` returns nodes unchanged, `isAnchorable(node)` = dim 2|3. `defaultFrame` on a node calls the tree eager `measureBoundingBox` (numbers out = eager contract).
  - `wrap/index.js`: `anchoredManifold` also matches `g?.isTreeNode && g.anchors`; `matrixOf` tree branch reads the stored node matrix (tree transform ctors compute it with or without geometry present); `carry`/`stripStale` via tag helpers.
  - `booleans.js:isOptions` adds `&& value?.isTreeNode !== true`.
  - `place.js`: `resolveAnchor(geom, ref)` — explicit named frame on a node → concrete frame from tags (no eval); directional name on a node → `{node, direction}` descriptor (lazy); directional on real geometry → existing eager `defaultFrame`. `attach`: both sides concrete → `M` + tree transform node with mapped frames; else deferred `{op:'attach'}` descriptor node. `alignTo`: always deferred `{op:'alignTo'}` node (needs both bboxes).
  - `index.js`: additionally export `wrapTree` and the tag helpers (test seam for bundles).

- [ ] **Step 1: Write the failing test** (in that checkout, its style)

```js
// storage.tree.test.js
test('withWorldFrames spreads a node and tags frames', () => {
  const node = { op: 'primitives.cube', params: {}, children: [], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  const out = withWorldFrames(node, { top: frame([0, 0, 5], [0, 0, 1], [1, 0, 0]) })
  expect(out.op).toBe('primitives.cube')
  expect(out.anchors.frames.top.origin).toEqual([0, 0, 5])
})
test('subtract trailing node is not options', () => {
  expect(isOptions(node)).toBe(false)
})
test('attach on real geometry matches eager semantics', () => {
  // anchored wrap of the REAL engine (today's behaviour): attach a small cube
  // to the top of a plate, then the same assembly built and evaluated through
  // the tree; assert equal bbox and volume. This is the anchored-equivalence
  // gate: symbolic frame mapping must reproduce eager placement.
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: that package's runner (see its `package.json`).
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Per Interfaces. Keep every real-geometry path byte-identical (its full suite must stay green). Implement the equivalence test in Step 1 fully: real-geometry attach vs tree-built attach evaluated through `@jscadui/model-tree`'s evaluator, asserting equal `measureBoundingBox` and `measureVolume`.

- [ ] **Step 4: Run test to verify it passes**

Run: full suite of that checkout.
Expected: PASS.

- [ ] **Step 5: Commit (in that checkout)**

```bash
git add src test
git commit -m "feat: tree-node awareness with tag-based frames"
```

Record the SHA for Task 16.

---

### Task 14: jscad-fluent node acceptance (upstream checkout)

**Where:** `/home/john/src/jscadui-wt1/.deps-cache/jscad-fluent` — OWN checkout, OWN branch `feat/tree-nodes`. NEVER edit `src/gen/` by hand: change `templates/`, run `make gen`, then `npm run lint:fix` (per that repo's CLAUDE.md). Full `npm run check:all` before committing there.

**Files:**
- Modify: `src/checkGeometry.ts`, `src/index.ts` (`wrapShape`), `templates/` (whatever generates the constructor/`_wrap` gates), `src/types.ts` (widen geometry params to include tree nodes)
- Test: extend that checkout's tests with node-acceptance cases.

**Interfaces:**
- Consumes: nodes (duck `isTreeNode`, `dim` 2|3).
- Produces:
  - `checkGeometry` accepts `isTreeNode` values (kind match: `geom2 ⇔ dim 2`, `geom3 ⇔ dim 3`); `checkOperands` flattens fluent arrays and validates wrapped nodes the same way.
  - `wrapShape`: `isTreeNode` dispatch BEFORE `isA` (dim 2 → `FluentGeom2`, else `FluentGeom3`).
  - No evaluator unwrapping needed: `_wrap`+`copyGeometry` already copy node props structurally, so wrappers duck-type as nodes downstream.

- [ ] **Step 1: Write the failing test**

```ts
test('FluentGeom3 accepts a dim-3 node', () => {
  const node = { op: 'primitives.cube', params: {}, children: [], isTreeNode: true, dim: 3, overlay: null, anchors: null, color: null }
  expect(() => new FluentGeom3(node as any)).not.toThrow()
})
test('wrapShape dispatches dim-2 nodes to FluentGeom2', () => {
  expect(wrapShape({ ...node2 } as any)).toBeInstanceOf(FluentGeom2)
})
test('method chains build deferred nodes matching eager results', () => {
  // jf.cube({size: 4}).translate([10, 0, 0]) against the tree namespace:
  // every link returns a Fluent wrapper duck-typing as a node
  // (isTreeNode true down the chain); evaluating the final wrapper gives the
  // same bbox as the eager chain on real geometry.
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: that package's unit runner.
Expected: FAIL (constructor throws).

- [ ] **Step 3: Write minimal implementation**

Per Interfaces via `templates/` + `make gen`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check:all` in that checkout.
Expected: PASS.

- [ ] **Step 5: Commit (in that checkout)**

Record the SHA for Task 16.

---

### Task 15: Render sweeps + multipart e2e

**Files:** none (verification only; fix fallout in place with new commits if the sweep finds real diffs).

**Interfaces:**
- Consumes: all previous tasks.
- Produces: green sweeps for both engines against baselines, plus proof a multipart example streams its parts.

- [ ] **Step 1: Manifold sweep**

Run: `npm run dev` in one shell (background), then `node e2e/render-all.mjs --baseline` in `apps/jscad-web`.
Expected: no diffs vs baseline. A multipart example must show per-part streaming (check the run's `jscadCells` batches > 1 for a >1-part model).

- [ ] **Step 2: jscad sweep**

Run: `node e2e/render-all.mjs --engine jscad --baseline`
Expected: no diffs vs baseline.

- [ ] **Step 3: Unit + e2e suites**

Run: `npx vitest run` (model-tree, worker, jscad-web) and `npm run test:e2e` in `apps/jscad-web`.
Expected: all green. If red, fix forward with `fix(...)` commits (TDD still applies).

- [ ] **Step 4: No commit (verification only)** — or `fix` commits if fallout. Do not commit empty.

---

### Task 16: Landing

**Files:**
- Modify: `docs/backlog.md` (delete the `part()` item at `:165`), `docs/architecture.md` (one paragraph: where the tree lives, claim flow, anchored composition — follow the existing section style), `scripts/deps/sources.json` (pin bumps to Task 13/14 SHAs — requires those SHAs merged/published upstream first; if not yet published, STOP after the checklist and report).
- Delete: `docs/superpowers/specs/2026-10-13-parts-tree-fanout-design.md`, `docs/superpowers/plans/2026-10-13-parts-tree-fanout.md` (working docs; fold first, per repo docs rule).

**Interfaces:**
- Consumes: green `npm run validate`, both sweeps, upstream SHAs.
- Produces: `main` fast-forwarded to the branch tip and pushed — exactly:
```bash
npm run validate
git checkout main
git merge --ff-only feat/parts-tree-fanout
git push
```
If `--ff-only` refuses: rebase the branch on `main`, re-run `npm run validate`, retry. Never merge through GitHub.

- [ ] **Step 1: Validate**

Run: `npm run validate` at the worktree root.
Expected: lint + typecheck + full tests green.

- [ ] **Step 2: Fold and delete working docs**

Remove the backlog item; add the architecture paragraph; delete the spec + plan files; commit:
```bash
git add docs/backlog.md docs/architecture.md docs/superpowers/specs/2026-10-13-parts-tree-fanout-design.md docs/superpowers/plans/2026-10-13-parts-tree-fanout.md
git commit -m "docs: land parts fan-out, drop working spec and plan"
```

- [ ] **Step 3: Fast-forward merge + push**

```bash
git checkout main
git merge --ff-only feat/parts-tree-fanout
git push
```
Expected: linear `main`, pushed. Report the new `main` SHA.

---

## Execution notes

- Parallel-safe once interfaces lock: Task 8 (frame-only) any time; Tasks 13–14 after Tasks 2–5 interfaces are committed; Task 12 after Tasks 6/13/14.
- Manifold evaluator equivalence runs only where WASM runs (browser/worker harness); pure tree/splitter/specials tests run in Node. Both engines diffed in Task 15.
- Upstream landing gate: Tasks 13–14 SHAs must be merged/published and `sources.json` pins bumped, or CI `fetch-deps` will check out stale pins and the tree will fail in clean environments.
